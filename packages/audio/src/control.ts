/**
 * Sound devices, app streams and defaults over the native protocol, the way `wpctl` sees them.
 *
 * A read binds what it hasn't yet (audio nodes, audio devices, the `default` Metadata), then asks
 * every audio node for `Props` and every audio device for its routes and profiles in one batch
 * closed by one `sync`. Writes go where WirePlumber's mixer API puts them: the device's active
 * `Route` for a device-backed sink or source, else the node's `Props`; defaults go to
 * `default.configured.audio.*`. After a write the node is re-read until it shows the change or
 * `SETTLE_MS` passes (a stream's params travel to its app and back), and the snapshot returned is
 * what was read, never what was asked for.
 */
import {
  PipeWireConnection,
  PipeWireError,
  type ConnectionOptions,
  type Proxy,
} from "./connection";
import { P, podBool, podNumber, podNumbers, podProp, podString, type Pod } from "./pod";
import {
  ChangeMask,
  decode,
  MetadataEvent,
  MetadataMethod,
  methods,
  ParamsEvent,
  ParamsMethod,
  type Dict,
  type GlobalInfo,
} from "./protocol";
import {
  PwType,
  PwVersion,
  SpaAvailability,
  SpaDirection,
  SpaObjectType,
  SpaParam,
  SpaProfile,
  SpaProp,
  SpaRoute,
} from "./spa";

export type AudioNodeKind = "sink" | "source" | "playback" | "capture";

export type AudioNode = {
  readonly id: number;
  /** `object.serial`: unlike the id, never reused. */
  readonly serial: string;
  /** `node.name`, the stable name defaults are stored by. */
  readonly name: string;
  /** What people see: `node.description`, `node.nick` or `node.name` (may be empty). */
  readonly description: string;
  readonly kind: AudioNodeKind;
  /** For streams: `application.name` and `media.name`. */
  readonly app: string | null;
  readonly media: string | null;
  /** Slider volume (cubic) of the loudest channel; null when the node has no volume. */
  readonly volume: number | null;
  readonly muted: boolean | null;
  readonly channels: number;
  readonly deviceId: number | null;
  /** `card.profile.device`: which of the device's routes drives this node. */
  readonly profileDevice: number | null;
};

export type AudioRoute = {
  readonly index: number;
  readonly device: number;
  readonly direction: "input" | "output";
  readonly name: string;
  readonly description: string;
  readonly available: boolean | null;
};

export type AudioProfile = {
  readonly index: number;
  readonly name: string;
  readonly description: string;
  readonly available: boolean | null;
};

export type AudioDeviceInfo = {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  /** Active routes (one per device-side port in use). */
  readonly routes: readonly AudioRoute[];
  /** Every route the device offers. */
  readonly availableRoutes: readonly AudioRoute[];
  readonly profiles: readonly AudioProfile[];
  readonly profile: number | null;
};

export type AudioSnapshot = {
  readonly nodes: readonly AudioNode[];
  readonly devices: readonly AudioDeviceInfo[];
  /** `node.name` of the effective defaults (WirePlumber's `default.audio.*`). */
  readonly defaultSink: string | null;
  readonly defaultSource: string | null;
  /** Whether a session manager publishes defaults at all. */
  readonly hasDefaults: boolean;
};

export type AudioControlOptions = ConnectionOptions & {
  /** How long a write waits for its readback to show the change. */
  settleMs?: number;
};

/** Lists are cut here; nobody has more devices or playing apps than fit a page. */
const MAX_NODES = 128;
const SETTLE_MS = 500;
const SETTLE_STEP_MS = 20;
const NODE_KINDS: Readonly<Record<string, AudioNodeKind>> = {
  "Audio/Sink": "sink",
  "Audio/Source": "source",
  "Audio/Source/Virtual": "source",
  "Stream/Output/Audio": "playback",
  "Stream/Input/Audio": "capture",
};

type Bound =
  | { kind: "node"; proxy: Proxy; global: GlobalInfo; props: Dict }
  | { kind: "device"; proxy: Proxy; global: GlobalInfo; props: Dict }
  | { kind: "metadata"; proxy: Proxy; global: GlobalInfo; values: Map<string, string> };

