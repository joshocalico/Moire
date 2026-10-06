/** Actual public Window input and CPU scene/pixels; synthetic data only. */
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { collectHits, SoftwareRenderer, type SceneNode, type HitRegion } from "@moire/react-host";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
} from "@moire/ui";
import {
  loginId,
  type AnswerLogin,
  type BeginLogin,
  type LoginState,
  type SessionSelection,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Fixture-only authority has no production package export.
} from "../../../display-manager/src/types";
// oxlint-disable-next-line import/no-relative-parent-imports -- Reuse the existing readonly public Window fixture, without changing its owner.
import { greeterHarness } from "../testing";
import { LoginFixtureView } from "./view";
import type { LoginActions, LoginUiSnapshot } from "./types";
const now = new Date("2026-10-04T12:34:00Z");
const selection: SessionSelection = {
  id: loginId("fixture-session"),
  generation: "fixture-catalog-1",
  label: "Moire Wayland · configured fixture",
  protocol: "wayland",
  desktop: "Moire",
  descriptorPath: "/fixture/configured.desktop",
  argv: ["/fixture/harmless"],
};
const ready: LoginState = {
  kind: "ready",
  greeter: { id: loginId("fixture-greeter"), generation: 1, qualification: "fixture" },
  message: "",
};
function prompt(
  style: "secret" | "visible" | "info" | "error",
  id = "fixture-prompt",
): Extract<LoginState, { kind: "prompt" }> {
  return {
    kind: "prompt",
    attemptId: loginId("fixture-attempt"),
    selection,
    account: "synthetic-account",
    prompt: { id: loginId(id), style, message: `${style} fixture prompt` },
  };
}
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
function text(): string[] {
  return nodes(scene()).flatMap((node) => (typeof node.text === "string" ? [node.text] : []));
}
function hits(): HitRegion[] {
  return collectHits(scene());
}
let workflows = 0,
  frames = 0;
