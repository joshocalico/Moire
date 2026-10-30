/**
 * A fake PipeWire for smokes: a real Unix socket speaking the native protocol, with a registry of
 * audio nodes, devices with routes and profiles, and the `default` Metadata. It applies
 * `set_param` like PipeWire + ACP do (a device Route's props land on its node), follows
 * `default.configured.audio.*` like WirePlumber, and can delay, refuse, hang, ping and drop
 * connections so the client's edges can be tested. Volumes are stored linear, as on the wire.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
export {
  buildFakePipeWire,
  fakePipeWireHooks,
  type FakePipeWireBuild,
} from "@moire/sys/fake-pipewire";
import { P, podBool, podNumber, podNumbers, podProp, type Pod } from "./pod";
import {
  ClientMethod,
  CoreEvent,
  CoreMethod,
  encodeMessage,
  events,
  MessageReader,
  messageArgs,
  MetadataEvent,
  MetadataMethod,
  ParamsEvent,
  ParamsMethod,
  RegistryEvent,
  RegistryMethod,
  argInt,
  argPod,
  argString,
  decodeDict,
  type Dict,
  type RawMessage,
} from "./protocol";
import {
  PwType,
  SpaAvailability,
  SpaChannel,
  SpaObjectType,
  SpaParam,
  SpaProfile,
  SpaProp,
  SpaRoute,
} from "./spa";

export type FakeNode = {
  id: number;
  props: Record<string, string>;
  /** Linear channel volumes. */
  volumes: number[];
  mute: boolean;
  /** Apply a set_param this much later, like a stream whose app answers asynchronously. */
  applyDelayMs?: number;
};

export type FakeRoute = {
  index: number;
  device: number;
  direction: 0 | 1;
  name: string;
  description: string;
  available: boolean;
  volumes: number[];
  mute: boolean;
};

export type FakeProfile = { index: number; name: string; description: string };

export type FakeDevice = {
  id: number;
  props: Record<string, string>;
  /** Active routes; `availableRoutes` adds the inactive ones. */
  routes: FakeRoute[];
  availableRoutes: FakeRoute[];
  profiles: FakeProfile[];
  profile: number;
};

type Resource = { type: string; globalId: number };

type Client = {
  socket: net.Socket;
  reader: MessageReader;
  resources: Map<number, Resource>;
  registries: Set<number>;
  props: Dict;
  pongs: number[];
  /** Ids the client may reuse (sent remove_id) and the highest id it has used. */
  freed: Set<number>;
  maxId: number;
};

export type FakeServerOptions = {
  /** WirePlumber present: the `default` Metadata exists and follows configured defaults. */
  wireplumber?: boolean;
};

const METADATA_ID = 30;

const sliderToLinear = (volume: number) => volume ** 3;

export class FakePipeWireServer {
  readonly nodes = new Map<number, FakeNode>();
  readonly devices = new Map<number, FakeDevice>();
  readonly metadata = new Map<string, { type: string; value: string }>();
  /** Every state-changing request, as text, in order. */
  readonly calls: string[] = [];
  readonly clients = new Set<Client>();
  /** Runs after each recorded call, to change the world mid-operation. */
  onCall: ((call: string) => void) | null = null;
  /** Stop answering anything (the client must time out). */
  hang = false;
  /** Refuse set_param with this message. */
  refuse: string | null = null;
  /** WirePlumber follows a configured default after this delay. */
  defaultDelayMs = 0;
  private server: net.Server | null = null;
  private readonly wireplumber: boolean;

  private constructor(
    readonly path: string,
    options: FakeServerOptions,
  ) {
    this.wireplumber = options.wireplumber ?? true;
  }

  static async start(options: FakeServerOptions = {}): Promise<FakePipeWireServer> {
    // Unix socket paths are short (104 bytes on macOS); fixtures often nest TMPDIR deeply.
    const base = os.tmpdir().length > 60 && fs.existsSync("/tmp") ? "/tmp" : os.tmpdir();
    const directory = fs.mkdtempSync(path.join(base, "moire-fake-pw-"));
    const fake = new FakePipeWireServer(path.join(directory, "pipewire-0"), options);
    fake.server = net.createServer((socket) => fake.accept(socket));
    await new Promise<void>((resolve, reject) => {
      fake.server!.once("error", reject);
      fake.server!.listen(fake.path, resolve);
    });
    return fake;
  }

