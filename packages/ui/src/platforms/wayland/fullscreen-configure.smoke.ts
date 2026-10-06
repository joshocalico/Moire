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
  xdgSurface,
  xdgToplevel,
  xdgWmBase,
} from "@moire/protocol/generated";
import { WaylandPlatform, WaylandWindow } from "./index";

/** Mock only transport. Window creation and configure handlers remain production code. */
class WirePlatform extends WaylandPlatform {
  readonly messages: EncodedWaylandMessage[] = [];
  readonly wireHandlers = new Map<number, Parameters<WaylandPlatform["setHandler"]>[1]>();

  override async connect(): Promise<void> {
    throw new Error("The protocol fixture must never connect to a real display");
  }

  override getCompositorId(): number {
    return 100;
  }

  override getWmBaseId(): number {
    return 101;
  }

  override getDecoManagerId(): number {
    return 0;
  }

  override sendMessage(message: EncodedWaylandMessage, fds: number[] = []): void {
    assert.equal(fds.length + message.fds.length, 0, "fixture allocates no native buffers");
    this.messages.push(message);
  }

  override setHandler(id: number, handler: Parameters<WaylandPlatform["setHandler"]>[1]): void {
    this.wireHandlers.set(id, handler);
  }

  override clearHandler(id: number): void {
    this.wireHandlers.delete(id);
  }

  request(target: number, opcode: number): EncodedWaylandMessage {
    const message = this.messages.find((candidate) => {
      const header = decodeHeader(candidate.data);
      return header.objectId === target && header.opcode === opcode;
    });
    assert.ok(message, `missing wire request ${target}:${opcode}`);
    return message;
  }

  dispatch(target: number, opcode: number, builder: MessageBuilder): void {
    const handler = this.wireHandlers.get(target);
    assert.ok(handler, `missing production event handler ${target}`);
    const message = builder.build(target, opcode);
    handler(opcode, new MessageReader(message.data, message.fds));
  }
}

for (const initiallyFullscreen of [true, false]) {
  const platform = new WirePlatform();
  const window = new WaylandWindow(platform, {
    title: "Fixed-size protocol fixture",
    appId: "moire.fullscreen-fixture",
    width: 1280,
    height: 800,
    resizable: false,
    decorated: false,
    fullscreen: initiallyFullscreen,
  });
  const allocations: Array<{ width: number; height: number }> = [];
  window.onConfigure((width, height) => allocations.push({ width, height }));
  let closeCount = 0;
  window.onClose(() => closeCount++);
  window.create();

  const surfaceId = new MessageReader(
    platform.request(100, wlCompositor.requests.createSurface.opcode).data,
    [],
  ).newId();
  const xdgSurfaceId = new MessageReader(
    platform.request(101, xdgWmBase.requests.getXdgSurface.opcode).data,
    [],
  ).newId();
  const toplevelId = new MessageReader(
    platform.request(xdgSurfaceId, xdgSurface.requests.getToplevel.opcode).data,
    [],
  ).newId();
  const initialCommit = platform.request(surfaceId, wlSurface.requests.commit.opcode);
  const fullscreenRequests = platform.messages.filter((message) => {
    const header = decodeHeader(message.data);
    return (
      header.objectId === toplevelId && header.opcode === xdgToplevel.requests.setFullscreen.opcode
    );
  });
  assert.equal(fullscreenRequests.length, initiallyFullscreen ? 1 : 0);
  if (initiallyFullscreen) {
    const fullscreenRequest = fullscreenRequests[0];
    assert.ok(fullscreenRequest);
    assert.ok(
      platform.messages.indexOf(fullscreenRequest) < platform.messages.indexOf(initialCommit),
      "initial fullscreen request precedes the first bufferless commit",
    );
    assert.equal(
      new MessageReader(fullscreenRequest.data, []).object(),
      0,
      "null output leaves output selection to the compositor",
    );
  }
  assert.equal(window.isFullscreen(), false, "requested state waits for compositor confirmation");

  let serial = 40;
  const configure = (
    width: number,
    height: number,
    states: readonly number[],
    expected: { width: number; height: number; fullscreen: boolean; maximized: boolean },
  ) => {
    const wireStates = Buffer.alloc(states.length * 4);
    states.forEach((state, index) => wireStates.writeUInt32LE(state, index * 4));
    const callbacksBefore = allocations.length;
    platform.dispatch(
      toplevelId,
      xdgToplevel.events.configure.opcode,
      new MessageBuilder().int(width).int(height).array(wireStates),
    );
    assert.equal(
      allocations.length,
      callbacksBefore,
      "toplevel hint waits for xdg_surface configure",
    );
    platform.dispatch(
      xdgSurfaceId,
      xdgSurface.events.configure.opcode,
      new MessageBuilder().uint(++serial),
    );
    assert.equal(allocations.length, callbacksBefore + 1);
    assert.deepEqual(allocations.at(-1), { width: expected.width, height: expected.height });
    assert.equal(window.isFullscreen(), expected.fullscreen);
    assert.equal(window.isMaximized(), expected.maximized);
    const ack = platform.messages.at(-1);
    assert.ok(ack);
    assert.deepEqual(decodeHeader(ack.data), {
      objectId: xdgSurfaceId,
      opcode: xdgSurface.requests.ackConfigure.opcode,
      size: 12,
    });
    assert.equal(
      new MessageReader(ack.data, []).uint(),
      serial,
      "ack uses the actual configure serial",
    );
  };
  const states = xdgToplevel.enums.state;
  configure(1024, 768, [states.activated, states.fullscreen], {
    width: 1024,
    height: 768,
    fullscreen: true,
    maximized: false,
  });
  configure(1920, 1080, [states.fullscreen, 999], {
    width: 1920,
    height: 1080,
    fullscreen: true,
    maximized: false,
  });
  configure(0, 0, [states.fullscreen], {
    width: 1920,
    height: 1080,
    fullscreen: true,
    maximized: false,
  });
  configure(0, 900, [states.fullscreen], {
    width: 1920,
    height: 900,
    fullscreen: true,
    maximized: false,
  });
  window.setFullscreen(false);
  assert.equal(window.isFullscreen(), true, "unset request does not fabricate a configure");
  configure(800, 600, [states.activated], {
    width: 1280,
    height: 800,
    fullscreen: false,
    maximized: false,
  });
  configure(1600, 1000, [states.maximized], {
    width: 1600,
    height: 1000,
    fullscreen: false,
    maximized: true,
  });
  configure(1024, 768, [states.maximized, states.fullscreen], {
    width: 1024,
    height: 768,
    fullscreen: true,
    maximized: true,
  });
  configure(0, 0, [], { width: 1280, height: 800, fullscreen: false, maximized: false });
  configure(1280, 800, [], { width: 1280, height: 800, fullscreen: false, maximized: false });

  platform.dispatch(toplevelId, xdgToplevel.events.close.opcode, new MessageBuilder());
  assert.equal(closeCount, 1);
  window.destroy();
  assert.equal(platform.wireHandlers.size, 0, "role event handlers are removed on destroy");
  const requestsAfterDestroy = platform.messages.length;
  window.destroy();
  window.setFullscreen(true);
  window.setMaximized(true);
  assert.equal(
    platform.messages.length,
    requestsAfterDestroy,
    "teardown and later requests are inert",
  );
}

console.log(
  "[wayland/fullscreen-configure] real wire handlers: fixed allocation, fullscreen/maximized output hints, ack, restore and teardown passed",
);
