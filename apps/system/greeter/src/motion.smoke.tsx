/** Real Application/Window/preferences with CPU pixels; no hardware/visibility claim. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import React, { useEffect } from "react";
import {
  Application,
  Window,
  observeWindowBackdropMotion,
  installUiFonts,
  type PlatformWindowOpts,
  type UiFrameEvent,
  type UiRenderingState,
  type UiSurfaceVisibility,
  type WindowSize,
} from "@moire/ui";
import { HeadlessPlatform, HeadlessWindow } from "@moire/ui/testing";
import { RetainedSoftwareRenderer, type RetainedSceneFrame } from "@moire/react-host";
import { getMotionActivity } from "@moire/ui/motion";
import { loadSettings, updateSettings } from "@moire/prefs";
import { GreeterApp } from "./view";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-greeter-motion-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  MOIRE_SESSION: process.env.MOIRE_SESSION,
};
process.env.HOME = directory;
process.env.XDG_CONFIG_HOME = path.join(directory, "config");
process.env.MOIRE_SESSION = "1";
const fixedNow = new Date("2026-10-03T12:34:00Z");
async function waitFor(predicate: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Greeter motion fixture deadline");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function session(expected: boolean, change: boolean) {
  const app = new Application({ platform: "headless", personalization: { source: "moire" } });
  const window = new Window({
    title: "Greeter motion integration",
    width: 640,
    height: 480,
    decorated: false,
  });
  let renders = 0;
  let reduced: boolean | undefined;
  let changes = 0;
  const stop = observeWindowBackdropMotion(window, () => {
    changes++;
    window.requestRedraw();
  });
  function View(size: WindowSize) {
    reduced = app.getPersonalization()?.reducedMotion;
    useEffect(() => {
      renders++;
    });
    return (
      <GreeterApp
        {...size}
        username="moire"
        now={fixedNow}
        onContinue={async () => {}}
        reducedMotion={reduced ?? true}
        backdropAdmission={window.getRetainedMotionAdmission()}
      />
    );
  }
  window.setContent((size) => <View {...size} />);
  window.onClose(() => app.quit());
  app.addWindow(window);
  const running = app.run();
  try {
    await waitFor(() => renders > 0);
    assert.equal(reduced, expected);
    assert.deepEqual(window.getRenderingState(), { kind: "static", reason: "software" });
    assert.equal(window.getVisibility(), "unknown");
    assert.equal(getMotionActivity().active, false);
    const initial = window.getPerformanceSnapshot().frames;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      window.getPerformanceSnapshot().frames,
      initial,
      "static greeter cannot schedule a frame loop",
    );
    assert.equal(changes, 0);
    if (change) {
      await app.setSessionReducedMotion(true);
      await waitFor(() => reduced === true);
      assert.equal(loadSettings().reducedMotion, true);
      assert.equal(getMotionActivity().active, false);
      updateSettings({ reducedMotion: false });
      await waitFor(() => reduced === false);
      assert.equal(
        getMotionActivity().active,
        false,
        "live persisted motion-off cannot make CPU/unknown execution animate",
      );
      await app.setSessionReducedMotion(true);
      await waitFor(() => reduced === true);
    }
    stop();
    stop();
    window.requestClose();
    await running;
    assert.equal(window.getRenderingState().kind, "static");
    assert.equal(window.getVisibility(), "unknown");
    assert.equal(getMotionActivity().active, false);
  } finally {
    stop();
    app.quit();
    await running;
  }
}

/**
 * Diagnostic native boundary only. These owned objects are fixture evidence,
 * never a claim that a headless framebuffer executed on hardware. No production
 * classifier or compositor is changed to grant a positive state.
 */