  /** Two outputs (one on a card with routes), two inputs, a playing app and a recorder. */
  static standard(fake: FakePipeWireServer): FakePipeWireServer {
    fake.addDevice({
      id: 40,
      props: {
        "device.name": "alsa_card.pci-0000_00_1f.3",
        "device.description": "Built-in Audio",
        "media.class": "Audio/Device",
      },
      routes: [
        route(1, 4, 1, "analog-output-speaker", "Speakers", [0.064, 0.064], false),
        route(2, 5, 0, "analog-input-mic", "Microphone", [1], false),
      ],
      availableRoutes: [
        route(1, 4, 1, "analog-output-speaker", "Speakers", [0.064, 0.064], false),
        route(3, 4, 1, "analog-output-headphones", "Headphones", [1, 1], false, false),
        route(2, 5, 0, "analog-input-mic", "Microphone", [1], false),
      ],
      profiles: [
        { index: 0, name: "off", description: "Off" },
        {
          index: 1,
          name: "output:analog-stereo+input:analog-stereo",
          description: "Analog Stereo Duplex",
        },
      ],
      profile: 1,
    });
    fake.addNode(52, "alsa_output.pci-0000_00_1f.3.analog-stereo", "Audio/Sink", "Speakers", {
      volumes: [0.064, 0.064],
      extra: { "device.id": "40", "card.profile.device": "4" },
    });
    fake.addNode(61, "bluez_output.headset", "Audio/Sink", "Headset", { volumes: [0.512, 0.512] });
    fake.addNode(53, "alsa_input.pci-0000_00_1f.3.analog-stereo", "Audio/Source", "Microphone", {
      volumes: [1],
      extra: { "device.id": "40", "card.profile.device": "5" },
    });
    fake.addNode(62, "bluez_input.headset", "Audio/Source", "Headset Microphone", {
      volumes: [0.125],
      mute: true,
    });
    fake.addNode(74, "Firefox", "Stream/Output/Audio", "", {
      volumes: [0.729, 0.729],
      extra: { "application.name": "Firefox", "media.name": "YouTube" },
    });
    fake.addNode(90, "pw-record", "Stream/Input/Audio", "", {
      volumes: [1],
      extra: { "application.name": "pw-record" },
    });
    fake.setMetadata("default.audio.sink", json(52, fake));
    fake.setMetadata("default.audio.source", json(53, fake));
    return fake;
  }

  addNode(
    id: number,
    name: string,
    mediaClass: string,
    description: string,
    options: {
      volumes?: number[];
      mute?: boolean;
      extra?: Record<string, string>;
      applyDelayMs?: number;
    } = {},
  ): FakeNode {
    const node: FakeNode = {
      id,
      props: {
        "object.serial": String(1000 + id),
        "node.name": name,
        "media.class": mediaClass,
        ...(description ? { "node.description": description } : {}),
        ...options.extra,
      },
      volumes: options.volumes ?? [1, 1],
      mute: options.mute ?? false,
      applyDelayMs: options.applyDelayMs,
    };
    this.nodes.set(id, node);
    this.announce(id);
    return node;
  }

  addDevice(device: FakeDevice): void {
    this.devices.set(device.id, device);
    this.announce(device.id);
  }

  /** A global goes away: registries hear global_remove, bound proxies get remove_id. */
  remove(id: number): void {
    this.nodes.delete(id);
    this.devices.delete(id);
    for (const client of this.clients) {
      for (const registry of client.registries)
        this.send(client, registry, RegistryEvent.globalRemove, events.globalRemove(id));
      for (const [resourceId, resource] of client.resources)
        if (resource.globalId === id) {
          client.resources.delete(resourceId);
          client.freed.add(resourceId);
          this.send(client, 0, CoreEvent.removeId, events.removeId(resourceId));
        }
    }
  }

  setMetadata(key: string, value: string | null, type = "Spa:String:JSON"): void {
    if (value === null) this.metadata.delete(key);
    else this.metadata.set(key, { type, value });
    for (const client of this.clients)
      for (const [id, resource] of client.resources)
        if (resource.type === PwType.Metadata)
          this.send(
            client,
            id,
            MetadataEvent.property,
            events.property({ subject: 0, key, type: value === null ? null : type, value }),
          );
  }

  /** Ping every client; resolves with the seqs they answered. */
  ping(seq: number): void {
    for (const client of this.clients) this.send(client, 0, CoreEvent.ping, events.ping(0, seq));
  }

  pongs(): number[] {
    return [...this.clients].flatMap((client) => client.pongs);
  }

  /** Close every client connection, as a PipeWire restart does. */
  dropConnections(): void {
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
  }

  /** Slider volume of a node's loudest channel. */
  volumeOf(id: number): number {
    return Math.cbrt(Math.max(...this.nodes.get(id)!.volumes));
  }

