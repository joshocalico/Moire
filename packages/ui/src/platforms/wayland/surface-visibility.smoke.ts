import assert from "node:assert/strict";
import {
  MessageBuilder,
  MessageReader,
  decodeHeader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import {
  wlCallback,
  wlCompositor,
  wlSurface,
  xdgSurface,
  xdgToplevel,
  xdgWmBase,
} from "@moire/protocol/generated";
import { moireSurfaceStateManagerV1, moireSurfaceStateV1 } from "@moire/protocol/surface-state";
import { HeadlessPlatform } from "@moire/ui/testing";
import type { PlatformWindowOpts, UiSurfaceVisibility } from "#ui/platform";
import { Window } from "#ui/window";
import { WaylandPlatform, WaylandWindow } from "./index";

/** Actual role/commit/event code, with no socket, EGL device, native fd or shm allocation. */
class WirePlatform extends WaylandPlatform {
  readonly messages: EncodedWaylandMessage[] = [];
  readonly handlersForTest = new Map<number, Parameters<WaylandPlatform["setHandler"]>[1]>();
  constructor(private readonly supported: boolean) {
    super();
  }
  override async connect(): Promise<void> {
    throw new Error("No real display in wire fixture");
  }
  override getCompositorId(): number {
    return 100;
  }
  override getWmBaseId(): number {
    return 101;
  }
  override getSurfaceStateManagerId(): number {
    return this.supported ? 102 : 0;
  }
  override getDecoManagerId(): number {
    return 0;
  }
  override createWindow(opts: PlatformWindowOpts): WaylandWindow {
    const window = new WaylandWindow(this, opts);
    window.create();
    return window;
  }
  override sendMessage(message: EncodedWaylandMessage, fds: number[] = []): void {
    assert.equal(message.fds.length + fds.length, 0, "wire fixture cannot publish native fds");
    this.messages.push(message);
  }
  override setHandler(id: number, handler: Parameters<WaylandPlatform["setHandler"]>[1]): void {
    this.handlersForTest.set(id, handler);
  }
  override clearHandler(id: number): void {
    this.handlersForTest.delete(id);
  }
  override renderClientComposition(
    channel: string,
    scene: Parameters<WaylandPlatform["renderClientComposition"]>[1],
  ): ReturnType<WaylandPlatform["renderClientComposition"]> {
    return {
      kind: "dmabuf",
      frame: {
        id: channel,
        fd: -1,
        width: scene.width,
        height: scene.height,
        stride: scene.width * 4,
        format: 0x34325241,
        modifier: 0n,
        damage: [{ x: 0, y: 0, width: scene.width, height: scene.height }],
      },
    };
  }
  override createDmabufBuffer(
    _frame: Parameters<WaylandPlatform["createDmabufBuffer"]>[0],
    _release: () => void,
  ): number {
    return this.allocId(); // Placeholder protocol id; never invokes the native dma-buf allocator.
  }
  dispatch(target: number, opcode: number, builder: MessageBuilder): void {
    const handler = this.handlersForTest.get(target);
    assert.ok(handler);
    const message = builder.build(target, opcode);
    handler(opcode, new MessageReader(message.data, []));
  }
  requests(target: number, opcode: number): EncodedWaylandMessage[] {
    return this.messages.filter((message) => {
      const h = decodeHeader(message.data);
      return h.objectId === target && h.opcode === opcode;
    });
  }
  request(target: number, opcode: number): EncodedWaylandMessage {
    const message = this.requests(target, opcode).at(-1);
    assert.ok(message);
    return message;
  }
}

const options = {
  title: "Visibility fixture",
  appId: "moire.visibility-fixture",
  width: 2,
  height: 2,
  decorated: false,
  fullscreen: true,
};
for (const supported of [true, false]) {
  const platform = new WirePlatform(supported);
  const window = new WaylandWindow(platform, options);
  const changes: UiSurfaceVisibility[] = [];
  const unsubscribe = window.onVisibilityChange((value) => changes.push(value));
  window.create();
  const surfaceId = new MessageReader(
    platform.request(100, wlCompositor.requests.createSurface.opcode).data,
    [],
  ).newId();
  const roleId = new MessageReader(
    platform.request(101, xdgWmBase.requests.getXdgSurface.opcode).data,
    [],
  ).newId();
  const topId = new MessageReader(
    platform.request(roleId, xdgSurface.requests.getToplevel.opcode).data,
    [],
  ).newId();
  assert.equal(
    window.getVisibility(),
    "unknown",
    "fullscreen request supplies no visibility evidence",
  );
  const stateBuffer = Buffer.alloc(8);
  stateBuffer.writeUInt32LE(xdgToplevel.enums.state.activated, 0);
  stateBuffer.writeUInt32LE(xdgToplevel.enums.state.fullscreen, 4);
  platform.dispatch(
    topId,
    xdgToplevel.events.configure.opcode,
    new MessageBuilder().int(2).int(2).array(stateBuffer),
  );
  platform.dispatch(roleId, xdgSurface.events.configure.opcode, new MessageBuilder().uint(7));
  assert.equal(window.isFullscreen(), true);
  assert.equal(window.getVisibility(), "unknown", "activation and configure are not visibility");
  let frames = 0;
  window.onFrame(() => frames++);
  for (const timestamp of [0, 0xffffffff]) {
    assert.equal(
      window.presentScene({ width: 2, height: 2, clearColor: 0xff000000, layers: [] }),
      true,
    );
    const cb = new MessageReader(
      platform.request(surfaceId, wlSurface.requests.frame.opcode).data,
      [],
    ).newId();
    platform.dispatch(cb, wlCallback.events.done.opcode, new MessageBuilder().uint(timestamp));
    assert.equal(
      window.getVisibility(),
      "unknown",
      "retained submit and callback timing prove no visibility",
    );
  }
  assert.equal(frames, 4);
  assert.deepEqual(changes, []);
  let observationId = 0;
  if (supported) {
    const request = platform.request(
      102,
      moireSurfaceStateManagerV1.requests.getSurfaceState.opcode,
    );
    const reader = new MessageReader(request.data, []);
    observationId = reader.newId();
    assert.equal(reader.object(), surfaceId);
    assert.ok(
      platform.messages.indexOf(request) <
        platform.messages.indexOf(
          platform.requests(surfaceId, wlSurface.requests.commit.opcode)[0]!,
        ),
      "observation starts before first commit",
    );
    let serial = 0;
    const state = (value: number) =>
      platform.dispatch(
        observationId,
        moireSurfaceStateV1.events.state.opcode,
        new MessageBuilder().uint(++serial).uint(value),
      );
    state(moireSurfaceStateV1.enums.visibility.unknown);
    state(moireSurfaceStateV1.enums.visibility.visible);
    state(moireSurfaceStateV1.enums.visibility.visible);
    state(moireSurfaceStateV1.enums.visibility.hidden);
    const commitsBeforeReveal = platform.requests(
      surfaceId,
      wlSurface.requests.commit.opcode,
    ).length;
    state(moireSurfaceStateV1.enums.visibility.visible);
    assert.equal(
      platform.requests(surfaceId, wlSurface.requests.commit.opcode).length,
      commitsBeforeReveal,
      "idle reveal arrives independently of client commits",
    );
    state(99);
    assert.equal(window.getVisibility(), "unknown", "future enum values fail closed");
    assert.deepEqual(changes, ["visible", "hidden", "visible", "unknown"]);
    unsubscribe();
    unsubscribe();
    state(moireSurfaceStateV1.enums.visibility.hidden);
    assert.equal(changes.length, 4, "unsubscribe is idempotent");
    const lateHandler = platform.handlersForTest.get(observationId);
    assert.ok(lateHandler);
    window.destroy();
    const lateMessage = new MessageBuilder()
      .uint(0xffffffff)
      .uint(moireSurfaceStateV1.enums.visibility.visible)
      .build(observationId, 0);
    lateHandler(0, new MessageReader(lateMessage.data, []));
    assert.equal(
      window.getVisibility(),
      "unknown",
      "even a queued event cannot revive a destroyed window",
    );
    const childDestroy = platform.request(
      observationId,
      moireSurfaceStateV1.requests.destroy.opcode,
    );
    const surfaceDestroy = platform.request(surfaceId, wlSurface.requests.destroy.opcode);
    assert.ok(platform.messages.indexOf(childDestroy) < platform.messages.indexOf(surfaceDestroy));
  } else {
    assert.equal(
      platform.requests(102, moireSurfaceStateManagerV1.requests.getSurfaceState.opcode).length,
      0,
    );
    unsubscribe();
    window.destroy();
  }
  const afterDestroy = platform.messages.length;
  window.destroy();
  const afterCloseStop = window.onVisibilityChange(() => assert.fail("subscription after destroy"));
  afterCloseStop();
  assert.equal(platform.messages.length, afterDestroy);
  assert.equal(platform.handlersForTest.size, 0);
}

/** Parent and popup receive separate authoritative observations, including independent teardown. */
{
  const platform = new WirePlatform(true);
  const parent = platform.createWindow(options);
  const popup = new WaylandWindow(platform, options, {
    parent,
    width: 2,
    height: 2,
    anchorX: 1,
    anchorY: 1,
    grab: false,
  });
  popup.create();
  const observations = platform
    .requests(102, moireSurfaceStateManagerV1.requests.getSurfaceState.opcode)
    .map((request) => {
      const reader = new MessageReader(request.data, []);
      return { id: reader.newId(), surface: reader.object() };
    });
  assert.equal(observations.length, 2);
  const [parentState, popupState] = observations;
  assert.ok(parentState && popupState);
  assert.notEqual(parentState.id, popupState.id);
  assert.notEqual(parentState.surface, popupState.surface);
  platform.dispatch(parentState.id, 0, new MessageBuilder().uint(1).uint(2));
  platform.dispatch(popupState.id, 0, new MessageBuilder().uint(2).uint(1));
  assert.equal(parent.getVisibility(), "visible");
  assert.equal(popup.getVisibility(), "hidden");
  popup.destroy();
  assert.equal(popup.getVisibility(), "unknown");
  assert.ok(!platform.handlersForTest.has(popupState.id));
  platform.dispatch(parentState.id, 0, new MessageBuilder().uint(3).uint(1));
  assert.equal(parent.getVisibility(), "hidden", "popup teardown leaves parent observation alive");
  parent.destroy();
  assert.equal(platform.handlersForTest.size, 0);
}

/** Public application API forwards idle protocol changes and cannot revive after native close. */
for (const closeRoute of ["protocol", "destroy", "transport-loss"]) {
  const platform = new WirePlatform(true);
  const window = new Window(options);
  const changes: UiSurfaceVisibility[] = [];
  const removed: UiSurfaceVisibility[] = [];
  assert.equal(window.getVisibility(), "unknown", "unmounted public window has no authority");
  window.onVisibilityChange((value) => changes.push(value));
  const stop = window.onVisibilityChange((value) => removed.push(value));
  window.mount(platform);
  const observation = new MessageReader(
    platform.request(102, moireSurfaceStateManagerV1.requests.getSurfaceState.opcode).data,
    [],
  ).newId();
  const state = (serial: number, value: number) =>
    platform.dispatch(observation, 0, new MessageBuilder().uint(serial).uint(value));
  const messagesBeforeReveal = platform.messages.length;
  state(1, 2);
  state(2, 2);
  state(3, 1);
  state(4, 2);
  assert.equal(
    platform.messages.length,
    messagesBeforeReveal,
    "public idle reveal submits no commit",
  );
  assert.equal(window.getVisibility(), "visible");
  assert.deepEqual(changes, ["visible", "hidden", "visible"]);
  assert.deepEqual(removed, changes);
  stop();
  stop();
  state(5, 1);
  state(6, 2);
  assert.equal(removed.length, 3);
  const lateHandler = platform.handlersForTest.get(observation);
  assert.ok(lateHandler);
  if (closeRoute === "protocol") {
    const role = new MessageReader(
      platform.request(101, xdgWmBase.requests.getXdgSurface.opcode).data,
      [],
    ).newId();
    const top = new MessageReader(
      platform.request(role, xdgSurface.requests.getToplevel.opcode).data,
      [],
    ).newId();
    window.setCloseGuard(() => false);
    platform.dispatch(top, xdgToplevel.events.close.opcode, new MessageBuilder());
    assert.equal(window.getVisibility(), "visible", "blocked close preserves live observation");
    assert.equal(window.isClosed(), false);
    window.setCloseGuard(() => true);
    platform.dispatch(top, xdgToplevel.events.close.opcode, new MessageBuilder());
    assert.equal(window.isClosed(), true);
    assert.equal(window.getVisibility(), "unknown");
    state(7, 1);
    state(8, 2);
    assert.equal(
      changes.at(-1),
      "unknown",
      "closed public window ignores surviving backend events",
    );
  } else if (closeRoute === "transport-loss") {
    platform.retireVisibilityObservations();
    assert.equal(window.isClosed(), false, "transport loss need not wait for application close");
    assert.equal(window.getVisibility(), "unknown", "lost authority reaches public subscribers");
    assert.ok(!platform.handlersForTest.has(observation));
    const late = new MessageBuilder().uint(8).uint(2).build(observation, 0);
    lateHandler(0, new MessageReader(late.data, []));
    assert.equal(
      window.getVisibility(),
      "unknown",
      "queued transport events cannot revive authority",
    );
    platform.retireVisibilityObservations();
    assert.equal(changes.length, 6, "transport observation retirement is idempotent");
  }
  window.destroy();
  assert.equal(window.getVisibility(), "unknown");
  assert.deepEqual(changes, ["visible", "hidden", "visible", "hidden", "visible", "unknown"]);
  const afterDestroy = platform.messages.length;
  const late = new MessageBuilder().uint(9).uint(2).build(observation, 0);
  lateHandler(0, new MessageReader(late.data, []));
  assert.equal(window.getVisibility(), "unknown");
  assert.equal(changes.length, 6);
  window.destroy();
  assert.equal(platform.messages.length, afterDestroy);
  assert.equal(platform.handlersForTest.size, 0);
}

const headless = new HeadlessPlatform();
await headless.connect();
const native = headless.createWindow(options);
const stop = native.onVisibilityChange(() => assert.fail("headless has no visibility authority"));
await Promise.resolve();
native.setFullscreen?.(false);
native.setMaximized?.(true);
native.minimize?.();
native.present(new Uint8Array(16), 2, 2);
await Promise.resolve();
assert.equal(native.getVisibility(), "unknown");
stop();
stop();
native.destroy();
assert.equal(native.getVisibility(), "unknown");
headless.disconnect();
console.log(
  "[ui/surface-visibility] actual wire observation, independent reveal, conservative fallback, frame isolation and teardown passed",
);
