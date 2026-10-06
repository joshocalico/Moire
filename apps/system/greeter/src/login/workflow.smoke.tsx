/** Actual CPU Window, private broker and owned harmless processes. No authentication authority. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, realpath, stat, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import React from "react";
import { SoftwareRenderer, collectHits, type SceneNode } from "@moire/react-host";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
} from "@moire/ui";
/* oxlint-disable import/no-relative-parent-imports -- Reuse root-approved immutable fixture authorities and the readonly public Window harness. */
import { greeterHarness } from "../testing";
import { createLoginBinding } from "./binding";
import { createFixtureGreeterMotionPreferences } from "./preferences";
import { LoginFixtureView } from "./view";
import type { LoginBinding } from "./types";
import { createFixtureGreetdClient } from "../../../display-manager/src/greetd-client";
import { createLoginController } from "../../../display-manager/src/login-controller";
import {
  loadSessionSelection,
  type SessionCatalogOptions,
} from "../../../display-manager/src/session-catalog";
import {
  createBrokerLaunch,
  launchSelectedSession,
} from "../../../display-manager/src/session-launcher";
import { createFixtureLifecycle } from "../../../display-manager/src/session-lifecycle";
import { fixtureProcessArgv } from "../../../display-manager/src/testing/fixture-process";
import {
  startFakeGreetd,
  type FixtureReply,
} from "../../../display-manager/src/testing/fake-greetd";
import {
  type LoginController,
  type SessionLifecycleAuthority,
} from "../../../display-manager/src/types";

/* oxlint-enable import/no-relative-parent-imports */

const SECRET = "SYNTHETIC-WORKFLOW-SECRET";
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function sceneText(node: SceneNode): string {
  return [node.text ?? "", ...node.children.map(sceneText)].join("\n");
}
function state<T extends LoginController["state"]["kind"]>(controller: LoginController, kind: T) {
  const current = controller.state;
  if (current.kind !== kind) throw new Error(`Expected ${kind}, observed ${current.kind}`);
  return current;
}
const conversation: readonly FixtureReply[] = [
  { type: "auth_message", auth_message_type: "secret", auth_message: "Synthetic secret response" },
  { type: "auth_message", auth_message_type: "info", auth_message: "Fixture information" },
  { type: "success" },
];
const directory = await mkdtemp("/tmp/m56-ui-");
const renderer = SoftwareRenderer.prototype.render;
let scene: SceneNode | undefined;
let viewportSize = { width: 0, height: 0 };
SoftwareRenderer.prototype.render = function (root, viewport) {
  scene = root;
  viewportSize = { width: viewport.width, height: viewport.height };
  return renderer.call(this, root, viewport);
};
const presentations: Awaited<ReturnType<typeof greeterHarness>>[] = [];
const snapshots: string[] = [];
const ordering: string[] = [];
let current: Awaited<ReturnType<typeof greeterHarness>> | undefined;
let binding: LoginBinding | undefined;
let controller: LoginController | undefined;
let owned: ReturnType<typeof createFixtureLifecycle> | undefined;
let broker: Awaited<ReturnType<typeof startFakeGreetd>> | undefined;
let preferences: Awaited<ReturnType<typeof createFixtureGreeterMotionPreferences>> | undefined;
const scheduleGate = deferred(),
  retirementGate = deferred(),
  answerGate = deferred();
let holdSchedule = false,
  holdRetirement = false,
  holdAnswer = false;
let scheduleEntered = false,
  retirementEntered = false;
let consoleIntent = false,
  uncertainCleanup = false;
let closureChecks = 0,
  fullFlows = 0;