  async close(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    fs.rmSync(path.dirname(this.path), { recursive: true, force: true });
  }

  // ── protocol ───────────────────────────────────────────────────────────

  private record(call: string) {
    this.calls.push(call);
    this.onCall?.(call);
  }

  private accept(socket: net.Socket) {
    const client: Client = {
      socket,
      reader: new MessageReader(false),
      resources: new Map(),
      registries: new Set(),
      props: {},
      pongs: [],
      freed: new Set(),
      maxId: 2,
    };
    this.clients.add(client);
    socket.on("data", (chunk) => {
      client.reader.push(chunk);
      for (let message = client.reader.next(); message; message = client.reader.next()) {
        if (this.hang) continue;
        try {
          this.handle(client, message);
        } catch (error) {
          this.send(
            client,
            0,
            CoreEvent.error,
            events.error(message.id, message.seq, -22, String(error)),
          );
        }
      }
    });
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => {});
  }

  private send(client: Client, id: number, opcode: number, args: readonly Pod[]) {
    if (!client.socket.destroyed) client.socket.write(encodeMessage(id, opcode, 0, args));
  }

  private globals() {
    const list: { id: number; type: string; props: Dict }[] = [
      { id: 0, type: PwType.Core, props: { "core.name": "pipewire-0" } },
    ];
    for (const node of this.nodes.values())
      list.push({ id: node.id, type: PwType.Node, props: node.props });
    for (const device of this.devices.values())
      list.push({ id: device.id, type: PwType.Device, props: device.props });
    if (this.wireplumber)
      list.push({ id: METADATA_ID, type: PwType.Metadata, props: { "metadata.name": "default" } });
    // A link and a port, which a control client may ignore.
    list.push({ id: 200, type: PwType.Port, props: { "port.name": "playback_FL" } });
    list.push({
      id: 201,
      type: PwType.Link,
      props: { "link.output.node": "74", "link.input.node": "52" },
    });
    return list;
  }

  private announce(id: number) {
    const global = this.globals().find((item) => item.id === id);
    if (!global) return;
    for (const client of this.clients)
      for (const registry of client.registries)
        this.send(
          client,
          registry,
          RegistryEvent.global,
          events.global({ ...global, permissions: 0o770, version: 3 }),
        );
  }

  private handle(client: Client, message: RawMessage) {
    const args = messageArgs(message);
    if (message.id === 0) return this.core(client, message.opcode, args);
    if (message.id === 1) {
      if (message.opcode === ClientMethod.updateProperties) client.props = decodeDict(args[0]!);
      return;
    }
    if (client.registries.has(message.id)) return this.registry(client, message.opcode, args);
    const resource = client.resources.get(message.id);
    if (!resource) throw new Error(`unknown resource ${message.id}`);
    if (resource.type === PwType.Node)
      return this.node(client, message.id, resource.globalId, message, args);
    if (resource.type === PwType.Device)
      return this.device(client, message.id, resource.globalId, message, args);
    if (resource.type === PwType.Metadata && message.opcode === MetadataMethod.setProperty) {
      const key = argString(args, 1);
      const value = argString(args, 3);
      if (argInt(args, 0) !== 0 || !key) throw new Error("bad metadata subject");
      this.record(`metadata ${key} ${value}`);
      this.setMetadata(key, value, argString(args, 2) ?? "");
      const kind = key.match(/^default\.configured\.audio\.(sink|source)$/)?.[1];
      if (kind && this.wireplumber) {
        const follow = () => {
          const name = value ? JSON.parse(value).name : null;
          if ([...this.nodes.values()].some((node) => node.props["node.name"] === name))
            this.setMetadata(`default.audio.${kind}`, value);
        };
        if (this.defaultDelayMs) setTimeout(follow, this.defaultDelayMs);
        else follow();
      }
    }
  }

  private core(client: Client, opcode: number, args: readonly Pod[]) {
    switch (opcode) {
      case CoreMethod.hello:
        this.send(
          client,
          0,
          CoreEvent.info,
          events.coreInfo({
            id: 0,
            cookie: 1234,
            userName: "moire",
            hostName: "fake",
            version: "1.4.0",
            name: "pipewire-0",
            props: {},
          }),
        );
        return;
      case CoreMethod.sync:
        this.send(client, 0, CoreEvent.done, events.done(argInt(args, 0), argInt(args, 1)));
        return;
      case CoreMethod.pong:
        client.pongs.push(argInt(args, 1));
        return;
      case CoreMethod.getRegistry: {
        const id = argInt(args, 1);
        client.registries.add(id);
        for (const global of this.globals())
          this.send(
            client,
            id,
            RegistryEvent.global,
            events.global({ ...global, permissions: 0o770, version: 3 }),
          );
        return;
      }
    }
  }

  private registry(client: Client, opcode: number, args: readonly Pod[]) {
    if (opcode !== RegistryMethod.bind) return;
    const globalId = argInt(args, 0);
    const type = argString(args, 1) ?? "";
    const newId = argInt(args, 3);
    // PipeWire maps client ids densely: a new id is a freed one or the next one.
    if (client.freed.has(newId)) client.freed.delete(newId);
    else if (newId === client.maxId + 1) client.maxId = newId;
    else throw new Error(`id ${newId} leaves a gap after ${client.maxId}`);
    const global = this.globals().find((item) => item.id === globalId);
    if (!global || global.type !== type) {
      this.send(
        client,
        0,
        CoreEvent.error,
        events.error(newId, 0, -2, `can't bind global ${globalId}`),
      );
      this.send(client, 0, CoreEvent.removeId, events.removeId(newId));
      client.freed.add(newId);
      return;
    }
    client.resources.set(newId, { type, globalId });
    this.send(client, 0, CoreEvent.boundId, events.boundId(newId, globalId));
    const node = this.nodes.get(globalId);
    const device = this.devices.get(globalId);
    if (type === PwType.Node && node)
      this.send(
        client,
        newId,
        ParamsEvent.info,
        events.nodeInfo({
          id: globalId,
          state: 2,
          error: null,
          props: node.props,
          params: [{ id: SpaParam.Props, flags: 7 }],
        }),
      );
    else if (type === PwType.Device && device)
      this.send(
        client,
        newId,
        ParamsEvent.info,
        events.deviceInfo({
          id: globalId,
          props: device.props,
          params: [SpaParam.Route, SpaParam.EnumRoute, SpaParam.Profile, SpaParam.EnumProfile].map(
            (id) => ({ id, flags: 7 }),
          ),
        }),
      );
    else if (type === PwType.Metadata)
      for (const [key, entry] of this.metadata)
        this.send(
          client,
          newId,
          MetadataEvent.property,
          events.property({ subject: 0, key, ...entry }),
        );
  }

  private replyParams(client: Client, resourceId: number, seq: number, id: number, params: Pod[]) {
    params.forEach((param, index) =>
      this.send(
        client,
        resourceId,
        ParamsEvent.param,
        events.param({ seq, id, index, next: index + 1, param }),
      ),
    );
  }

  private node(
    client: Client,
    resourceId: number,
    id: number,
    message: RawMessage,
    args: readonly Pod[],
  ) {
    const node = this.nodes.get(id);
    if (!node) throw new Error("node gone");
    if (message.opcode === ParamsMethod.enumParams) {
      if (argInt(args, 1) === SpaParam.Props)
        this.replyParams(client, resourceId, argInt(args, 0), SpaParam.Props, [nodeProps(node)]);
      return;
    }
    if (message.opcode !== ParamsMethod.setParam) return;
    if (this.refuse) {
      this.send(client, 0, CoreEvent.error, events.error(resourceId, message.seq, -1, this.refuse));
      return;
    }
    const param = argPod(args, 2);
    if (
      argInt(args, 0) !== SpaParam.Props ||
      param?.type !== "Object" ||
      param.objectType !== SpaObjectType.Props
    )
      throw new Error("bad node param");
    const volumes = podNumbers(podProp(param, SpaProp.channelVolumes));
    const mute = podBool(podProp(param, SpaProp.mute));
    this.record(
      `node ${id} props${volumes ? ` volume ${round(Math.cbrt(volumes[0]!))}x${volumes.length}` : ""}${mute === undefined ? "" : ` mute ${mute}`}`,
    );
    const apply = () => {
      if (volumes) node.volumes = volumes;
      if (mute !== undefined) node.mute = mute;
    };
    if (node.applyDelayMs) setTimeout(apply, node.applyDelayMs);
    else apply();
  }

  private device(
    client: Client,
    resourceId: number,
    id: number,
    message: RawMessage,
    args: readonly Pod[],
  ) {
    const device = this.devices.get(id);
    if (!device) throw new Error("device gone");
    if (message.opcode === ParamsMethod.enumParams) {
      const seq = argInt(args, 0);
      const which = argInt(args, 1);
      const params =
        which === SpaParam.Route
          ? device.routes.map((r) => routePod(r, SpaParam.Route, true))
          : which === SpaParam.EnumRoute
            ? device.availableRoutes.map((r) => routePod(r, SpaParam.EnumRoute, false))
            : which === SpaParam.Profile
              ? device.profiles
                  .filter((p) => p.index === device.profile)
                  .map((p) => profilePod(p, SpaParam.Profile))
              : which === SpaParam.EnumProfile
                ? device.profiles.map((p) => profilePod(p, SpaParam.EnumProfile))
                : [];
      this.replyParams(client, resourceId, seq, which, params);
      return;
    }
    if (message.opcode !== ParamsMethod.setParam) return;
    if (this.refuse) {
      this.send(client, 0, CoreEvent.error, events.error(resourceId, message.seq, -1, this.refuse));
      return;
    }
    const which = argInt(args, 0);
    const param = argPod(args, 2) ?? undefined;
    if (which === SpaParam.Profile) {
      const index = podNumber(podProp(param, SpaProfile.index));
      if (!device.profiles.some((p) => p.index === index)) throw new Error("no such profile");
      device.profile = index!;
      this.record(`device ${id} profile ${index}`);
      return;
    }
    if (which !== SpaParam.Route) throw new Error("bad device param");
    const index = podNumber(podProp(param, SpaRoute.index));
    const routeDevice = podNumber(podProp(param, SpaRoute.device));
    const active = device.routes.find((r) => r.index === index && r.device === routeDevice);
    if (!active) throw new Error("no such route");
    const props = podProp(param, SpaRoute.props);
    const volumes = podNumbers(podProp(props, SpaProp.channelVolumes));
    const mute = podBool(podProp(props, SpaProp.mute));
    const save = podBool(podProp(param, SpaRoute.save));
    this.record(
      `device ${id} route ${index}/${routeDevice}${volumes ? ` volume ${round(Math.cbrt(volumes[0]!))}x${volumes.length}` : ""}${mute === undefined ? "" : ` mute ${mute}`}${save ? " save" : ""}`,
    );
    if (volumes) active.volumes = volumes;
    if (mute !== undefined) active.mute = mute;
    // ACP mirrors the route onto the node it drives.
    for (const node of this.nodes.values())
      if (
        node.props["device.id"] === String(id) &&
        node.props["card.profile.device"] === String(routeDevice)
      ) {
        if (volumes) node.volumes = volumes;
        if (mute !== undefined) node.mute = mute;
      }
  }
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function json(id: number, fake: FakePipeWireServer) {
  return JSON.stringify({ name: fake.nodes.get(id)!.props["node.name"] });
}

