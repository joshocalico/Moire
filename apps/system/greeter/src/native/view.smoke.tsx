/** Actual public Window dispatch, shared widgets and CPU pixels, synthetic inputs only. */
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import React from "react";
import { collectHits, SoftwareRenderer, type SceneNode } from "@moire/react-host";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
} from "@moire/ui";
// oxlint-disable-next-line import/no-relative-parent-imports -- Existing readonly actual Window test helper, without fixture controllers.
import { greeterHarness } from "../testing";
import { newAttemptId, newPromptId, type NativeGreeterState } from "./types";
import { NativeGreeterView, type NativeGreeterActions } from "./view";

const now = new Date("2026-10-04T12:34:00Z");
const ready: NativeGreeterState = { kind: "ready", revision: 0, message: "" };
const prompt = (
  style: "visible" | "secret" | "info" | "error",
): Extract<NativeGreeterState, { kind: "prompt" }> => ({
  kind: "prompt",
  attemptId: newAttemptId(),
  promptId: newPromptId(),
  style,
  message: "Authentication response requested",
});
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
let observed: SceneNode | undefined;
const originalRender = SoftwareRenderer.prototype.render;
SoftwareRenderer.prototype.render = function (root, viewport) {
  observed = root;
  return originalRender.call(this, root, viewport);
};
function scene(): SceneNode {
  assert.ok(observed);
  return observed;
}
const text = () =>
  nodes(scene()).flatMap((node) => (typeof node.text === "string" ? [node.text] : []));
const hits = () => collectHits(scene());
async function presentation(
  initial: NativeGreeterState = ready,
  width = 1280,
  height = 800,
  scale = 1,
  colorScheme: "dark" | "light" = "dark",
) {
  setUiScaleFactor(scale);
  let state = initial;
  const begins: Parameters<NativeGreeterActions["begin"]>[] = [];
  const answers: Parameters<NativeGreeterActions["answer"]>[] = [];
  const cancels: Parameters<NativeGreeterActions["cancel"]>[] = [];
  const actions: NativeGreeterActions = {
    begin: async (...args) => {
      begins.push(args);
    },
    answer: async (...args) => {
      answers.push(args);
    },
    cancel: async (...args) => {
      cancels.push(args);
    },
  };
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      source: "application",
      themeFamily: "moire",
      colorScheme,
      reducedMotion: true,
    }),
  );
  const app = await greeterHarness(
    (size) => (
      <WidgetThemeProvider theme={theme}>
        <NativeGreeterView {...size} state={state} actions={actions} now={now} />
      </WidgetThemeProvider>
    ),
    width,
    height,
  );
  await app.settle();
  const key = (code: number, name: string, shift = false, repeat = false) => {
    if (name.length !== 1 || name === " ") return app.key(code, name, shift, repeat);
    const modifiers = { ctrl: false, alt: false, meta: false, shift };
    app.native.injectKey({ type: "down", code, key: name, text: name, modifiers, timeMs: 0 });
    app.native.injectKey({ type: "up", code, key: name, modifiers, timeMs: 1 });
    app.window.tick();
  };
  return {
    ...app,
    key,
    begins,
    answers,
    cancels,
    update: async (next: NativeGreeterState) => {
      state = next;
      app.window.requestRedraw();
      app.window.tick();
      await app.settle();
    },
    clickId: (id: string) => {
      const hit = hits().find((item) => item.focusId === id && item.focusable);
      assert.ok(hit);
      app.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
    },
  };
}
let workflows = 0,
  frames = 0;
const captures: string[] = [];
const captureDirectory =
  process.env.MOIRE_NATIVE_GREETER_CAPTURE_DIR ??
  path.join(os.tmpdir(), "moire-native-ui-captures");