/** Slider scale, to 4 places: the wire is float32, and noise below that only defeats equality. */
const slider = (linear: number) => Math.round(Math.cbrt(Math.max(0, linear)) * 10000) / 10000;
const linear = (volume: number) => volume ** 3;
const intProp = (dict: Dict, key: string) => {
  const value = dict[key];
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
};

/** `{"name":"alsa_output…"}` as WirePlumber stores defaults. */
export function parseDefaultName(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      typeof parsed.name === "string"
      ? parsed.name
      : null;
  } catch {
    return null;
  }
}

function availability(pod: Pod | undefined): boolean | null {
  const value = podNumber(pod);
  return value === SpaAvailability.yes ? true : value === SpaAvailability.no ? false : null;
}

function readRoute(pod: Pod): AudioRoute | null {
  const index = podNumber(podProp(pod, SpaRoute.index));
  const device = podNumber(podProp(pod, SpaRoute.device));
  if (index === undefined || device === undefined) return null;
  return {
    index,
    device,
    direction:
      podNumber(podProp(pod, SpaRoute.direction)) === SpaDirection.output ? "output" : "input",
    name: podString(podProp(pod, SpaRoute.name)) ?? "",
    description: podString(podProp(pod, SpaRoute.description)) ?? "",
    available: availability(podProp(pod, SpaRoute.available)),
  };
}

function readProfile(pod: Pod): AudioProfile | null {
  const index = podNumber(podProp(pod, SpaProfile.index));
  if (index === undefined) return null;
  return {
    index,
    name: podString(podProp(pod, SpaProfile.name)) ?? "",
    description: podString(podProp(pod, SpaProfile.description)) ?? "",
    available: availability(podProp(pod, SpaProfile.available)),
  };
}

/** Volume and mute from a node's `Props` (the first one that has them). */
function readLevels(params: readonly Pod[]) {
  for (const props of params) {
    const volumes = podNumbers(podProp(props, SpaProp.channelVolumes));
    const mute = podBool(podProp(props, SpaProp.mute));
    if (volumes?.length || mute !== undefined)
      return {
        volume: volumes?.length ? slider(Math.max(...volumes)) : null,
        muted: mute ?? null,
        channels: volumes?.length ?? 0,
      };
  }
  return { volume: null, muted: null, channels: 0 };
}

export class AudioControl {
  private connection: PipeWireConnection | null = null;
  private connecting: Promise<PipeWireConnection> | null = null;
  private readonly bound = new Map<number, Bound>();
  /** Param replies by request seq; a request's list is complete once a later sync returns. */
  private readonly replies = new Map<number, Pod[]>();
  private paramSeq = 0;
  private disposed = false;
  /** Aborts a connection still in its handshake when the control closes. */
  private readonly scope = new AbortController();

  constructor(private readonly options: AudioControlOptions = {}) {}