async function waitFor(test: () => boolean, label: string) {
  const until = Date.now() + 7000;
  while (!test()) {
    assert(
      Date.now() < until,
      `Timed out waiting for ${label}: ${JSON.stringify({ kind: controller?.state.kind, active: binding?.snapshot().active, message: binding?.snapshot().message, counters: broker?.counters })}`,
    );
    current?.window.requestRedraw();
    current?.window.tick();
    await new Promise((done) => setTimeout(done, 10));
  }
  current?.window.requestRedraw();
  current?.window.tick();
}
function text(value: string) {
  assert(current && !current.window.isClosed());
  const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
  for (const character of value) {
    current.native.injectKey({
      type: "down",
      code: 0,
      key: character,
      text: character,
      modifiers,
      timeMs: 0,
    });
    current.native.injectKey({ type: "up", code: 0, key: character, modifiers, timeMs: 1 });
  }
  current.window.tick();
}
function press(id: string) {
  assert(current && scene && !current.window.isClosed());
  current.window.tick();
  const hits = collectHits(scene);
  const hit = hits.find((candidate) => candidate.focusId === id);
  assert(
    hit?.onPress,
    `Missing actual hit ${id}: ${JSON.stringify({ kind: controller?.state.kind, active: binding?.snapshot().active, hits: hits.map((item) => ({ id: item.focusId, x: item.x, y: item.y, scope: item.focusScopeActive })) })}`,
  );
  const x = hit.x + hit.width / 2,
    y = hit.y + hit.height / 2;
  assert(x >= 0 && x < viewportSize.width && y >= 0 && y < viewportSize.height);
  current.click(x, y);
}
async function answerThroughWindow() {
  const before = state(controller!, "prompt");
  assert(before.kind === "prompt");
  if (before.prompt.style === "secret" || before.prompt.style === "visible") {
    current!.key(15, "Tab");
    text(before.prompt.style === "secret" ? SECRET : "SYNTHETIC-VISIBLE");
    assert(scene);
    if (before.prompt.style === "secret") assert(!sceneText(scene).includes(SECRET));
  }
  press("login:answer");
  await waitFor(() => {
    const next = controller!.state;
    return (
      next.kind !== "authenticating" &&
      (next.kind !== "prompt" ||
        (next.prompt.id !== before.prompt.id && binding!.snapshot().active))
    );
  }, "prompt transition");
}
try {
  const executable = await realpath(process.execPath);
  const argv = fixtureProcessArgv();
  const quote = (value: string) =>
    `"${value.replaceAll("%", "%%").replace(/[\\"`$]/g, (character) => `\\${character}`)}"`.replaceAll(
      "\\",
      "\\\\",
    );
  const descriptorPath = join(directory, "session.desktop");
  const originalDescriptor = `[Desktop Entry]\nType=Application\nName=Moire fixture\nDesktopNames=MoireFixture;\nExec=${argv.map(quote).join(" ")}\n`;
  await writeFile(descriptorPath, originalDescriptor, { mode: 0o600 });
  const launcherPath = join(directory, "launcher");
  await writeFile(launcherPath, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
  const catalog: SessionCatalogOptions = {
    qualification: "fixture",
    descriptorPath,
    trustedRoots: [directory],
    executableRoots: [dirname(executable)],
    searchPath: [dirname(executable)],
  };
  const launcher = {
    qualification: "fixture",
    path: launcherPath,
    trustedRoots: [directory],
  } satisfies Parameters<typeof createBrokerLaunch>[1];
  let selection = await loadSessionSelection(catalog);
  owned = createFixtureLifecycle({
    qualification: "fixture",
    launchSession: ({ selection: selected }, context) =>
      launchSelectedSession({
        qualification: "fixture",
        catalog,
        id: selected.id,
        generation: selected.generation,
        ipc: true,
        signal: context.signal,
        onSpawn: context.onSpawn,
      }),
  });
  const authority = owned;
  const lifecycle: SessionLifecycleAuthority = {
    qualification: "fixture",
    async createGreeter() {
      assert(
        !current || current.window.isClosed(),
        "Fresh authority cannot coexist with old Window",
      );
      const identity = await authority.createGreeter();
      ordering.push("fresh-greeter");
      return identity;
    },
    async retireGreeter(identity) {
      assert(current?.window.isClosed(), "Presentation must synchronously close before release");
      closureChecks++;
      ordering.push("window-closed");
      if (uncertainCleanup)
        return { kind: "unresolved", message: "Controlled fixture cleanup uncertainty" };
      const result = await authority.retireGreeter(identity);
      if (holdRetirement) {
        retirementEntered = true;
        await retirementGate.promise;
      }
      ordering.push(`greeter-${result.kind}`);
      return result;
    },
    async observeStarted(request) {
      assert.equal(ordering.at(-1), "greeter-released");
      const identity = await authority.observeStarted(request);
      ordering.push("session-ready");
      return identity;
    },
    cancelLaunch: (id) => authority.cancelLaunch(id),
    async retireSession(identity) {
      const result = await authority.retireSession(identity);
      ordering.push(`session-${result.kind}`);
      return result;
    },
    dispose: () => authority.dispose(),
  };
  broker = await startFakeGreetd({
    qualification: "fixture",
    directory,
    conversations: [
      conversation,
      conversation,
      [{ type: "error", error_type: "auth_error", description: "Synthetic denial" }],
      conversation,
      conversation,
      conversation,
      conversation,
    ],
    async onStart(request) {
      assert.deepEqual(request.cmd, createBrokerLaunch(selection, launcher).command);
      assert.deepEqual(request.env, []);
      if (holdSchedule) {
        scheduleEntered = true;
        await scheduleGate.promise;
      }
      ordering.push("broker-scheduled");
    },
  });
  const privateBroker = broker;
  controller = createLoginController({
    qualification: "fixture",
    createBroker: async () => {
      const client = await createFixtureGreetdClient({
        qualification: "fixture",
        connect: () => privateBroker.createConnection(),
      });
      return {
        ...client,
        async answer(response) {
          const reply = await client.answer(response);
          if (holdAnswer) await answerGate.promise;
          return reply;
        },
      };
    },
    loadSelection: () => loadSessionSelection(catalog),
    brokerLaunch: (selected) => createBrokerLaunch(selected, launcher),
    lifecycle,
    consoleRequested: () => consoleIntent,
    timeoutMs: 5000,
  });
  const active = controller;
  const preferencePath = join(directory, "motion.json");
  preferences = await createFixtureGreeterMotionPreferences({
    qualification: "fixture",
    path: preferencePath,
  });
  assert.deepEqual(preferences.snapshot(), { reducedMotion: true, status: "ready" });
  const prefs = preferences;
  prefs.subscribe(() => {
    throw new Error("Listener fixture");
  });
  const first = prefs.setReducedMotion(false),
    second = prefs.setReducedMotion(true);
  assert.equal(prefs.snapshot().status, "saving");
  await Promise.all([first, second]);
  assert.deepEqual(JSON.parse(await readFile(preferencePath, "utf8")), { reducedMotion: true });
  assert.equal((await stat(preferencePath)).mode & 0o777, 0o600);
  const reopened = await createFixtureGreeterMotionPreferences({
    qualification: "fixture",
    path: preferencePath,
  });
  assert.equal(reopened.snapshot().reducedMotion, true);
  reopened.dispose();
  await rm(preferencePath);
  await mkdir(preferencePath, { mode: 0o700 });
  await assert.rejects(
    prefs.setReducedMotion(false),
    /^Error: Fixture motion preference save failed$/,
  );
  assert.equal(prefs.snapshot().status, "failed");
  await rm(preferencePath, { recursive: true });
  await prefs.setReducedMotion(true);
  const invalidPath = join(directory, "invalid-motion.json");
  await writeFile(invalidPath, JSON.stringify({ reducedMotion: false, extra: true }), {
    mode: 0o600,
  });
  const invalid = await createFixtureGreeterMotionPreferences({
    qualification: "fixture",
    path: invalidPath,
  });
  assert.deepEqual(invalid.snapshot(), { reducedMotion: true, status: "failed" });
  invalid.dispose();
  await active.initialize();
  async function mount(
    width: number,
    height: number,
    scale: number,
    colorScheme: "light" | "dark",
  ) {
    assert(!current || current.window.isClosed());
    binding?.dispose();
    const next = createLoginBinding({
      qualification: "fixture",
      controller: active,
      selection,
      preferences: prefs,
      retirePresentation: () => {
        assert(current);
        current.window.destroy();
        ordering.push("presentation-retired");
      },
    });
    binding = next;
    setUiScaleFactor(scale);
    const theme = createPersonalizedWidgetTheme(
      discoverPersonalization("linux", { themeFamily: "moire", colorScheme, reducedMotion: true }),
    );
    current = await greeterHarness(
      (size) => (
        <WidgetThemeProvider theme={theme}>
          <LoginFixtureView
            {...size}
            snapshot={next.snapshot()}
            actions={next.actions}
            now={new Date("2026-10-04T12:00:00Z")}
          />
        </WidgetThemeProvider>
      ),
      width,
      height,
    );
    presentations.push(current);
    next.subscribe(() => {
      snapshots.push(JSON.stringify(next.snapshot()));
      if (current && !current.window.isClosed()) {
        current.window.requestRedraw();
        current.window.tick();
      }
    });
    next.subscribe(() => {
      throw new Error("Presentation listener fixture");
    });
    assert(current.native.lastFrame);
  }
  async function begin() {
    await waitFor(
      () => active.state.kind === "ready" && binding!.snapshot().active,
      "settled ready form",
    );
    const before = active.state;
    assert(scene && current);
    const field = collectHits(scene).find(
      (hit) => hit.focusable && hit.focusId?.startsWith("text-field:"),
    );
    assert(field, "Actual ready account field must be reachable");
    current.click(field.x + field.width / 2, field.y + field.height / 2);
    text("fixture-account");
    press("login:begin");
    await waitFor(
      () =>
        (active.state !== before || (consoleIntent && binding!.snapshot().message.length > 0)) &&
        (active.state.kind === "prompt" || active.state.kind === "ready") &&
        binding!.snapshot().active,
      "broker response",
    );
  }
  for (let flow = 0; flow < 2; flow++) {
    await mount(flow ? 640 : 1280, 800, flow ? 1.5 : 1, flow ? "dark" : "light");
    const before = state(active, "ready");
    assert(before.kind === "ready");
    const desiredMotion = !prefs.snapshot().reducedMotion;
    press("login:accessibility");
    await current!.settle();
    await current!.settle();
    current!.key(57, " ");
    await waitFor(
      () => prefs.snapshot().status === "saved" && prefs.snapshot().reducedMotion === desiredMotion,
      "public Window preference save",
    );
    assert.deepEqual(JSON.parse(await readFile(preferencePath, "utf8")), {
      reducedMotion: desiredMotion,
    });
    current!.key(1, "Escape");
    const beginsBeforeFlow = privateBroker.counters.authenticationBegins;
    await begin();
    assert.equal(privateBroker.counters.authenticationBegins, beginsBeforeFlow + 1);
    const initial = state(active, "prompt");
    assert(initial.kind === "prompt");
    await answerThroughWindow();
    if (flow === 0) {
      holdSchedule = true;
      holdRetirement = true;
    }
    press("login:answer");
    if (flow === 0) {
      await waitFor(() => scheduleEntered, "held scheduling");
      assert.equal(active.state.kind, "authenticating");
      assert.equal(authority.diagnostics().filter((item) => item.role === "session").length, 0);
      scheduleGate.resolve();
      holdSchedule = false;
      await waitFor(() => retirementEntered, "held cleanup after complete owned retirement");
      assert.equal(active.state.kind, "retiring-greeter");
      assert(current!.window.isClosed());
      assert.equal(authority.diagnostics().filter((item) => item.role === "session").length, 0);
      retirementGate.resolve();
      holdRetirement = false;
    }
    await waitFor(() => active.state.kind === "running", "session ready");
    const running = state(active, "running");
    assert(running.kind === "running");
    assert(current!.window.isClosed());
    await assert.rejects(
      binding!.actions.answer({
        attemptId: initial.attemptId,
        promptId: initial.prompt.id,
        response: SECRET,
      }),
    );
    await active.logout(running.session);
    const fresh = state(active, "ready");
    assert(fresh.kind === "ready");
    assert(fresh.greeter.generation > before.greeter.generation);
    fullFlows++;
  }
  await mount(1280, 800, 1, "light");
  await begin();
  await waitFor(() => active.state.kind === "ready", "denial cleanup");
  assert.equal(privateBroker.counters.schedules, 2);
  await begin();
  const cancelledPrompt = state(active, "prompt");
  assert(cancelledPrompt.kind === "prompt");
  holdAnswer = true;
  current!.key(15, "Tab");
  text(SECRET);
  press("login:answer");
  await waitFor(() => privateBroker.counters.answers === 5, "held answer");
  press("login:cancel");
  await waitFor(() => active.state.kind === "ready", "held answer cancellation");
  holdAnswer = false;
  answerGate.resolve();
  await assert.rejects(
    binding!.actions.answer({
      attemptId: cancelledPrompt.attemptId,
      promptId: cancelledPrompt.prompt.id,
      response: SECRET,
    }),
  );
  const begins = privateBroker.counters.authenticationBegins;
  binding!.detach();
  await assert.rejects(
    binding!.actions.begin({
      greeter: (() => {
        const s = active.state;
        assert(s.kind === "ready");
        return s.greeter;
      })(),
      account: "fixture-account",
      sessionId: selection.id,
      catalogGeneration: selection.generation,
    }),
  );
  assert.equal(privateBroker.counters.authenticationBegins, begins);
  current!.destroy();
  await mount(1280, 800, 1, "light");
  await begin();
  await writeFile(descriptorPath, originalDescriptor.replace("Moire fixture", "Changed fixture"));
  await answerThroughWindow();
  press("login:answer");
  await waitFor(
    () => active.state.kind === "ready" || active.state.kind === "blocked",
    "changed catalog rejection",
  );
  assert.equal(privateBroker.counters.schedules, 2);
  await writeFile(descriptorPath, originalDescriptor);
  assert.equal(active.state.kind, "ready");
  // Rewriting a descriptor changes its authority generation even when bytes are restored.
  selection = await loadSessionSelection(catalog);
  current!.destroy();
  await mount(1280, 800, 1, "light");
  consoleIntent = true;
  await begin();
  await waitFor(
    () => active.state.kind === "ready" || active.state.kind === "blocked",
    "console guard",
  );
  assert.equal(privateBroker.counters.schedules, 2);
  consoleIntent = false;
  await begin();
  await answerThroughWindow();
  const failedPresentation = createLoginBinding({
    qualification: "fixture",
    controller: active,
    selection,
    preferences: prefs,
    retirePresentation: () => {
      throw new Error("Synthetic private callback failure");
    },
  });
  uncertainCleanup = true;
  press("login:answer");
  await waitFor(() => active.state.kind === "blocked", "uncertain cleanup");
  assert(current!.window.isClosed());
  assert.equal(failedPresentation.snapshot().state.kind, "blocked");
  assert.equal(failedPresentation.snapshot().active, false);
  assert(
    !JSON.stringify(failedPresentation.snapshot()).includes("Synthetic private callback failure"),
  );
  failedPresentation.dispose();
  assert.equal(authority.diagnostics().filter((item) => item.role === "session").length, 2);
  assert(!snapshots.join("\n").includes(SECRET));
  assert(!JSON.stringify(privateBroker.counters).includes(SECRET));
  assert(!String(await readFile(preferencePath)).includes(SECRET));
  uncertainCleanup = false;
  binding!.dispose();
  current!.destroy();
  await assert.rejects(active.dispose(), /unresolved/);
  controller = undefined;
  await authority.dispose();
  owned = undefined;
  const records = authority.diagnostics();
  assert(
    records.every(
      (record) => record.parentClosed && record.descendantCount === 1 && record.released,
    ),
  );
  await privateBroker.close();
  broker = undefined;
  console.log(
    JSON.stringify({
      actualExitCode: 0,
      fixture: "login-ui-workflow",
      fullUiLoginLogoutFlows: fullFlows,
      authenticationBegins: privateBroker.counters.authenticationBegins,
      brokerConnections: privateBroker.counters.connections,
      schedules: privateBroker.counters.schedules,
      freshAuthenticationRequired: true,
      windowClosureBeforeGreeterRelease: true,
      closureChecks,
      publicWindows: presentations.length,
      ownedParentsClosed: records.length,
      ownedProcessesReleased: records.filter((record) => record.released).length,
      logoutAuthority: "fixture-controller",
      ownership: records,
      ownedDescendantsClosed: records.reduce((n, record) => n + record.descendantCount, 0),
      denialRetry: true,
      heldSchedulingAndCleanup: true,
      heldAnswerCancellation: true,
      detachedActionsBlocked: true,
      stalePromptBlocked: true,
      changedCatalogBlocked: true,
      consoleIntentBlocked: true,
      uncertainCleanupBlocksReplacement: true,
      retirementCallbackFailureBlocked: true,
      privateBooleanPreferences: true,
      publicWindowPreferenceSaved: true,
      syntheticSecretRecorded: false,
      nativeAuthentication: false,
      nativeSeatAuthority: false,
    }),
  );
} finally {
  scheduleGate.resolve();
  retirementGate.resolve();
  answerGate.resolve();
  binding?.dispose();
  for (const presentation of presentations) presentation.destroy();
  if (controller) await controller.dispose().catch(() => {});
  await owned?.dispose();
  await broker?.close();
  preferences?.dispose();
  SoftwareRenderer.prototype.render = renderer;
  setUiScaleFactor(1);
  await rm(directory, { recursive: true, force: true });
}