type DiagnosticEvidence = Readonly<{
  context: object;
  output: object;
  token: number;
  scene: RetainedSceneFrame;
}>;
class DiagnosticWindow extends HeadlessWindow {
  readonly context = Object.freeze({ owner: this, generation: Object.freeze({}) });
  readonly output = Object.freeze({ owner: this, generation: Object.freeze({}) });
  readonly submissions: Array<{ token: number; imageX: number; imageY: number; pixels: string }> =
    [];
  private readonly oracle = new RetainedSoftwareRenderer();
  private state: UiRenderingState = { kind: "static", reason: "pending" };
  private visibility: UiSurfaceVisibility = "unknown";
  private readonly renderingListeners = new Set<(value: UiRenderingState) => void>();
  private readonly visibilityListeners = new Set<(value: UiSurfaceVisibility) => void>();
  private readonly frameListeners = new Set<(value: UiFrameEvent) => void>();
  private pending: { token: number; scene: RetainedSceneFrame } | null = null;
  captureDirectory: string | undefined;
  deferNext = false;
  attempts = 0;
  maximumPending = 0;
  private nextToken = 1;
  private lost = false;
  private closed = false;

  override getRenderingState(): UiRenderingState {
    return this.state;
  }
  override onRenderingChange(callback: (value: UiRenderingState) => void): () => void {
    this.renderingListeners.add(callback);
    return () => this.renderingListeners.delete(callback);
  }
  override getVisibility(): UiSurfaceVisibility {
    return this.visibility;
  }
  override onVisibilityChange(callback: (value: UiSurfaceVisibility) => void): () => void {
    this.visibilityListeners.add(callback);
    return () => this.visibilityListeners.delete(callback);
  }
  override onFrame(callback: (value: UiFrameEvent) => void): void {
    this.frameListeners.add(callback);
  }
  private publish(state: UiRenderingState): void {
    this.state = state;
    for (const callback of this.renderingListeners) callback(state);
  }
  setVisibility(value: UiSurfaceVisibility): void {
    this.visibility = value;
    for (const callback of this.visibilityListeners) callback(value);
  }
  presentScene(scene: RetainedSceneFrame): boolean {
    this.attempts++;
    if (this.closed || this.pending) return true;
    if (this.deferNext) {
      this.deferNext = false;
      return true;
    }
    const image = scene.layers.find(
      (layer) => layer.sourceWidth === 1280 && layer.sourceHeight === 800,
    );
    assert.ok(image, "actual Greeter's immutable silk image must be submitted");
    const token = this.nextToken++;
    this.pending = { token, scene };
    this.maximumPending = Math.max(this.maximumPending, 1);
    const frame = this.oracle.render(scene);
    const capture = this.captureDirectory;
    if (capture) {
      fs.mkdirSync(capture, { recursive: true });
      if (token === 1) fs.writeFileSync(path.join(capture, "first.bgra"), frame.pixels);
      if (token === 300) fs.writeFileSync(path.join(capture, "last.bgra"), frame.pixels);
    }
    this.submissions.push({
      token,
      imageX: image.destination.x,
      imageY: image.destination.y,
      pixels: createHash("sha256").update(frame.pixels).digest("hex"),
    });
    this.publish({
      kind: "static",
      reason: this.lost ? "backend-loss" : "awaiting-output",
      commitId: token,
    });
    const now = performance.now();
    for (const callback of this.frameListeners)
      callback({
        type: "submitted",
        commitId: token,
        transport: "dmabuf",
        submittedAtMs: now,
        copyMs: 0,
        damagedPixels: scene.width * scene.height,
        totalPixels: scene.width * scene.height,
      });
    return true;
  }
  evidence(): DiagnosticEvidence | null {
    return this.pending && { context: this.context, output: this.output, ...this.pending };
  }
  accept(evidence = this.evidence(), frameFirst = false): boolean {
    const pending = this.pending;
    if (
      !pending ||
      !evidence ||
      this.closed ||
      this.lost ||
      evidence.context !== this.context ||
      evidence.output !== this.output ||
      evidence.token !== pending.token ||
      evidence.scene !== pending.scene
    )
      return false;
    this.pending = null;
    const frame = () => {
      const now = performance.now();
      for (const callback of this.frameListeners)
        callback({
          type: "compositor-frame",
          commitId: pending.token,
          timestampMs: now,
          receivedAtMs: now,
        });
    };
    if (frameFirst) frame();
    this.publish({ kind: "hardware-retained", commitId: pending.token });
    if (!frameFirst) frame();
    return true;
  }
  releaseRetry(): void {
    const token = this.submissions.at(-1)?.token;
    assert.ok(token);
    for (const callback of this.frameListeners)
      callback({
        type: "buffer-release",
        commitId: token,
        transport: "dmabuf",
        latencyMs: 0,
        receivedAtMs: performance.now(),
        retrySuggested: true,
      });
  }
  lose(): void {
    this.lost = true;
    this.pending = null;
    this.publish({ kind: "static", reason: "backend-loss" });
  }
  override destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = null;
    this.publish({ kind: "static", reason: "destroyed" });
    this.renderingListeners.clear();
    this.visibilityListeners.clear();
    this.frameListeners.clear();
    super.destroy();
  }
}