const captures: string[] = [];
const captureDirectory = path.resolve(
  process.env.MOIRE_LOGIN_GREETER_CAPTURE_DIR ??
    "vm/verification/2026-10-04-c56-login-greeter/owner-evidence/ui/captures",
);
async function fixture(
  state: LoginState = ready,
  width = 1280,
  height = 800,
  scale = 1,
  colorScheme: "dark" | "light" = "dark",
) {
  setUiScaleFactor(scale);
  let snapshot: LoginUiSnapshot = {
    qualification: "fixture",
    state,
    selection,
    active: true,
    message: "",
    motion: { reducedMotion: true, status: "ready" },
  };
  const begins: BeginLogin[] = [],
    answers: AnswerLogin[] = [],
    cancels: string[] = [],
    motion: boolean[] = [];
  let fail = false;
  const actions: LoginActions = {
    begin: async (request) => {
      begins.push(request);
      if (fail) throw new Error("synthetic failure");
    },
    answer: async (request) => {
      answers.push(request);
      if (fail) throw new Error("synthetic failure");
    },
    cancel: async (id) => {
      cancels.push(id);
    },
    saveReducedMotion: async (value) => {
      motion.push(value);
    },
  };
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", { themeFamily: "moire", colorScheme, reducedMotion: true }),
  );
  const app = await greeterHarness(
    (size, window) => (
      <WidgetThemeProvider theme={theme}>
        <LoginFixtureView
          {...size}
          snapshot={snapshot}
          actions={actions}
          now={now}
          backdropAdmission={window.getRetainedMotionAdmission()}
        />
      </WidgetThemeProvider>
    ),
    width,
    height,
  );
  await app.settle();
  const update = async (changes: Partial<LoginUiSnapshot>) => {
    snapshot = { ...snapshot, ...changes };
    app.window.requestRedraw();
    app.window.tick();
    await app.settle();
  };
  const clickId = (id: string) => {
    const hit = hits().find((item) => item.focusId === id && item.focusable);
    assert.ok(hit, `Missing ${id}`);
    app.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  };
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
    motion,
    update,
    clickId,
    fail: () => {
      fail = true;
    },
  };
}
try {
  const begin = await fixture();
  try {
    begin.key(30, "a");
    begin.key(48, "b");
    begin.key(28, "Enter");
    begin.key(28, "Enter");
    assert.equal(begin.begins.length, 1);
    assert.deepEqual(begin.begins[0], {
      greeter: ready.kind === "ready" ? ready.greeter : null,
      account: "ab",
      sessionId: selection.id,
      catalogGeneration: selection.generation,
    });
    assert.ok(!text().includes("ab"), "account draft cleared after submit");
    await begin.update({ state: { ...ready, message: "Synthetic denial. Try again." } });
    begin.key(30, "a");
    begin.key(28, "Enter");
    assert.equal(
      begin.begins.length,
      2,
      "fresh ready snapshot permits explicit retry with exact same greeter identity",
    );
    await begin.update({
      state: {
        kind: "ready",
        greeter: { id: loginId("fixture-greeter-new"), generation: 2, qualification: "fixture" },
        message: "Synthetic denial. Try again.",
      },
    });
    begin.key(30, "a");
    begin.key(28, "Enter");
    assert.equal(begin.begins.length, 3, "fresh ready permits explicit retry");
    workflows++;
  } finally {
    begin.destroy();
  }

  for (const style of ["secret", "visible", "info", "error"] satisfies (
    | "secret"
    | "visible"
    | "info"
    | "error"
  )[]) {
    const app = await fixture(prompt(style));
    try {
      app.key(15, "Tab");
      if (style === "secret" || style === "visible") {
        app.key(30, "a");
        app.key(48, "b");
        assert.equal(text().includes("ab"), style === "visible");
        if (style === "secret")
          assert.ok(text().includes("••"), "actual painted scene masks the draft");
      }
      app.key(28, "Enter");
      app.key(28, "Enter");
      assert.deepEqual(app.answers, [
        {
          attemptId: loginId("fixture-attempt"),
          promptId: loginId("fixture-prompt"),
          response: style === "secret" || style === "visible" ? "ab" : null,
        },
      ]);
      assert.ok(
        !text().includes("ab") && !text().includes("••"),
        "prompt draft cleared before consumed presentation",
      );
      const cancelsBeforeReplacement = app.cancels.length;
      await app.update({ state: prompt(style, "fixture-prompt-new") });
      app.key(28, "Enter");
      app.key(1, "Escape");
      assert.equal(
        app.cancels.length,
        cancelsBeforeReplacement + 1,
        "replacement defaults to Cancel and is single use",
      );
      workflows++;
    } finally {
      app.destroy();
    }
  }

  const changing = await fixture(prompt("secret"));
  try {
    changing.key(15, "Tab");
    changing.key(30, "a");
    const oldAnswer = hits().find((hit) => hit.focusId === "login:answer")?.onPress;
    assert.ok(oldAnswer);
    await changing.update({
      state: { ...prompt("secret"), account: "synthetic-account-new" } satisfies LoginState,
    });
    assert.ok(!text().includes("•"));
    oldAnswer({ x: 0, y: 0, button: "left", localX: 0, localY: 0 });
    assert.equal(changing.answers.length, 0, "stale handler cannot answer changed account");
    changing.key(15, "Tab");
    changing.key(48, "b");
    await changing.update({ selection: { ...selection, generation: "fixture-catalog-2" } });
    assert.ok(!text().some((value) => value.includes("•")));
    changing.key(28, "Enter");
    changing.key(1, "Escape");
    assert.equal(changing.answers.length, 0, "mismatched catalog has no prompt input");
    await changing.update({ state: prompt("secret"), selection, active: false });
    changing.key(28, "Enter");
    changing.key(1, "Escape");
    assert.equal(changing.answers.length, 0);
    assert.equal(changing.cancels.length, 0);
    changing.window.requestClose();
    oldAnswer({ x: 0, y: 0, button: "left", localX: 0, localY: 0 });
    assert.equal(changing.answers.length, 0);
    workflows++;
  } finally {
    changing.destroy();
  }

  const pointer = await fixture(prompt("visible"));
  try {
    pointer.key(15, "Tab");
    pointer.key(30, "a");
    pointer.clickId("login:answer");
    assert.equal(pointer.answers[0]?.response, "a");
    await pointer.update({ state: prompt("secret", "escape-prompt") });
    pointer.key(15, "Tab");
    pointer.key(30, "a");
    pointer.key(1, "Escape");
    assert.deepEqual(pointer.cancels, ["fixture-attempt"]);
    assert.ok(!text().includes("•"));
    await pointer.update({
      state: {
        kind: "authenticating",
        attemptId: loginId("pending-attempt"),
        selection,
        account: "synthetic-account",
      },
    });
    pointer.key(1, "Escape");
    pointer.key(1, "Escape");
    assert.deepEqual(pointer.cancels, ["fixture-attempt", "pending-attempt"]);
    workflows++;
  } finally {
    pointer.destroy();
  }

  const failure = await fixture(prompt("secret"));
  try {
    failure.fail();
    failure.key(15, "Tab");
    failure.key(30, "a");
    failure.key(28, "Enter");
    await failure.settle();
    assert.ok(!text().includes("•"));
    failure.key(28, "Enter");
    assert.equal(failure.answers.length, 1);
    assert.ok(text().includes("Fixture request failed. Cancel or wait for a fresh attempt."));
    workflows++;
  } finally {
    failure.destroy();
  }

  const replacement = await fixture(prompt("secret"));
  try {
    replacement.key(15, "Tab");
    replacement.key(30, "a");
    await replacement.update({
      state: {
        ...prompt("secret", "replacement-prompt"),
        attemptId: loginId("replacement-attempt"),
      },
    });
    replacement.key(28, "Enter");
    assert.deepEqual(
      replacement.cancels,
      ["replacement-attempt"],
      "immediate Enter after prompt replacement safely cancels exact new attempt",
    );
    assert.equal(replacement.answers.length, 0);
    workflows++;
  } finally {
    replacement.destroy();
  }

  const rejectedBegin = await fixture();
  try {
    rejectedBegin.fail();
    rejectedBegin.key(30, "a");
    rejectedBegin.key(28, "Enter");
    await rejectedBegin.settle();
    assert.equal(rejectedBegin.begins.length, 1);
    assert.ok(!text().includes("a"));
    rejectedBegin.key(30, "a");
    rejectedBegin.key(28, "Enter");
    await rejectedBegin.settle();
    assert.equal(
      rejectedBegin.begins.length,
      2,
      "rejected begin clears input and permits explicit fresh typing",
    );
    workflows++;
  } finally {
    rejectedBegin.destroy();
  }

  const accessibility = await fixture();
  try {
    accessibility.key(30, "a");
    accessibility.clickId("login:accessibility");
    accessibility.key(57, " ");
    assert.deepEqual(accessibility.motion, [false]);
    await accessibility.update({ motion: { reducedMotion: true, status: "failed" } });
    assert.ok(text().includes("Could not save. Try the preference again."));
    accessibility.key(1, "Escape");
    accessibility.key(28, "Enter");
    accessibility.key(57, " ");
    assert.equal(accessibility.motion.length, 2);
    await accessibility.update({ motion: { reducedMotion: false, status: "saved" } });
    assert.ok(text().includes("Saved for this fixture."));
    assert.equal(accessibility.window.hasActiveAnimations(), false);
    accessibility.key(1, "Escape");
    assert.ok(text().includes("a"), "preference-only changes preserve ready account draft");
    accessibility.clickId("login:begin");
    assert.equal(accessibility.begins[0]?.account, "a");
    accessibility.clickId("login:accessibility");
    await accessibility.update({ state: prompt("secret", "prompt-after-accessibility") });
    accessibility.key(28, "Enter");
    assert.deepEqual(
      accessibility.cancels,
      ["fixture-attempt"],
      "new prompt closes prior accessibility modal and restores safe Cancel",
    );
    assert.equal(accessibility.answers.length, 0);
    workflows++;
  } finally {
    accessibility.destroy();
  }

  const resized = await fixture(prompt("secret", "resize-prompt"), 1280, 800, 1.5);
  try {
    resized.key(15, "Tab");
    resized.key(30, "a");
    resized.key(48, "b");
    const responseFocus = hits().find(
      (hit) => hit.focusable && hit.focusId?.startsWith("text-field:"),
    )?.focusId;
    assert.ok(responseFocus);
    const resize = async (width: number, height: number) => {
      resized.native.setSize(width, height);
      resized.window.tick();
      await resized.settle();
      for (let settle = 0; settle < 5 && resized.window.hasActiveAnimations(); settle++)
        await resized.settle();
      assert.equal(
        resized.native.lastFrame?.length,
        width * height * 4,
        "actual configure produces resized CPU pixels",
      );
      for (const hit of hits().filter((hit) => hit.focusable && hit.focusScopeActive !== false))
        assert.ok(
          hit.x >= 0 &&
            hit.y >= 0 &&
            hit.x + hit.width <= width + 1 &&
            hit.y + hit.height <= height + 1,
          `Resized control outside viewport ${hit.focusId}`,
        );
      assert.equal(resized.window.hasActiveAnimations(), false);
    };
    await resize(640, 640);
    assert.ok(
      text().includes("••") && !text().includes("ab"),
      "compact resize keeps secret masked",
    );
    assert.ok(
      hits().some((hit) => hit.focusId === responseFocus && hit.focusable),
      "compact resize preserves same response input",
    );
    await resize(1280, 800);
    assert.ok(text().includes("••") && !text().includes("ab"), "wide return keeps secret masked");
    assert.ok(hits().some((hit) => hit.focusId === responseFocus && hit.focusable));
    resized.key(28, "Enter");
    assert.deepEqual(
      resized.answers,
      [
        {
          attemptId: loginId("fixture-attempt"),
          promptId: loginId("resize-prompt"),
          response: "ab",
        },
      ],
      "resize preserves focused field and exact prompt submission",
    );
    assert.equal(resized.cancels.length, 0);
    await resized.update({ state: ready });
    resized.clickId("login:accessibility");
    await resize(640, 640);
    assert.ok(text().includes("Reduce motion"), "open popup survives compact configure");
    resized.key(57, " ");
    assert.deepEqual(resized.motion, [false], "compact popup preserves checkbox focus");
    await resized.update({ motion: { reducedMotion: false, status: "saved" } });
    await resize(1280, 800);
    assert.ok(text().includes("Saved for this fixture."));
    resized.key(57, " ");
    assert.deepEqual(resized.motion, [false, true], "wide popup return preserves checkbox focus");
    resized.key(1, "Escape");
    resized.key(28, "Enter");
    assert.ok(
      text().includes("Reduce motion"),
      "resized popup Escape restores actual opener focus",
    );
    workflows++;
  } finally {
    resized.destroy();
  }

  const states: LoginState[] = [
    ready,
    prompt("secret"),
    prompt("info"),
    { kind: "blocked", message: "Unknown cleanup. Restart forbidden." },
    { kind: "retiring-greeter", attemptId: loginId("fixture-attempt"), selection },
    { kind: "inactive" },
  ];
  for (const scheme of ["dark", "light"] satisfies ("dark" | "light")[])
    for (const scale of [1, 1.5])
      for (const size of [
        { width: 1280, height: 800 },
        { width: 640, height: 640 },
      ])
        for (const state of states) {
          const app = await fixture(state, size.width, size.height, scale, scheme);
          try {
            if (state.kind === "blocked") {
              await app.update({ active: false, message: "Fixture cleanup remains unresolved." });
              assert.ok(
                text().includes(state.message),
                "inactive blocked presentation retains canonical status",
              );
              assert.ok(
                text().includes("Fixture cleanup remains unresolved."),
                "binding action/retirement error stays visible",
              );
              assert.equal(
                hits().filter((hit) => hit.focusable && hit.focusScopeActive !== false).length,
                0,
              );
            }
            assert.equal(app.native.lastFrame?.length, size.width * size.height * 4);
            assert.equal(app.window.getRenderingState().kind, "static");
            assert.equal(app.window.hasActiveAnimations(), false);
            assert.ok(text().some((value) => value.includes("Source CPU fixture")));
            for (const hit of hits().filter(
              (hit) => hit.focusable && hit.focusScopeActive !== false,
            ))
              assert.ok(
                hit.x >= 0 &&
                  hit.y >= 0 &&
                  hit.x + hit.width <= size.width + 1 &&
                  hit.y + hit.height <= size.height + 1,
                `Out of viewport: ${hit.focusId}`,
              );
            if (
              state.kind === "blocked" ||
              state.kind === "retiring-greeter" ||
              state.kind === "inactive"
            ) {
              app.key(28, "Enter");
              app.key(1, "Escape");
              assert.equal(app.begins.length + app.answers.length + app.cancels.length, 0);
            }
            const before = app.native.lastFrame?.slice();
            await app.settle();
            assert.deepEqual(app.native.lastFrame, before);
            if (
              state.kind === "prompt" &&
              state.prompt.style === "secret" &&
              ((scheme === "dark" && scale === 1.5 && size.width === 640) ||
                (scheme === "light" && scale === 1 && size.width === 1280))
            ) {
              app.key(15, "Tab");
              app.key(30, "a");
              app.key(48, "b");
              assert.ok(!text().includes("ab"));
              const file = path.join(
                captureDirectory,
                `login-secret-${scheme}-${size.width}x${size.height}-scale${scale}.png`,
              );
              await app.capture(file, size);
              captures.push(file);
            }
            if (state.kind === "ready") {
              app.clickId("login:accessibility");
              for (const hit of hits().filter(
                (hit) => hit.focusable && hit.focusScopeTrap && hit.focusScopeActive !== false,
              ))
                assert.ok(
                  hit.x >= 0 &&
                    hit.y >= 0 &&
                    hit.x + hit.width <= size.width + 1 &&
                    hit.y + hit.height <= size.height + 1,
                  `Popup outside viewport ${hit.focusId}`,
                );
              app.key(1, "Escape");
            }
            frames++;
          } finally {
            app.destroy();
          }
        }
  console.log(
    JSON.stringify({
      fixture: "login-view",
      actualExitCode: 0,
      cases: workflows + frames,
      workflows,
      actualResize: true,
      resizeConfigurations: 4,
      frames,
      captures,
      qualification:
        "source CPU fixture; synthetic inputs, one live public Window; no native authentication or graphics claim",
    }),
  );
} finally {
  SoftwareRenderer.prototype.render = originalRender;
  setUiScaleFactor(1);
}