  async read(signal?: AbortSignal): Promise<AudioSnapshot> {
    const connection = await this.connect(signal);
    await connection.sync(signal);
    if (this.bindNew(connection)) await connection.sync(signal);
    const nodeRequests = new Map<number, number>();
    const deviceRequests = new Map<
      number,
      Record<"route" | "routes" | "profile" | "profiles", number>
    >();
    for (const [id, bound] of this.bound) {
      if (bound.proxy.removed) continue;
      if (bound.kind === "node")
        nodeRequests.set(id, this.enumParams(connection, bound.proxy, SpaParam.Props));
      else if (bound.kind === "device")
        deviceRequests.set(id, {
          route: this.enumParams(connection, bound.proxy, SpaParam.Route),
          routes: this.enumParams(connection, bound.proxy, SpaParam.EnumRoute),
          profile: this.enumParams(connection, bound.proxy, SpaParam.Profile),
          profiles: this.enumParams(connection, bound.proxy, SpaParam.EnumProfile),
        });
    }
    const all = [...nodeRequests.values(), ...[...deviceRequests.values()].flatMap(Object.values)];
    try {
      await connection.sync(signal);
    } finally {
      // Taken below; anything left (an abort) is dropped here.
      if (signal?.aborted) for (const seq of all) this.replies.delete(seq);
    }
    const take = (seq: number) => {
      const params = this.replies.get(seq) ?? [];
      this.replies.delete(seq);
      return params;
    };
    const nodes: AudioNode[] = [];
    const devices: AudioDeviceInfo[] = [];
    let metadata: Map<string, string> | null = null;
    for (const [id, bound] of this.bound) {
      if (bound.kind === "metadata") {
        if (!bound.proxy.removed) metadata = bound.values;
        continue;
      }
      if (bound.kind === "node") {
        const seq = nodeRequests.get(id);
        if (seq === undefined) continue;
        const props = bound.props;
        const kind = NODE_KINDS[props["media.class"] ?? bound.global.props["media.class"] ?? ""];
        if (!kind) continue;
        const name = props["node.name"] ?? bound.global.props["node.name"] ?? "";
        nodes.push({
          id,
          serial: props["object.serial"] ?? bound.global.props["object.serial"] ?? "",
          name,
          description: props["node.description"] || props["node.nick"] || name,
          kind,
          app: props["application.name"] ?? null,
          media: props["media.name"] ?? null,
          ...readLevels(take(seq)),
          deviceId: intProp(props, "device.id"),
          profileDevice: intProp(props, "card.profile.device"),
        });
      } else {
        const seqs = deviceRequests.get(id);
        if (!seqs) continue;
        const props = bound.props;
        const profile = take(seqs.profile).map(readProfile)[0];
        devices.push({
          id,
          name: props["device.name"] ?? "",
          description:
            props["device.description"] ||
            props["device.nick"] ||
            props["device.name"] ||
            `Device ${id}`,
          routes: take(seqs.route).flatMap((pod) => readRoute(pod) ?? []),
          availableRoutes: take(seqs.routes).flatMap((pod) => readRoute(pod) ?? []),
          profiles: take(seqs.profiles).flatMap((pod) => readProfile(pod) ?? []),
          profile: profile?.index ?? null,
        });
      }
    }
    nodes.sort((a, b) => a.id - b.id).splice(MAX_NODES);
    devices.sort((a, b) => a.id - b.id).splice(MAX_NODES);
    return {
      nodes,
      devices,
      defaultSink: parseDefaultName(metadata?.get("default.audio.sink")),
      defaultSource: parseDefaultName(metadata?.get("default.audio.source")),
      hasDefaults: metadata !== null,
    };
  }