export function route(
  index: number,
  device: number,
  direction: 0 | 1,
  name: string,
  description: string,
  volumes: number[],
  mute: boolean,
  available = true,
): FakeRoute {
  return { index, device, direction, name, description, available, volumes, mute };
}

function nodeProps(node: FakeNode): Pod {
  return P.object(SpaObjectType.Props, SpaParam.Props, {
    [SpaProp.volume]: P.float(1),
    [SpaProp.mute]: P.bool(node.mute),
    [SpaProp.channelVolumes]: P.floats(node.volumes),
    [SpaProp.channelMap]: P.ids(
      node.volumes.length === 1 ? [SpaChannel.MONO] : [SpaChannel.FL, SpaChannel.FR],
    ),
  });
}

function routePod(r: FakeRoute, id: number, withProps: boolean): Pod {
  return P.object(SpaObjectType.ParamRoute, id, {
    [SpaRoute.index]: P.int(r.index),
    [SpaRoute.direction]: P.id(r.direction),
    [SpaRoute.device]: P.int(r.device),
    [SpaRoute.name]: P.string(r.name),
    [SpaRoute.description]: P.string(r.description),
    [SpaRoute.priority]: P.int(100),
    [SpaRoute.available]: P.id(r.available ? SpaAvailability.yes : SpaAvailability.no),
    ...(withProps
      ? {
          [SpaRoute.props]: P.object(SpaObjectType.Props, id, {
            [SpaProp.mute]: P.bool(r.mute),
            [SpaProp.channelVolumes]: P.floats(r.volumes),
          }),
        }
      : {}),
  });
}

function profilePod(p: FakeProfile, id: number): Pod {
  return P.object(SpaObjectType.ParamProfile, id, {
    [SpaProfile.index]: P.int(p.index),
    [SpaProfile.name]: P.string(p.name),
    [SpaProfile.description]: P.string(p.description),
    [SpaProfile.available]: P.id(SpaAvailability.yes),
  });
}

export { sliderToLinear };