try {
  const username = await presentation();
  try {
    username.key(30, "a");
    username.key(48, "b");
    username.key(28, "Enter");
    username.key(28, "Enter");
    assert.deepEqual(username.begins, [["ab", 0]]);
    assert.ok(!text().includes("ab"));
    await username.update({ kind: "ready", revision: 1, message: "Sign-in denied" });
    username.key(30, "a");
    username.key(28, "Enter");
    assert.deepEqual(username.begins, [
      ["ab", 0],
      ["a", 1],
    ]);
    workflows++;
  } finally {
    username.destroy();
  }

  for (const style of ["secret", "visible", "info", "error"] satisfies (
    | "secret"
    | "visible"
    | "info"
    | "error"
  )[]) {
    const state = prompt(style),
      app = await presentation(state);
    try {
      app.key(15, "Tab");
      const entry = style === "secret" || style === "visible";
      if (entry) {
        app.key(30, "a");
        app.key(48, "b");
        assert.equal(text().includes("ab"), style === "visible");
        if (style === "secret") assert.ok(text().includes("••"), "Actual TextField paints masking");
      }
      app.key(28, "Enter");
      app.key(28, "Enter");
      assert.deepEqual(app.answers, [[state.attemptId, state.promptId, entry ? "ab" : null]]);
      assert.ok(!text().includes("ab") && !text().includes("••"));
      const cancelsBeforeReplacement = app.cancels.length;
      const next = prompt(style);
      await app.update(next);
      app.key(28, "Enter");
      app.key(1, "Escape");
      assert.deepEqual(
        app.cancels.slice(cancelsBeforeReplacement),
        [[next.attemptId]],
        "Prompt defaults to exact safe Cancel",
      );
      workflows++;
    } finally {
      app.destroy();
    }
  }
  const changing = await presentation(prompt("secret"));
  try {
    changing.key(15, "Tab");
    changing.key(30, "a");
    const stale = hits().find((hit) => hit.focusId === "native:answer")?.onPress;
    assert.ok(stale);
    const next = prompt("secret");
    await changing.update(next);
    stale({ x: 0, y: 0, button: "left", localX: 0, localY: 0 });
    assert.equal(changing.answers.length, 0);
    assert.ok(!text().includes("•"));
    changing.key(15, "Tab");
    changing.key(48, "b");
    await changing.update({ kind: "unavailable", message: "Authentication unavailable" });
    assert.ok(!text().includes("•"));
    assert.equal(hits().filter((hit) => hit.focusable && hit.focusScopeActive !== false).length, 0);
    stale({ x: 0, y: 0, button: "left", localX: 0, localY: 0 });
    changing.key(28, "Enter");
    changing.key(1, "Escape");
    assert.equal(changing.answers.length + changing.cancels.length, 0);
    workflows++;
  } finally {
    changing.destroy();
  }

  const waiting = {
    kind: "authenticating",
    attemptId: newAttemptId(),
  } satisfies NativeGreeterState;
  const cancellation = await presentation(waiting);
  try {
    cancellation.key(1, "Escape");
    cancellation.key(1, "Escape");
    assert.deepEqual(cancellation.cancels, [[waiting.attemptId]]);
    workflows++;
  } finally {
    cancellation.destroy();
  }

  const resize = await presentation(prompt("secret"), 1280, 800, 1.5);
  try {
    resize.key(15, "Tab");
    resize.key(30, "a");
    resize.key(48, "b");
    const focus = hits().find(
      (hit) => hit.focusable && hit.focusId?.startsWith("text-field:"),
    )?.focusId;
    assert.ok(focus);
    for (const size of [
      { width: 640, height: 640 },
      { width: 1280, height: 800 },
    ]) {
      resize.native.setSize(size.width, size.height);
      resize.window.tick();
      await resize.settle();
      assert.ok(text().includes("••") && !text().includes("ab"));
      assert.ok(hits().some((hit) => hit.focusable && hit.focusId === focus));
      assert.equal(resize.native.lastFrame?.length, size.width * size.height * 4);
      assert.equal(resize.window.hasActiveAnimations(), false);
    }
    resize.clickId("native:answer");
    assert.equal(resize.answers[0]?.[2], "ab");
    workflows++;
  } finally {
    resize.destroy();
  }
  const accessibility = await presentation();
  try {
    accessibility.key(30, "a");
    accessibility.clickId("native:accessibility");
    accessibility.key(57, " ");
    assert.ok(text().some((value) => value.includes("Motion stays reduced")));
    await accessibility.settle();
    assert.equal(accessibility.window.hasActiveAnimations(), false);
    accessibility.key(1, "Escape");
    accessibility.clickId("native:begin");
    assert.deepEqual(
      accessibility.begins,
      [["a", 0]],
      "Session-local presentation preserves username draft",
    );
    accessibility.clickId("native:accessibility");
    await accessibility.update(prompt("info"));
    assert.ok(!text().some((value) => value.includes("Motion stays reduced")));
    accessibility.key(28, "Enter");
    assert.equal(accessibility.cancels.length, 1, "New prompt safely restores Cancel after modal");
    workflows++;
  } finally {
    accessibility.destroy();
  }

  const states: NativeGreeterState[] = [
    ready,
    prompt("secret"),
    prompt("info"),
    { kind: "launching", attemptId: newAttemptId() },
    { kind: "cancelling", attemptId: newAttemptId() },
    { kind: "launch-committed" },
    { kind: "unavailable", message: "Authentication unavailable" },
  ];
  for (const scheme of ["dark", "light"] satisfies ("dark" | "light")[])
    for (const scale of [1, 1.5])
      for (const size of [
        { width: 1280, height: 800 },
        { width: 640, height: 640 },
      ])
        for (const state of states) {
          const app = await presentation(state, size.width, size.height, scale, scheme);
          try {
            assert.equal(app.native.lastFrame?.length, size.width * size.height * 4);
            assert.equal(app.window.getRenderingState().kind, "static");
            assert.equal(app.window.hasActiveAnimations(), false);
            for (const hit of hits().filter(
              (hit) => hit.focusable && hit.focusScopeActive !== false,
            ))
              assert.ok(
                hit.x >= 0 &&
                  hit.y >= 0 &&
                  hit.x + hit.width <= size.width + 1 &&
                  hit.y + hit.height <= size.height + 1,
                `Control outside viewport ${hit.focusId}`,
              );
            if (
              state.kind !== "ready" &&
              state.kind !== "prompt" &&
              state.kind !== "authenticating"
            ) {
              app.key(28, "Enter");
              app.key(1, "Escape");
              assert.equal(app.begins.length + app.answers.length + app.cancels.length, 0);
            }
            if (
              (scheme === "dark" && scale === 1.5 && size.width === 640) ||
              (scheme === "light" && scale === 1 && size.width === 1280)
            ) {
              if (state.kind === "ready" || (state.kind === "prompt" && state.style === "secret")) {
                if (state.kind === "prompt") {
                  app.key(15, "Tab");
                  app.key(30, "a");
                  app.key(48, "b");
                }
                const filename = path.join(
                  captureDirectory,
                  `native-${state.kind}-${scheme}-${size.width}x${size.height}-scale${scale}.png`,
                );
                await app.capture(filename, size);
                captures.push(filename);
              }
            }
            frames++;
          } finally {
            app.destroy();
          }
        }
  console.log(
    JSON.stringify({
      test: "native-greeter-view",
      workflows,
      frames,
      captures,
      actualWindow: true,
      actualCpuPixels: true,
      reducedMotion: true,
      authority: "frontend-only",
    }),
  );
} finally {
  SoftwareRenderer.prototype.render = originalRender;
  setUiScaleFactor(1);
}
