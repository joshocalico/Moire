/**
 * xdg-activation through a public `Window`: a token request names the window's surface, app id
 * and latest input serial; the compositor's answer resolves the promise; activation sends the
 * token with the surface; `sync` is a display roundtrip. Without the global there is no token and
 * nothing is sent. Only the display transport is replaced.
 */
import assert from "node:assert/strict";
import {
  MessageBuilder,
  MessageReader,
  decodeHeader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import { wlCompositor } from "@moire/protocol/generated";
import { xdgActivationTokenV1, xdgActivationV1 } from "@moire/protocol/xdg-activation";
import type { PlatformWindowOpts } from "#ui/platform";
import { Window } from "#ui/window";
import { WaylandPlatform, WaylandWindow } from "./index";

const COMPOSITOR = 100,
  WM_BASE = 101,
  SEAT = 103,
  ACTIVATION = 104,
  SERIAL = 47;

class ActivationWire extends WaylandPlatform {
  readonly messages: EncodedWaylandMessage[] = [];
  readonly wireHandlers = new Map<number, Parameters<WaylandPlatform["setHandler"]>[1]>();
  roundtrips = 0;
  constructor(private readonly activation: number) {
    super();
  }
  override async connect(): Promise<void> {
    throw new Error("Activation fixture must not connect to a display");
  }
  override getCompositorId(): number {
    return COMPOSITOR;
  }
  override getWmBaseId(): number {
    return WM_BASE;
  }
  override getDecoManagerId(): number {
    return 0;
  }
  override getSeatId(): number {
    return SEAT;
  }
  override getLastPointerSerial(): number {
    return SERIAL;
  }
  override getActivationId(): number {
    return this.activation;
  }
  override async roundtrip(): Promise<void> {
    this.roundtrips++;
  }
  override createWindow(opts: PlatformWindowOpts): WaylandWindow {
    const window = new WaylandWindow(this, opts);
    window.create();
    return window;
  }
  override sendMessage(message: EncodedWaylandMessage): void {
    this.messages.push(message);
  }
  override setHandler(id: number, handler: Parameters<WaylandPlatform["setHandler"]>[1]): void {
    this.wireHandlers.set(id, handler);
  }
  override clearHandler(id: number): void {
    this.wireHandlers.delete(id);
  }
  requests(target: number, opcode: number): MessageReader[] {
    return this.messages
      .filter((message) => {
        const header = decodeHeader(message.data);
        return header.objectId === target && header.opcode === opcode;
      })
      .map((message) => new MessageReader(message.data, message.fds));
  }
  request(target: number, opcode: number): MessageReader {
    const found = this.requests(target, opcode);
    assert.equal(found.length, 1, `expected one wire request ${target}:${opcode}`);
    return found[0]!;
  }
}

function open(wire: ActivationWire): { window: Window; surface: number } {
  const window = new Window({
    title: "Activation",
    appId: "org.example.Activation",
    width: 320,
    height: 200,
    decorated: false,
  });
  window.mount(wire);
  const surface = wire.request(COMPOSITOR, wlCompositor.requests.createSurface.opcode).newId();
  return { window, surface };
}

{
  const wire = new ActivationWire(ACTIVATION);
  const { window, surface } = open(wire);
  const pending = window.requestActivationToken();
  const tokenId = wire
    .request(ACTIVATION, xdgActivationV1.requests.getActivationToken.opcode)
    .newId();
  const serial = wire.request(tokenId, xdgActivationTokenV1.requests.setSerial.opcode);
  assert.equal(serial.uint(), SERIAL, "the token carries the latest input serial");
  assert.equal(serial.object(), SEAT);
  assert.equal(
    wire.request(tokenId, xdgActivationTokenV1.requests.setAppId.opcode).string(),
    "org.example.Activation",
  );
  assert.equal(
    wire.request(tokenId, xdgActivationTokenV1.requests.setSurface.opcode).object(),
    surface,
    "the token names this window's surface",
  );
  wire.request(tokenId, xdgActivationTokenV1.requests.commit.opcode);
  const done = new MessageBuilder();
  done.string("moire-token");
  const message = done.build(tokenId, xdgActivationTokenV1.events.done.opcode);
  const handler = wire.wireHandlers.get(tokenId);
  assert.ok(handler, "the token object has a handler until it is done");
  handler(xdgActivationTokenV1.events.done.opcode, new MessageReader(message.data, message.fds));
  assert.equal(await pending, "moire-token");
  assert.equal(wire.wireHandlers.has(tokenId), false, "the token object is released");
  wire.request(tokenId, xdgActivationTokenV1.requests.destroy.opcode);

  window.activate("handed-over");
  const activate = wire.request(ACTIVATION, xdgActivationV1.requests.activate.opcode);
  assert.equal(activate.string(), "handed-over");
  assert.equal(activate.object(), surface, "activation names this window's surface");

  await window.sync();
  assert.equal(wire.roundtrips, 1, "sync is one display roundtrip");
  window.destroy();
}

{
  // A compositor without xdg_activation_v1: no token, and activation sends nothing.
  const wire = new ActivationWire(0);
  const { window } = open(wire);
  assert.equal(await window.requestActivationToken(), null);
  const before = wire.messages.length;
  window.activate("ignored");
  assert.equal(wire.messages.length, before, "nothing is sent without the global");
  window.destroy();
}

{
  // A window that is not mounted has no token and never throws.
  const window = new Window({ title: "Unmounted", appId: "org.example.None", width: 1, height: 1 });
  assert.equal(await window.requestActivationToken(), null);
  window.activate("ignored");
  await window.sync();
}

console.log("[ui/activation] token request, activation, sync and absent global ok");