class DiagnosticPlatform extends HeadlessPlatform {
  native: DiagnosticWindow | null = null;
  override createWindow(options: PlatformWindowOpts): DiagnosticWindow {
    const native = new DiagnosticWindow(options);
    this.native = native;
    queueMicrotask(() => native.emitConfigure(options.width, options.height));
    return native;
  }
}

async function positiveDiagnostic(): Promise<void> {
  await installUiFonts();
  const platform = new DiagnosticPlatform();
  const window = new Window({
    width: 640,
    height: 480,
    title: "Owned diagnostic motion",
    decorated: false,
  });
  let changes = 0;
  let reducedMotion = false;
  const stop = window.onRenderingChange(() => {
    changes++;
  });
  window.setContent((size) => (
    <GreeterApp
      {...size}
      username="moire"
      now={fixedNow}
      reducedMotion={reducedMotion}
      onContinue={async () => {}}
      backdropAdmission={window.getRetainedMotionAdmission()}
    />
  ));
  window.mount(platform);
  await Promise.resolve();
  const native = platform.native;
  assert.ok(native);
  native.captureDirectory = process.env.MOIRE_GREETER_MOTION_CAPTURE;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const tick = async () => {
    now += 100;
    window.tick();
    await Promise.resolve();
  };
  try {
    native.setVisibility("visible");
    await tick();
    assert.equal(window.getRenderingState().kind, "static");
    const firstEvidence = native.evidence();
    assert.ok(firstEvidence);
    assert.equal(
      native.accept({ ...firstEvidence, context: Object.freeze({}) }),
      false,
      "a different context generation cannot qualify the pending source",
    );
    assert.equal(
      native.accept({ ...firstEvidence, output: Object.freeze({}) }),
      false,
      "a different output generation cannot qualify the pending source",
    );
    assert.equal(
      native.accept({ ...firstEvidence, token: firstEvidence.token + 1 }),
      false,
      "future submission evidence cannot qualify the current source",
    );
    assert.equal(
      native.accept({ ...firstEvidence, scene: { ...firstEvidence.scene } }),
      false,
      "even identical dimensions cannot replace the actual submitted scene identity",
    );
    assert.equal(native.accept(), true);
    const initial = window.getPerformanceSnapshot();
    for (let frame = 0; frame < 299; frame++) {
      await tick();
      assert.equal(
        window.getRenderingState().kind,
        "static",
        "every submission revokes prior authority",
      );
      const pendingFrames: number = native.submissions.length;
      for (let waiting = 0; waiting < 8; waiting++) await tick();
      assert.equal(
        native.submissions.length,
        pendingFrames,
        "one pending frame prevents further commits",
      );
      assert.equal(
        window.hasActiveAnimations(),
        false,
        "pending admission pauses its own scheduler",
      );
      assert.equal(getMotionActivity().active, false, "unaccepted motion must stop");
      assert.equal(
        native.accept(firstEvidence),
        false,
        "old accepted generations cannot qualify a later token",
      );
      assert.equal(native.accept(undefined, frame % 2 === 0), true);
    }
    const after = window.getPerformanceSnapshot();
    assert.equal(
      native.attempts,
      native.submissions.length,
      "idle/pending ticks must not even attempt another native presentation",
    );
    const positions = new Set(native.submissions.map((frame) => `${frame.imageX}:${frame.imageY}`));
    const reconciles = after.reconciledFrames - initial.reconciledFrames;
    console.log(
      JSON.stringify({
        kind: "positive-motion-diagnostic",
        physicalHardware: false,
        boundary: "owned fixture context/output generations",
        acceptedFrames: native.submissions.length,
        authorityChanges: changes,
        reconciles,
        distinctImagePositions: positions.size,
        distinctRasterHashes: new Set(native.submissions.map((frame) => frame.pixels)).size,
        maximumPending: native.maximumPending,
        attemptedPresentations: native.attempts,
        queuedWakeAfterHidden: "asserted zero extra publications",
      }),
    );
    const hiddenFrames = native.submissions.length;
    native.setVisibility("hidden");
    for (let idle = 0; idle < 8; idle++) await tick();
    assert.equal(
      native.submissions.length,
      hiddenFrames,
      "hidden pauses without resetting or publishing",
    );
    assert.equal(window.hasActiveAnimations(), false);
    assert.equal(window.getRenderingState().kind, "hardware-retained");
    assert.equal(
      getMotionActivity().active,
      false,
      "hidden presentation remains paused even with accepted evidence",
    );
    native.setVisibility("visible");
    await tick();
    assert.equal(native.accept(), true);
    native.deferNext = true;
    await tick();
    assert.equal(native.evidence(), null, "backpressure has no new submitted token");
    assert.equal(
      window.hasActiveAnimations(),
      false,
      "before-attempt pause also covers native backpressure",
    );
    const deferredAttempts = native.attempts;
    for (let idle = 0; idle < 8; idle++) await tick();
    assert.equal(
      native.attempts,
      deferredAttempts,
      "no busy retry without actual transport opportunity",
    );
    native.releaseRetry();
    await tick();
    assert.equal(window.getRenderingState().kind, "static");
    assert.equal(native.accept(), true);
    reducedMotion = true;
    window.requestRedraw();
    await tick();
    assert.equal(getMotionActivity().active, false);
    assert.equal(native.accept(), true);
    assert.equal(window.getRenderingState().kind, "hardware-retained");
    assert.equal(
      getMotionActivity().active,
      false,
      "reduced motion overrides current positive fixture evidence",
    );
    // Actual losses must remain irreversible even when a stale adapter reply arrives.
    native.lose();
    await tick();
    assert.equal(window.getRenderingState().kind, "static");
    assert.equal(native.accept(), false);
    assert.equal(getMotionActivity().active, false);
    native.setVisibility("hidden");
    await tick();
    assert.equal(getMotionActivity().active, false);
    const lostFrames = native.submissions.length;
    for (let idle = 0; idle < 16; idle++) await tick();
    assert.equal(
      native.submissions.length,
      lostFrames,
      "actual loss cannot create an idle commit loop",
    );
    stop();
    stop();
    window.destroy();
    assert.equal(native.accept(), false);
    assert.equal(getMotionActivity().active, false);
    const replacement = new DiagnosticWindow({
      width: 640,
      height: 480,
      title: "New owned generation",
      appId: "org.moire.GreeterMotionDiagnostic",
    });
    try {
      replacement.presentScene(firstEvidence.scene);
      assert.equal(
        replacement.accept(firstEvidence),
        false,
        "a fresh owner cannot inherit another window's authority",
      );
      assert.equal(
        replacement.accept(),
        true,
        "a new owned generation can qualify only its own pending scene",
      );
      replacement.lose();
      assert.equal(replacement.accept(), false);
    } finally {
      replacement.destroy();
    }
    assert.ok(
      reconciles <= 2,
      "positive accepted motion must not reconcile static/ambient every commit",
    );
    assert.ok(positions.size > 12, "sustained motion advances retained geometry");
    assert.ok(
      new Set(native.submissions.map((frame) => frame.pixels)).size > 3,
      "actual nonuniform rasterized pixels change with the transform",
    );
    assert.equal(
      after.frames,
      300,
      "one initial publication and one per accepted paint opportunity",
    );
    console.log(
      "PASS strict per-window admission: bounded paint-only commits, <=2 reconciliations, held pending phase and changing nonuniform CPU oracle pixels; no hardware qualification claim",
    );
  } finally {
    Date.now = originalNow;
    stop();
    window.destroy();
  }
}
async function twoWindowDiagnostic(): Promise<void> {
  const ap = new DiagnosticPlatform();
  const bp = new DiagnosticPlatform();
  const a = new Window({ width: 640, height: 480, title: "Motion A", decorated: false });
  const b = new Window({ width: 640, height: 480, title: "Motion B", decorated: false });
  for (const window of [a, b])
    window.setContent((size) => (
      <GreeterApp
        {...size}
        username="moire"
        now={fixedNow}
        reducedMotion={false}
        onContinue={async () => {}}
        backdropAdmission={window.getRetainedMotionAdmission()}
      />
    ));
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const tick = async (window: Window) => {
    now += 100;
    window.tick();
    await Promise.resolve();
  };
  try {
    a.mount(ap);
    b.mount(bp);
    await Promise.resolve();
    const an = ap.native;
    const bn = bp.native;
    assert.ok(an);
    assert.ok(bn);
    an.setVisibility("visible");
    bn.setVisibility("visible");
    await tick(a);
    await tick(b);
    assert.equal(an.accept(), true);
    assert.equal(bn.accept(), true);
    await tick(a);
    const bHeld = bn.submissions[0];
    assert.ok(bHeld);
    assert.equal(bn.submissions.length, 1, "A tick never publishes B");
    assert.equal(b.hasActiveAnimations(), true, "A pending never consumes B's permit");
    const aHeld = an.submissions.at(-1);
    assert.ok(aHeld);
    await tick(b);
    assert.equal(an.submissions.at(-1), aHeld, "B tick never mutates A's held scene");
    assert.notEqual(bn.submissions.at(-1)?.imageX, bHeld.imageX, "B's own tick advances only B");
    an.setVisibility("hidden");
    assert.equal(bn.accept(), true);
    for (let frame = 0; frame < 6; frame++) {
      await tick(a);
      await tick(b);
      assert.equal(an.submissions.at(-1), aHeld, "hidden A remains held while B advances");
      assert.equal(bn.accept(), true);
    }
    an.lose();
    await tick(a);
    assert.equal(b.hasActiveAnimations(), true, "A loss cannot demote qualified B");
    a.destroy();
    for (let frame = 0; frame < 6; frame++) {
      await tick(b);
      assert.equal(bn.accept(), true);
    }
    assert.ok(new Set(bn.submissions.map((frame) => frame.pixels)).size > 2);
    assert.ok(b.getPerformanceSnapshot().reconciledFrames <= 2);
    console.log(
      "Actual public Window two-owner diagnostic PASS: pending/hidden/lost/closed A never advances, pauses or consumes accepted B's retained participants",
    );
  } finally {
    Date.now = originalNow;
    a.destroy();
    b.destroy();
  }
}

try {
  updateSettings({ reducedMotion: false });
  await session(false, true);
  await session(true, false);
  await positiveDiagnostic();
  await twoWindowDiagnostic();
  console.log(
    "Actual Greeter view + Application/Window: static CPU/unknown visibility, no redraw loop, live saved/watched reducedMotion, restart persistence and close cleanup PASS (headless pixels; no native hardware claim)",
  );
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