  /** Set a sink, source or stream to a slider volume (0..1, cubic), every channel alike. */
  async setVolume(nodeId: number, volume: number, signal?: AbortSignal): Promise<AudioSnapshot> {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1)
      throw new PipeWireError("error", "Volume must be between 0 and 1.");
    return this.writeLevels(
      nodeId,
      (node) => ({
        [SpaProp.channelVolumes]: P.floats(
          Array.from({ length: Math.max(1, node.channels) }, () => linear(volume)),
        ),
      }),
      (node) => node.volume !== null && Math.abs(node.volume - volume) < 0.005,
      signal,
    );
  }

  async setMute(nodeId: number, muted: boolean, signal?: AbortSignal): Promise<AudioSnapshot> {
    return this.writeLevels(
      nodeId,
      () => ({ [SpaProp.mute]: P.bool(muted) }),
      (node) => node.muted === muted,
      signal,
    );
  }

  /** Choose the default output or input, as `wpctl set-default` does, and wait for it to apply. */
  async setDefault(
    kind: "sink" | "source",
    nodeId: number,
    signal?: AbortSignal,
  ): Promise<AudioSnapshot> {
    const before = await this.read(signal);
    const node = before.nodes.find((item) => item.id === nodeId && item.kind === kind);
    if (!node) throw new PipeWireError("error", "That device is no longer connected.");
    const metadata = [...this.bound.values()].find(
      (bound): bound is Extract<Bound, { kind: "metadata" }> =>
        bound.kind === "metadata" && !bound.proxy.removed,
    );
    if (!metadata)
      throw new PipeWireError("unavailable", "No session manager (WirePlumber) is running.");
    const connection = await this.connect(signal);
    const errors = metadata.proxy.errors.length;
    connection.call(
      metadata.proxy,
      MetadataMethod.setProperty,
      methods.setProperty(
        0,
        `default.configured.audio.${kind}`,
        "Spa:String:JSON",
        JSON.stringify({ name: node.name }),
      ),
    );
    await connection.sync(signal);
    this.checkErrors(metadata.proxy, errors);
    return this.settle(
      (snapshot) => (kind === "sink" ? snapshot.defaultSink : snapshot.defaultSource) === node.name,
      signal,
    );
  }

  /** Switch a device to one of its profiles (remembered, like choosing it in pavucontrol). */
  async setProfile(deviceId: number, index: number, signal?: AbortSignal): Promise<AudioSnapshot> {
    const before = await this.read(signal);
    const device = before.devices.find((item) => item.id === deviceId);
    if (!device?.profiles.some((profile) => profile.index === index))
      throw new PipeWireError("error", "That profile is not available.");
    const bound = this.bound.get(deviceId)!;
    const connection = await this.connect(signal);
    const errors = bound.proxy.errors.length;
    connection.call(
      bound.proxy,
      ParamsMethod.setParam,
      methods.setParam(
        SpaParam.Profile,
        0,
        P.object(SpaObjectType.ParamProfile, SpaParam.Profile, {
          [SpaProfile.index]: P.int(index),
          [SpaProfile.save]: P.bool(true),
        }),
      ),
    );
    await connection.sync(signal);
    this.checkErrors(bound.proxy, errors);
    return this.settle(
      (snapshot) => snapshot.devices.find((item) => item.id === deviceId)?.profile === index,
      signal,
    );
  }

  close(): void {
    this.disposed = true;
    this.scope.abort();
    this.connection?.close();
    this.connection = null;
    this.bound.clear();
    this.replies.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async writeLevels(
    nodeId: number,
    props: (node: AudioNode) => Record<number, Pod>,
    applied: (node: AudioNode) => boolean,
    signal?: AbortSignal,
  ): Promise<AudioSnapshot> {
    const before = await this.read(signal);
    const node = before.nodes.find((item) => item.id === nodeId);
    if (!node) throw new PipeWireError("error", "That device or app is gone.");
    const connection = await this.connect(signal);
    const route = this.activeRoute(before, node);
    const target = route ? this.bound.get(node.deviceId!) : this.bound.get(nodeId);
    if (!target || target.proxy.removed)
      throw new PipeWireError("error", "That device or app is gone.");
    const errors = target.proxy.errors.length;
    if (route) {
      connection.call(
        target.proxy,
        ParamsMethod.setParam,
        methods.setParam(
          SpaParam.Route,
          0,
          P.object(SpaObjectType.ParamRoute, SpaParam.Route, {
            [SpaRoute.index]: P.int(route.index),
            [SpaRoute.device]: P.int(route.device),
            [SpaRoute.props]: P.object(SpaObjectType.Props, SpaParam.Route, props(node)),
            [SpaRoute.save]: P.bool(true),
          }),
        ),
      );
    } else {
      connection.call(
        target.proxy,
        ParamsMethod.setParam,
        methods.setParam(
          SpaParam.Props,
          0,
          P.object(SpaObjectType.Props, SpaParam.Props, props(node)),
        ),
      );
    }
    await connection.sync(signal);
    this.checkErrors(target.proxy, errors);
    return this.settle((snapshot) => {
      const after = snapshot.nodes.find((item) => item.id === nodeId);
      return !after || applied(after);
    }, signal);
  }

  /** The device route behind a sink or source, if it has one. */
  private activeRoute(snapshot: AudioSnapshot, node: AudioNode): AudioRoute | null {
    if (node.deviceId === null || node.profileDevice === null) return null;
    if (node.kind !== "sink" && node.kind !== "source") return null;
    const device = snapshot.devices.find((item) => item.id === node.deviceId);
    const direction = node.kind === "sink" ? "output" : "input";
    return (
      device?.routes.find(
        (route) => route.device === node.profileDevice && route.direction === direction,
      ) ?? null
    );
  }

  private async settle(done: (snapshot: AudioSnapshot) => boolean, signal?: AbortSignal) {
    const deadline = performance.now() + (this.options.settleMs ?? SETTLE_MS);
    for (;;) {
      const snapshot = await this.read(signal);
      if (done(snapshot) || performance.now() >= deadline) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_STEP_MS));
    }
  }

  private checkErrors(proxy: Proxy, before: number) {
    const error = proxy.errors.slice(before).at(-1);
    if (error)
      throw new PipeWireError(
        "error",
        `PipeWire refused the change: ${error.message || `error ${error.res}`}`,
      );
  }

  private enumParams(connection: PipeWireConnection, proxy: Proxy, id: number): number {
    const seq = (this.paramSeq = (this.paramSeq + 1) & 0x3fffffff);
    this.replies.set(seq, []);
    connection.call(proxy, ParamsMethod.enumParams, methods.enumParams(seq, id, 0, 0, null));
    return seq;
  }

  private async connect(signal?: AbortSignal): Promise<PipeWireConnection> {
    if (this.disposed) throw new PipeWireError("error", "Audio control is closed.");
    if (signal?.aborted) throw new PipeWireError("cancelled", "Audio request cancelled.");
    if (this.connection && !this.connection.isClosed) return this.connection;
    this.connecting ??= PipeWireConnection.open({
      name: "Moire",
      ...this.options,
      signal: this.scope.signal,
    })
      .then((connection) => {
        if (this.disposed) {
          connection.close();
          throw new PipeWireError("error", "Audio control is closed.");
        }
        this.bound.clear();
        this.replies.clear();
        this.connection = connection;
        connection.onRegistryChange = () => {
          for (const [id, bound] of this.bound)
            if (!connection.globals.has(id) || bound.proxy.removed) this.bound.delete(id);
        };
        connection.onClose = () => {
          if (this.connection === connection) this.connection = null;
        };
        return connection;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  /** Bind audio nodes, audio devices and the `default` metadata not yet bound. */
  private bindNew(connection: PipeWireConnection): boolean {
    let any = false;
    for (const global of connection.globals.values()) {
      if (this.bound.has(global.id)) continue;
      const mediaClass = global.props["media.class"] ?? "";
      if (global.type === PwType.Node && NODE_KINDS[mediaClass]) {
        const entry: Bound = { kind: "node", proxy: null!, global, props: global.props };
        entry.proxy = connection.bind(global, PwVersion.Node, {
          [ParamsEvent.info]: (args) => {
            const info = decode.nodeInfo(args);
            if (info.changeMask === undefined || info.changeMask & ChangeMask.nodeProps)
              entry.props = info.props;
          },
          [ParamsEvent.param]: (args) => this.collect(args),
        });
        this.bound.set(global.id, entry);
      } else if (global.type === PwType.Device && mediaClass === "Audio/Device") {
        const entry: Bound = { kind: "device", proxy: null!, global, props: global.props };
        entry.proxy = connection.bind(global, PwVersion.Device, {
          [ParamsEvent.info]: (args) => {
            const info = decode.deviceInfo(args);
            if (info.changeMask === undefined || info.changeMask & ChangeMask.deviceProps)
              entry.props = info.props;
          },
          [ParamsEvent.param]: (args) => this.collect(args),
        });
        this.bound.set(global.id, entry);
      } else if (global.type === PwType.Metadata && global.props["metadata.name"] === "default") {
        const values = new Map<string, string>();
        const proxy = connection.bind(global, PwVersion.Metadata, {
          [MetadataEvent.property]: (args) => {
            const property = decode.property(args);
            if (property.subject !== 0) return;
            if (property.key === null) values.clear();
            else if (property.value === null) values.delete(property.key);
            else values.set(property.key, property.value);
          },
        });
        this.bound.set(global.id, { kind: "metadata", proxy, global, values });
      } else continue;
      any = true;
    }
    return any;
  }

  private collect(args: readonly Pod[]) {
    const event = decode.param(args);
    const list = this.replies.get(event.seq);
    if (list && event.param && list.length < 256) list.push(event.param);
  }
}
