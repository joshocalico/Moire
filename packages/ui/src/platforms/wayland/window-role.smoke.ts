import assert from "node:assert/strict";
import {
  MessageBuilder,
  MessageReader,
  decodeHeader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import {
  wlCompositor,
  wlSurface,
  xdgPopup,
  xdgPositioner,
  xdgSurface,
  xdgToplevel,
  xdgWmBase,
  zxdgDecorationManagerV1,
  zxdgToplevelDecorationV1,
} from "@moire/protocol/generated";
import type { PlatformWindowOpts } from "#ui/platform";
import { Window } from "#ui/window";
import { WaylandPlatform, WaylandWindow } from "./index";

/** Only the display transport is replaced; role creation/event handlers are production code. */
class RoleWire extends WaylandPlatform {
  readonly messages: EncodedWaylandMessage[] = [];
  readonly wireHandlers = new Map<number, Parameters<WaylandPlatform["setHandler"]>[1]>();
  readonly nativeWindows: WaylandWindow[] = [];

  override async connect(): Promise<void> {
    throw new Error("Role fixture must not connect to a display");
  }
  override getCompositorId(): number {
    return 100;
  }
  override getWmBaseId(): number {
    return 101;
  }
  override getDecoManagerId(): number {
    return 102;
  }
  override getSeatId(): number {
    return 103;
  }
  override getLastPointerSerial(): number {
    return 47;
  }
  override createWindow(opts: PlatformWindowOpts): WaylandWindow {
    const window = new WaylandWindow(this, opts);
    this.nativeWindows.push(window);
    window.create();
    return window;
  }
  override sendMessage(message: EncodedWaylandMessage, fds: number[] = []): void {
    assert.equal(message.fds.length + fds.length, 0, "bufferless fixture opens no native FDs");
    this.messages.push(message);
  }
  override setHandler(id: number, handler: Parameters<WaylandPlatform["setHandler"]>[1]): void {
    this.wireHandlers.set(id, handler);
  }
  override clearHandler(id: number): void {
    this.wireHandlers.delete(id);
  }
  requests(target: number, opcode: number): EncodedWaylandMessage[] {
    return this.messages.filter((message) => {
      const header = decodeHeader(message.data);
      return header.objectId === target && header.opcode === opcode;
    });
  }
  request(target: number, opcode: number): EncodedWaylandMessage {
    const messages = this.requests(target, opcode);
    assert.equal(messages.length, 1, `expected one actual wire request ${target}:${opcode}`);
    const message = messages[0];
    assert.ok(message);
    return message;
  }
  dispatch(target: number, opcode: number, builder: MessageBuilder): void {
    const handler = this.wireHandlers.get(target);
    assert.ok(handler, `missing production wire handler ${target}`);
    const message = builder.build(target, opcode);
    handler(opcode, new MessageReader(message.data, message.fds));
  }
}

function payload(message: EncodedWaylandMessage): MessageReader {
  return new MessageReader(message.data, message.fds);
}

const teardownFailures: string[] = [];
for (const decorated of [undefined, false]) {
  const wire = new RoleWire();
  const window = new Window({
    title: "Role lifecycle",
    appId: "moire.role-fixture",
    width: 400,
    height: 240,
    decorated,
  });
  let closed = 0;
  let allowClose = false;
  window.setCloseGuard(() => allowClose);
  window.onClose(() => closed++);
  window.mount(wire);
  const native = wire.nativeWindows[0];
  assert.ok(native);
  const surface = payload(wire.request(100, wlCompositor.requests.createSurface.opcode)).newId();
  const xdg = payload(wire.request(101, xdgWmBase.requests.getXdgSurface.opcode));
  const xdgId = xdg.newId();
  assert.equal(xdg.object(), surface);
  const top = payload(wire.request(xdgId, xdgSurface.requests.getToplevel.opcode)).newId();
  const decoration = payload(
    wire.request(102, zxdgDecorationManagerV1.requests.getToplevelDecoration.opcode),
  );
  const decorationId = decoration.newId();
  assert.equal(decoration.object(), top, "decoration belongs to this actual toplevel");
  const mode = payload(
    wire.request(decorationId, zxdgToplevelDecorationV1.requests.setMode.opcode),
  );
  assert.equal(
    mode.uint(),
    decorated === false
      ? zxdgToplevelDecorationV1.enums.mode.clientSide
      : zxdgToplevelDecorationV1.enums.mode.serverSide,
    "default windows request SSD; explicit client chrome requests CSD",
  );
  assert.equal(
    payload(wire.request(top, xdgToplevel.requests.setTitle.opcode)).string(),
    window.title,
  );
  assert.equal(
    payload(wire.request(top, xdgToplevel.requests.setAppId.opcode)).string(),
    window.appId,
  );
  assert.ok(
    wire.messages.indexOf(
      wire.request(decorationId, zxdgToplevelDecorationV1.requests.setMode.opcode),
    ) < wire.messages.indexOf(wire.request(surface, wlSurface.requests.commit.opcode)),
    "decoration request precedes the initial commit",
  );

  wire.dispatch(top, xdgToplevel.events.close.opcode, new MessageBuilder());
  assert.equal(window.isClosed(), false, "native close still obeys the public close guard");
  assert.equal(wire.requests(top, xdgToplevel.requests.destroy.opcode).length, 0);
  const lateClose = wire.wireHandlers.get(top);
  assert.ok(lateClose);
  allowClose = true;
  wire.dispatch(top, xdgToplevel.events.close.opcode, new MessageBuilder());
  assert.equal(window.isClosed(), true);
  assert.equal(closed, 1);
  window.destroy();
  native.destroy();
  assert.equal(wire.requests(top, xdgToplevel.requests.destroy.opcode).length, 1);
  assert.equal(wire.requests(xdgId, xdgSurface.requests.destroy.opcode).length, 1);
  assert.equal(wire.requests(surface, wlSurface.requests.destroy.opcode).length, 1);
  const decorationDestructions = wire.requests(
    decorationId,
    zxdgToplevelDecorationV1.requests.destroy.opcode,
  );
  if (decorationDestructions.length !== 1)
    teardownFailures.push(`missing ${decorated === false ? "CSD" : "SSD"} decoration destruction`);
  const decorationDestroy = decorationDestructions[0];
  if (decorationDestroy)
    assert.ok(
      wire.messages.indexOf(decorationDestroy) <
        wire.messages.indexOf(wire.request(top, xdgToplevel.requests.destroy.opcode)),
      "decoration ownership ends before its toplevel",
    );
  if (wire.wireHandlers.size !== 0)
    teardownFailures.push(`remaining role handlers: ${[...wire.wireHandlers.keys()].join(",")}`);
  const lateMessage = new MessageBuilder().build(top, xdgToplevel.events.close.opcode);
  lateClose(xdgToplevel.events.close.opcode, payload(lateMessage));
  assert.equal(closed, 1, "late close after destruction cannot notify the public owner twice");
}

const wire = new RoleWire();
const parent = wire.createWindow({
  title: "Parent",
  appId: "moire.parent",
  width: 400,
  height: 240,
});
const start = wire.messages.length;
const popup = new WaylandWindow(
  wire,
  { title: "Menu", appId: "moire.menu", width: 160, height: 120, resizable: false },
  { parent, width: 160, height: 120, anchorX: 25, anchorY: 30, grab: true },
);
let dismissed = 0;
popup.onClose(() => dismissed++);
popup.create();
const popupMessages = wire.messages.slice(start);
const createSurface = popupMessages[0];
assert.ok(createSurface);
assert.equal(decodeHeader(createSurface.data).objectId, 100);
assert.equal(decodeHeader(createSurface.data).opcode, wlCompositor.requests.createSurface.opcode);
const surface = payload(createSurface).newId();
const xdgId = popup.getXdgSurfaceId();
assert.equal(wire.requests(xdgId, xdgSurface.requests.getToplevel.opcode).length, 0);
assert.equal(
  popupMessages.some((message) => decodeHeader(message.data).objectId === 102),
  false,
  "native menus allocate no decoration object",
);
const positionerRequest = popupMessages.find((message) => {
  const header = decodeHeader(message.data);
  return header.objectId === 101 && header.opcode === xdgWmBase.requests.createPositioner.opcode;
});
assert.ok(positionerRequest);
const positioner = payload(positionerRequest).newId();
const size = payload(wire.request(positioner, xdgPositioner.requests.setSize.opcode));
assert.deepEqual([size.int(), size.int()], [160, 120]);
const anchor = payload(wire.request(positioner, xdgPositioner.requests.setAnchorRect.opcode));
assert.deepEqual([anchor.int(), anchor.int(), anchor.int(), anchor.int()], [25, 30, 1, 1]);
const popupRole = payload(wire.request(xdgId, xdgSurface.requests.getPopup.opcode));
const popupId = popupRole.newId();
assert.equal(
  popupRole.object(),
  parent.getXdgSurfaceId(),
  "popup is anchored to its native parent",
);
assert.equal(popupRole.object(), positioner);
const grab = payload(wire.request(popupId, xdgPopup.requests.grab.opcode));
assert.deepEqual(
  [grab.object(), grab.uint()],
  [103, 47],
  "popup grab uses the actual seat/input serial",
);
wire.dispatch(popupId, xdgPopup.events.popupDone.opcode, new MessageBuilder());
assert.equal(dismissed, 1, "native dismissal reaches the popup owner");
const beforeDestroy = wire.messages.length;
popup.destroy();
assert.equal(wire.requests(popupId, xdgPopup.requests.destroy.opcode).length, 1);
assert.equal(wire.requests(xdgId, xdgSurface.requests.destroy.opcode).length, 1);
assert.equal(wire.requests(surface, wlSurface.requests.destroy.opcode).length, 1);
const destructionCount = wire.messages.length;
popup.destroy();
assert.equal(wire.messages.length, destructionCount, "popup destruction is idempotent");
assert.ok(destructionCount > beforeDestroy);
assert.equal(wire.wireHandlers.has(popupId), false);
assert.equal(wire.wireHandlers.has(xdgId), false);
parent.destroy();

assert.deepEqual(teardownFailures, [], "native decoration ownership must end with the toplevel");
console.log(
  "[ui/window-role-smoke] actual SSD/CSD/popup wire roles and public close lifecycle pass",
);
