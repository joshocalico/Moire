/** Public Window + native view + CPU pixels. Output observations here are synthetic. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React from "react";
import { SoftwareRenderer, collectHits, type SceneNode } from "@moire/react-host";
import {
  Window,
  installUiFonts,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  type UiFrameEvent,
  type UiRenderingState,
  type PlatformWindowOpts,
} from "@moire/ui";
import { HeadlessPlatform, type HeadlessWindow } from "@moire/ui/testing";
import { NativeGreeterView } from "./view";
import { newAttemptId, newPromptId, type NativeGreeterState } from "./types";
import type { LocalUserProvider } from "./local-users";
let frame: ((event: UiFrameEvent) => void) | undefined;
let rendering: ((state: UiRenderingState) => void) | undefined;
let native: HeadlessWindow | undefined;
let token = 0;
class ObservedPlatform extends HeadlessPlatform {
  override createWindow(options: PlatformWindowOpts) {
    const handle = super.createWindow(options);
    native = this.getWindows().at(-1);
    handle.getVisibility = () => "visible";
    handle.onRenderingChange = (callback) => {
      rendering = callback;
      return () => {
        rendering = undefined;
      };
    };
    const subscribe = handle.onFrame.bind(handle);
    handle.onFrame = (callback) => {
      frame = callback;
      subscribe((event) => {
        callback(event);
        if (event.type === "submitted") {
          token = event.commitId;
          rendering?.({ kind: "static", reason: "software", commitId: token });
          // Actual compositor sends unknown for every new pending commit.
          callback({ type: "output-revoked", commitId: token });
        }
      });
    };
    return handle;
  }
}
let observed: SceneNode | undefined;
const render = SoftwareRenderer.prototype.render;
SoftwareRenderer.prototype.render = function (root, viewport) {
  observed = root;
  return render.call(this, root, viewport);
};
const platform = new ObservedPlatform();
const window = new Window({
  title: "Native wave fixture",
  width: 800,
  height: 600,
  decorated: false,
  retainedMotionPolicy: "bounded-wave",
});
let reduced = false;
const theme = () =>
  window.setTheme(
    createPersonalizedWidgetTheme(
      discoverPersonalization("linux", {
        source: "application",
        themeFamily: "moire",
        reducedMotion: reduced,
      }),
    ),
  );
let state: NativeGreeterState = { kind: "ready", revision: 0, message: "" };
const users: LocalUserProvider = {
  list: async () => [{ uid: 1000n, username: "alice", displayName: "Alice" }],
};
window.setContent((size) => (
  <NativeGreeterView
    {...size}
    state={state}
    users={users}
    actions={{
      begin: async () => {
        state = {
          kind: "prompt",
          attemptId: newAttemptId(),
          promptId: newPromptId(),
          style: "secret",
          message: "",
        };
        window.requestRedraw();
      },
      answer: async () => {},
      cancel: async () => {
        state = { kind: "ready", revision: 1, message: "" };
        window.requestRedraw();
      },
    }}
    now={new Date("2026-10-05T00:00:00Z")}
    admission={window.getRetainedMotionAdmission()}
    reducedMotion={reduced}
    onReducedMotionChange={(value) => {
      reduced = value;
      theme();
      window.requestRedraw();
    }}
  />
));
let now = 1000;
const dateNow = Date.now;
Date.now = () => now;
const pixels = () => {
  assert.ok(native?.lastFrame);
  // Backdrop-only rectangle, away from clock, form, focus and accessibility popover.
  const crop = new Uint8Array(200 * 150 * 4);
  for (let y = 200; y < 350; y++)
    crop.set(
      native.lastFrame.subarray((y * 800 + 550) * 4, (y * 800 + 750) * 4),
      (y - 200) * 200 * 4,
    );
  return createHash("sha256").update(crop).digest("hex");
};
const backdropOffset = () => {
  const findImage = (node: SceneNode): SceneNode | undefined => {
    if (node.imageWidth === 1280 && node.imageHeight === 800) return node;
    for (const child of node.children) {
      const found = findImage(child);
      if (found) return found;
    }
  };
  assert.ok(observed);
  let node = findImage(observed);
  assert.ok(node, "actual native view must contain its immutable Silk artwork");
  let x = 0;
  while (node) {
    x += typeof node.translateX === "number" ? node.translateX : (node.translateX?.get() ?? 0);
    node = node.parent ?? undefined;
  }
  return x;
};
const accept = async () => {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  window.tick();
  assert.ok(frame);
  frame({ type: "output-accepted", commitId: token, execution: "virtual" });
};
const advance = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await accept();
    const before = native?.presentedFrames ?? 0;
    now += 100;
    window.tick();
    assert.ok((native?.presentedFrames ?? 0) - before <= 1);
  }
};
try {
  await installUiFonts();
  theme();
  window.mount(platform);
  await Promise.resolve();
  window.tick();
  await Promise.resolve();
  assert.equal(window.hasActiveAnimations(), false);
  const canonical = pixels();
  const initialOffset = backdropOffset();
  await advance(20);
  assert.notEqual(
    pixels(),
    canonical,
    "actual native view backdrop pixels must move under accepted virtual compositor observations",
  );
  assert.ok(
    Math.abs(backdropOffset() - initialOffset) >= 12,
    "two seconds of accepted frames must produce clearly visible backdrop displacement",
  );
  assert.equal(window.getRenderingState().kind, "static", "software does not become hardware");
  assert.ok(native && observed);
  const click = (x: number, y: number) => {
    native?.injectPointer({ type: "down", x, y, button: "left", timeMs: 0 });
    native?.injectPointer({ type: "up", x, y, button: "left", timeMs: 1 });
    window.tick();
  };
  const user = collectHits(observed).find((hit) => hit.focusId === "native:user:alice");
  assert.ok(user, "Moving picker must expose the local user");
  click(user.x + user.width / 2, user.y + user.height / 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  window.tick();
  const passwordPhase = pixels();
  await advance(20);
  assert.notEqual(pixels(), passwordPhase, "Wave remains moving on the password screen");
  const access = collectHits(observed).find((hit) => hit.focusId === "native:accessibility");
  assert.ok(access);
  click(access.x + access.width / 2, access.y + access.height / 2);
  await Promise.resolve();
  window.tick();
  const modifiers = { ctrl: false, alt: false, meta: false, shift: false };
  const key = (code: number, name: string) => {
    native?.injectKey({ type: "down", code, key: name, modifiers, timeMs: 0 });
    native?.injectKey({ type: "up", code, key: name, modifiers, timeMs: 1 });
    window.tick();
  };
  key(15, "Tab"); // Stronger text auto-focus -> Reduce motion.
  key(57, " ");
  assert.equal(reduced, true, "real checkbox dispatch enables local reduced motion");
  const stopped = pixels();
  await advance(4); // Let existing button/focus transitions finish; backdrop must already be stopped.
  assert.equal(pixels(), stopped);
  const frames = native.presentedFrames;
  await advance(20);
  assert.equal(pixels(), stopped);
  assert.equal(window.hasActiveAnimations(), false);
  assert.equal(native.presentedFrames, frames, "reduced motion makes no background submissions");
  key(57, " ");
  assert.equal(reduced, false);
  await advance(20);
  assert.notEqual(pixels(), stopped, "same local checkbox resumes accepted motion");
  key(1, "Escape"); // Close accessibility before changing users.
  window.tick();
  const back = collectHits(observed).find((hit) => hit.focusId === "native:cancel");
  assert.ok(back);
  click(back.x + back.width / 2, back.y + back.height / 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  window.tick();
  const pickerAgain = pixels();
  await advance(20);
  assert.notEqual(pixels(), pickerAgain, "Returning to the picker preserves the wave");
  window.destroy();
  assert.equal(window.hasActiveAnimations(), false);
  assert.equal(rendering, undefined, "close unsubscribes output observations");
  console.log(
    "Native view/public Window changing backdrop pixels, local checkbox stop/resume, pending phase and teardown PASS (synthetic output observations; no native display claim)",
  );
} finally {
  Date.now = dateNow;
  SoftwareRenderer.prototype.render = render;
  window.destroy();
  platform.disconnect();
}
