import assert from "node:assert/strict";
import {
  MessageBuilder,
  MessageReader,
  decodeHeader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import {
  wlBuffer,
  wlCallback,
  wlCompositor,
  wlSurface,
  xdgSurface,
  xdgWmBase,
} from "@moire/protocol/generated";
import {
  moireSurfaceStateManagerV1 as manager,
  moireSurfaceStateV1 as state,
} from "@moire/protocol/surface-state";
import type { PlatformWindowOpts } from "#ui/platform";
import { Window } from "#ui/window";
import { windowBackdropMotion, observeWindowBackdropMotion } from "@moire/ui";
import { WaylandPlatform, WaylandWindow } from "./index";
import { WindowRenderingTracker, type ClientSubmission } from "./rendering";

// Actual WaylandWindow role, submission, frame gate, wire decode and public Window.
// Only the native EGL/dma-buf boundary is structural: no display, FD or hardware claim.
class WirePlatform extends WaylandPlatform {
  readonly sent: EncodedWaylandMessage[] = [];
  readonly handlersForTest = new Map<number, Parameters<WaylandPlatform["setHandler"]>[1]>();
  native: WaylandWindow | null = null;
  execution: ClientSubmission["execution"] = "hardware"; // Adversarial positive client fact must still require matching server authority.
  readonly liveFrames = new Set<string>();
  readonly releaseCallbacks = new Map<string, () => void>();
  readonly nativeBufferIds = new Map<string, number>();
  blocked = false;
  failPresenter = false;
  constructor(private readonly version = 2) {
    super();
  }
  override getCompositorId() {
    return 100;
  }
  override getWmBaseId() {
    return 101;
  }
  override getDecoManagerId() {
    return 0;
  }
  override getSurfaceStateManagerId() {
    return this.version ? 102 : 0;
  }
  override getSurfaceStateVersion() {
    return this.version;
  }
  override getClientExecution() {
    return this.execution;
  }
  override createWindow(opts: PlatformWindowOpts) {
    const window = new WaylandWindow(this, opts);
    this.native = window;
    window.create();
    return window;
  }
  override setHandler(id: number, handler: Parameters<WaylandPlatform["setHandler"]>[1]) {
    this.handlersForTest.set(id, handler);
  }
  override clearHandler(id: number) {
    this.handlersForTest.delete(id);
  }
  override sendMessage(message: EncodedWaylandMessage, fds: number[] = []) {
    assert.equal(message.fds.length + fds.length, 0);
    this.sent.push(message);
  }
  override renderClientComposition(
    _channel: string,
    scene: Parameters<WaylandPlatform["renderClientComposition"]>[1],
  ): ReturnType<WaylandPlatform["renderClientComposition"]> {
    if (this.failPresenter) return super.renderClientComposition(_channel, scene);
    if (this.blocked) return null;
    this.liveFrames.add(_channel);
    return {
      kind: "dmabuf",
      frame: {
        id: _channel,
        fd: -1,
        width: scene.width,
        height: scene.height,
        stride: scene.width * 4,
        format: 0x34325258,
        modifier: 0n,
        damage: [{ x: 0, y: 0, width: scene.width, height: scene.height }],
      },
    };
  }
  override hasClientFrame(id: string) {
    return this.liveFrames.has(id);
  }
  override clientAccelerationAvailable() {
    return true;
  }
  override createDmabufBuffer(
    frame: Parameters<WaylandPlatform["createDmabufBuffer"]>[0],
    onRelease: () => void,
  ) {
    const id = this.allocId();
    this.releaseCallbacks.set(frame.id, onRelease);
    this.nativeBufferIds.set(frame.id, id);
    return id;
  }
  dispatch(id: number, opcode: number, builder: MessageBuilder) {
    const handler = this.handlersForTest.get(id);
    assert.ok(handler);
    handler(opcode, new MessageReader(builder.build(id, opcode).data, []));
  }
  requests(id: number, opcode: number) {
    return this.sent.filter((message) => {
      const h = decodeHeader(message.data);
      return h.objectId === id && h.opcode === opcode;
    });
  }
  request(id: number, opcode: number) {
    const message = this.requests(id, opcode).at(-1);
    assert.ok(message);
    return new MessageReader(message.data, []);
  }
}
const opts = {
  width: 2,
  height: 2,
  title: "Rendering authority",
  appId: "moire.rendering-test",
  decorated: false,
};
for (const version of [0, 1, 2]) {
  const platform = new WirePlatform(version);
  const window = new Window(opts);
  let motionChanges = 0;
  const stopMotion = observeWindowBackdropMotion(window, () => motionChanges++);
  window.mount(platform);
  const native = platform.native;
  assert.ok(native);
  const surfaceId = platform.request(100, wlCompositor.requests.createSurface.opcode).newId();
  const role = platform.request(101, xdgWmBase.requests.getXdgSurface.opcode).newId();
  platform.dispatch(role, xdgSurface.events.configure.opcode, new MessageBuilder().uint(1));
  const observation = version
    ? platform.request(102, manager.requests.getSurfaceState.opcode).newId()
    : 0;
  const scene = { width: 2, height: 2, clearColor: 0xff000000, layers: [] };
  const submit = () => {
    assert.equal(native.presentScene(scene), true);
  };
  const done = () => {
    const callback = platform.request(surfaceId, wlSurface.requests.frame.opcode).newId();
    platform.dispatch(callback, wlCallback.events.done.opcode, new MessageBuilder().uint(10));
  };
  const accepted = (token: number, value: number) =>
    platform.dispatch(
      observation,
      state.events.rendering.opcode,
      new MessageBuilder().uint(2).uint(token).uint(value),
    );
  const visibility = (value: number) =>
    platform.dispatch(
      observation,
      state.events.state.opcode,
      new MessageBuilder().uint(3).uint(value),
    );
  submit();
  assert.equal(window.getRenderingState().kind, "static");
  submit(); // coalesced; no second commit or submission token.
  if (version === 2) {
    assert.equal(platform.requests(observation, state.requests.submission.opcode).length, 1);
    const token1 = platform.request(observation, state.requests.submission.opcode).uint();
    const messages = platform.sent;
    const request = platform.requests(observation, state.requests.submission.opcode).at(-1);
    assert.ok(request);
    const commit = platform.requests(surfaceId, wlSurface.requests.commit.opcode).at(-1);
    assert.ok(commit);
    assert.equal(
      messages.indexOf(request) + 1,
      messages.indexOf(commit),
      "token is directly adjacent to actual commit",
    );
    accepted(token1 + 1, state.enums.rendering.hardwareRetained);
    assert.equal(window.getRenderingState().kind, "static", "future token cannot grant authority");
    accepted(token1, state.enums.rendering.hardwareRetained);
    assert.equal(window.getRenderingState().kind, "hardware-retained");
    assert.equal(
      windowBackdropMotion(window.getRenderingState(), window.getVisibility()).kind,
      "ambient",
    );
    assert.equal(
      windowBackdropMotion(window.getRenderingState(), window.getVisibility()).kind === "ambient" &&
        window.getVisibility() === "visible",
      false,
    );
    visibility(state.enums.visibility.visible);
    const commits = platform.requests(surfaceId, wlSurface.requests.commit.opcode).length;
    visibility(state.enums.visibility.hidden);
    visibility(state.enums.visibility.unknown);
    visibility(state.enums.visibility.visible);
    assert.equal(
      platform.requests(surfaceId, wlSurface.requests.commit.opcode).length,
      commits,
      "adapter subscriptions do not submit frames",
    );
    done();
    submit(); // Same native buffer ID, new frame token.
    const token2 = platform.request(observation, state.requests.submission.opcode).uint();
    assert.notEqual(token1, token2);
    assert.equal(
      window.getRenderingState().kind,
      "static",
      "new commit revokes old accepted source",
    );
    accepted(token1, state.enums.rendering.hardwareRetained);
    assert.equal(
      window.getRenderingState().kind,
      "static",
      "pooled BO reuse cannot revive an old completion",
    );
    accepted(token2, state.enums.rendering.hardwareRetained);
    assert.equal(window.getRenderingState().kind, "hardware-retained");
    const frameId = `surface-${surfaceId}`;
    const bufferId = platform.nativeBufferIds.get(frameId);
    assert.ok(bufferId);
    const release = platform.releaseCallbacks.get(frameId);
    assert.ok(release);
    platform.liveFrames.delete(frameId);
    release();
    assert.equal(
      platform.requests(bufferId, wlBuffer.requests.destroy.opcode).length,
      1,
      "actual released native target retirement destroys its cached Wayland buffer ID",
    );
    const removed: unknown[] = [];
    const stop = window.onRenderingChange((value) => removed.push(value));
    stop();
    stop();
    platform.retireVisibilityObservations();
    assert.equal(window.getRenderingState().kind, "static");
    assert.equal(removed.length, 0);
    const changesAtLoss = motionChanges;
    stopMotion();
    stopMotion();
    window.destroy();
    assert.equal(window.getRenderingState().kind, "static");
    assert.equal(motionChanges, changesAtLoss);
  } else {
    assert.equal(platform.requests(observation, state.requests.submission.opcode).length, 0);
    assert.equal(
      motionChanges,
      0,
      "v1/unsupported compositor remains static without a redraw loop",
    );
    done();
    stopMotion();
    window.destroy();
  }
  assert.equal(platform.handlersForTest.size, 0);
}
// Actual decoded software/virtual observations admit bounded repainting, not hardware authority.
for (const execution of ["software", "virtual"] as const) {
  const platform = new WirePlatform();
  platform.execution = execution;
  const window = new Window({ ...opts, retainedMotionPolicy: "bounded-wave" });
  const participant = {
    value: 0,
    get() {
      return this.value;
    },
    isActive() {
      return true;
    },
    tick(dt: number) {
      this.value += dt;
      return true;
    },
    reset() {
      const changed = this.value !== 0;
      this.value = 0;
      return changed;
    },
  };
  window.getRetainedMotionAdmission().register(participant);
  window.mount(platform);
  const native = platform.native;
  assert.ok(native);
  const surfaceId = platform.request(100, wlCompositor.requests.createSurface.opcode).newId();
  const role = platform.request(101, xdgWmBase.requests.getXdgSurface.opcode).newId();
  platform.dispatch(role, xdgSurface.events.configure.opcode, new MessageBuilder().uint(1));
  const observation = platform.request(102, manager.requests.getSurfaceState.opcode).newId();
  const accepted = (token: number, value: number) =>
    platform.dispatch(
      observation,
      state.events.rendering.opcode,
      new MessageBuilder().uint(1).uint(token).uint(value),
    );
  platform.dispatch(
    observation,
    state.events.state.opcode,
    new MessageBuilder().uint(1).uint(state.enums.visibility.visible),
  );
  native.presentScene({ width: 2, height: 2, clearColor: 0xff000000, layers: [] });
  const token = platform.request(observation, state.requests.submission.opcode).uint();
  const callback = platform.request(surfaceId, wlSurface.requests.frame.opcode).newId();
  platform.dispatch(callback, wlCallback.events.done.opcode, new MessageBuilder().uint(10));
  assert.equal(window.hasActiveAnimations(), false, "software submission/frame is not acceptance");
  accepted(token + 1, state.enums.rendering[execution]);
  assert.equal(window.hasActiveAnimations(), false);
  accepted(token, state.enums.rendering[execution]);
  assert.equal(
    window.hasActiveAnimations(),
    true,
    "actual current wire software observation arms opted-in window",
  );
  assert.deepEqual(window.getRenderingState(), {
    kind: "static",
    reason: execution,
    commitId: token,
  });
  accepted(token, state.enums.rendering.unknown);
  assert.equal(
    window.hasActiveAnimations(),
    false,
    "wire unknown revokes accepted software even if rendering reason is unchanged",
  );
  accepted(token, state.enums.rendering.virtual);
  assert.equal(
    window.hasActiveAnimations(),
    true,
    "verified virtual acceptance admits bounded motion",
  );
  accepted(token, state.enums.rendering.retainedUnknown);
  assert.equal(
    window.hasActiveAnimations(),
    false,
    "unknown execution cannot admit bounded motion",
  );
  window.destroy();
  assert.equal(platform.handlersForTest.size, 0);
}
// A failure in the shared presenter revokes both actual public/native windows.
{
  const platform = new WirePlatform();
  const windows: Window[] = [];
  const nativeWindows: WaylandWindow[] = [];
  const observationIds: number[] = [];
  for (let index = 0; index < 2; index++) {
    const window = new Window(opts);
    window.mount(platform);
    windows.push(window);
    const native = platform.native;
    assert.ok(native);
    nativeWindows.push(native);
    const role = platform.request(101, xdgWmBase.requests.getXdgSurface.opcode).newId();
    platform.dispatch(
      role,
      xdgSurface.events.configure.opcode,
      new MessageBuilder().uint(index + 1),
    );
    const observation = platform.request(102, manager.requests.getSurfaceState.opcode).newId();
    observationIds.push(observation);
    native.presentScene({ width: 2, height: 2, clearColor: 0xff000000, layers: [] });
    const token = platform.request(observation, state.requests.submission.opcode).uint();
    platform.dispatch(
      observation,
      state.events.rendering.opcode,
      new MessageBuilder()
        .uint(index + 1)
        .uint(token)
        .uint(state.enums.rendering.hardwareRetained),
    );
    assert.equal(window.getRenderingState().kind, "hardware-retained");
  }
  // Replace only the native execution boundary, then exercise the actual shared
  // WaylandPlatform catch/readback branch rather than calling its demotion helper.
  Object.assign(platform, {
    eglTransport: "dmabuf",
    eglPresenter: {
      renderClientComposition() {
        throw new Error("expected fixture export loss");
      },
      releaseClientFrame() {},
      dropClientChannel() {},
      renderClientCompositionReadback() {
        return { pixels: new Uint8Array(16), width: 2, height: 2 };
      },
    },
  });
  platform.failPresenter = true;
  const fallback = platform.renderClientComposition("failing-channel", {
    width: 2,
    height: 2,
    clearColor: 0xff000000,
    layers: [],
  });
  assert.equal(fallback?.kind, "shm");
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index];
    const observation = observationIds[index];
    assert.ok(window && observation);
    assert.deepEqual(window.getRenderingState(), {
      kind: "static",
      reason: "backend-loss",
      commitId: 1,
    });
    platform.dispatch(
      observation,
      state.events.rendering.opcode,
      new MessageBuilder().uint(99).uint(1).uint(state.enums.rendering.hardwareRetained),
    );
    assert.equal(window.getRenderingState().kind, "static");
    window.destroy();
  }
  platform.retireClientRendering();
  assert.equal(platform.handlersForTest.size, 0);
}
for (const execution of [
  "software",
  "virtual",
  "unknown",
] satisfies ClientSubmission["execution"][]) {
  const tracker = new WindowRenderingTracker();
  tracker.submitted({ token: 1, path: "retained-dmabuf", execution });
  tracker.observe(1, "hardwareRetained");
  assert.equal(
    tracker.get().kind,
    "static",
    "server cannot override negative/unknown client execution",
  );
}
for (const path of [
  "software",
  "flat-dmabuf",
  "retained-readback",
] satisfies ClientSubmission["path"][]) {
  const tracker = new WindowRenderingTracker();
  tracker.submitted({ token: 1, path, execution: "hardware" });
  tracker.observe(1, "hardwareRetained");
  assert.equal(tracker.get().kind, "static");
}
const tracker = new WindowRenderingTracker();
tracker.backendLost();
tracker.submitted({ token: 1, path: "retained-dmabuf", execution: "hardware" });
tracker.observe(1, "hardwareRetained");
assert.equal(tracker.get().kind, "static");
tracker.destroy();
tracker.destroy();
tracker.observe(1, "hardwareRetained");
assert.deepEqual(tracker.get(), { kind: "static", reason: "destroyed" });
console.log(
  "Actual WaylandWindow/public Window v2 token wire, coalescing, pooled BO reuse/stale completion, v1 fallback, loss, close, unsubscribe and static no-loop policy PASS (device-free structural EGL boundary)",
);
