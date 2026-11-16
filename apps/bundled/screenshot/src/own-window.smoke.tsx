/**
 * Screenshot keeps its own window out of the picture. A fake compositor stands in for the real
 * one: a minimize only takes effect once the compositor has handled it (the display roundtrip),
 * and the "screen" it captures is the window's colour while the window is up, the desktop's once
 * it is minimized. Through the real app: Whole screen with a delay, and Select area, both capture
 * the desktop alone and bring the window back with the result. Without an activation token the
 * window is never minimized (it could not come back); a failed capture still brings it back.
 */
import assert from "node:assert/strict";
import React from "react";
import { Window, installUiFonts, tickAllMotions, type ImageData } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { windowControl, windowTexts } from "@moire/app-tools/testing";
import { ScreenshotApp } from "./main";
import { documentImage, emptyDocument } from "./document";
import { prepareOwnWindow, type OwnWindow } from "./own-window";
import { scratchHome } from "./testing";

const DESKTOP = [10, 20, 30, 255] as const;
const SCREENSHOT_WINDOW = [200, 200, 200, 255] as const;

class FakeCompositor {
  readonly events: string[] = [];
  private requestedMinimize = false;
  minimized = false;
  private issued: string | null = null;
  constructor(private readonly issues = true) {}
  /** The client side of the window's activation methods. */
  readonly window: OwnWindow = {
    requestActivationToken: async () => {
      this.events.push("token");
      if (!this.issues) return null;
      this.issued = `moire-token-${this.events.length}`;
      return this.issued;
    },
    minimize: () => {
      this.events.push("minimize");
      this.requestedMinimize = true;
    },
    sync: async () => {
      // The roundtrip returns once the compositor has handled what was sent before it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (this.requestedMinimize) this.minimized = true;
      this.requestedMinimize = false;
      this.events.push("sync");
    },
    activate: (token) => {
      this.events.push("activate");
      if (token === this.issued) this.minimized = false;
      this.issued = null;
    },
  };
  /** The screen as composed now: the window's pixels while it is up. */
  capture = async (): Promise<ImageData> => {
    this.events.push(this.minimized ? "capture:desktop" : "capture:window");
    const colour = this.minimized ? DESKTOP : SCREENSHOT_WINDOW;
    const rgba = new Uint8Array(40 * 30 * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(colour, offset);
    return { width: 40, height: 30, rgba };
  };
}

// The sequencing itself, without the app.
{
  const compositor = new FakeCompositor();
  const hidden = await prepareOwnWindow(compositor.window);
  const image = await hidden(compositor.capture);
  assert.deepEqual([...image.rgba.slice(0, 4)], [...DESKTOP]);
  assert.deepEqual(compositor.events, ["token", "minimize", "sync", "capture:desktop", "activate"]);
  assert.equal(compositor.minimized, false, "the window is back after the capture");

  const failing = new FakeCompositor();
  const failingHidden = await prepareOwnWindow(failing.window);
  await assert.rejects(
    failingHidden(async () => {
      throw new Error("Display capture unavailable");
    }),
  );
  assert.deepEqual(failing.events, ["token", "minimize", "sync", "activate"]);
  assert.equal(failing.minimized, false, "a failed capture still brings the window back");

  const tokenless = new FakeCompositor(false);
  const plain = await prepareOwnWindow(tokenless.window);
  await plain(tokenless.capture);
  assert.deepEqual(tokenless.events, ["token", "capture:window"], "no token, no minimize");

  const windowless = await prepareOwnWindow(undefined);
  assert.equal(await windowless(async () => 7), 7, "without a window it just captures");
}

const sandbox = scratchHome();
try {
  await installUiFonts();
  for (const mode of ["Whole screen", "Select area"] as const) {
    const backend = new HeadlessPlatform();
    await backend.connect();
    const window = new Window({ title: "Screenshot own window", width: 1100, height: 760 });
    const compositor = new FakeCompositor();
    Object.assign(window, compositor.window);
    const latest = { current: emptyDocument() };
    window.setContent((size) => (
      <ScreenshotApp
        {...size}
        window={window}
        capture={compositor.capture}
        onDocumentChange={(document) => {
          latest.current = document;
        }}
      />
    ));
    window.mount(backend);
    const native = backend.getWindows()[0]!;
    const settle = async (frames = 10) => {
      for (let frame = 0; frame < frames; frame++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        tickAllMotions(1);
        window.tick();
      }
    };
    const press = async (match: { focusId: string } | { text: string }) => {
      const point = windowControl(window, match);
      native.injectPointer({ type: "down", ...point, button: "left", timeMs: 1 });
      native.injectPointer({ type: "up", ...point, button: "left", timeMs: 2 });
      window.tick();
      await settle();
    };
    await settle();
    await press({ text: mode });
    // Whole screen keeps the default 3 s delay, as in the report; Select area takes it at once.
    if (mode === "Select area") await press({ text: "None" });
    await press({ focusId: "screenshot-take" });
    if (mode === "Whole screen") {
      assert.deepEqual(compositor.events, ["token"], "the token is asked for at the click");
      assert.equal(compositor.minimized, false, "the countdown stays on screen");
      assert.ok(windowTexts(window).some((text) => text.startsWith("Taking the screenshot in")));
      for (let waited = 0; waited < 40 && !compositor.events.includes("activate"); waited++)
        await settle(10);
    } else {
      for (let waited = 0; waited < 10 && !compositor.events.includes("activate"); waited++)
        await settle();
    }
    await settle();
    assert.deepEqual(
      compositor.events,
      ["token", "minimize", "sync", "capture:desktop", "activate"],
      `${mode}: hidden and settled before the capture, back after it`,
    );
    assert.equal(compositor.minimized, false, `${mode}: the window came back`);
    const image = documentImage(latest.current);
    assert.ok(image, `${mode}: the capture is shown`);
    assert.deepEqual([...image.rgba.slice(0, 4)], [...DESKTOP], `${mode}: no Screenshot window`);
    window.destroy();
    backend.disconnect();
  }
  console.log(
    "[screenshot/own-window] window hidden for Whole screen and Select area, back with the result",
  );
} finally {
  sandbox.restore();
}
