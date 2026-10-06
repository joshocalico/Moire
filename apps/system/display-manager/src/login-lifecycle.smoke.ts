import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { createFixtureGreetdClient } from "./greetd-client";
import { createLoginController } from "./login-controller";
import { loadSessionSelection, type SessionCatalogOptions } from "./session-catalog";
import { createBrokerLaunch, launchSelectedSession } from "./session-launcher";
import { createFixtureLifecycle } from "./session-lifecycle";
import { fixtureProcessArgv } from "./testing/fixture-process";
import { startFakeGreetd, type FixtureReply } from "./testing/fake-greetd";
import type { LoginController, LoginState, SessionLifecycleAuthority } from "./types";

function ready(controller: LoginController) {
  const state = controller.state;
  if (state.kind !== "ready") throw new Error(`Expected ready, observed ${state.kind}`);
  return state;
}
function prompt(controller: LoginController) {
  const state = controller.state;
  if (state.kind !== "prompt") throw new Error(`Expected prompt, observed ${state.kind}`);
  return state;
}
function running(controller: LoginController) {
  const state = controller.state;
  if (state.kind !== "running") throw new Error(`Expected running, observed ${state.kind}`);
  return state;
}
function descriptor(argv: readonly string[]) {
  // These fixture paths/arguments contain no Desktop Entry escape or field code.
  assert(argv.every((arg) => /^[A-Za-z0-9_./:=+{}-]+$/.test(arg)));
  return `[Desktop Entry]\nType=Application\nName=Moire fixture\nDesktopNames=MoireFixture;\nExec=${argv.join(" ")}\n`;
}
const conversation: readonly FixtureReply[] = [
  { type: "auth_message", auth_message_type: "visible", auth_message: "Fixture visible prompt" },
  { type: "auth_message", auth_message_type: "secret", auth_message: "Fixture secret prompt" },
  { type: "auth_message", auth_message_type: "info", auth_message: "Fixture information" },
  { type: "auth_message", auth_message_type: "error", auth_message: "Fixture error message" },
  { type: "success" },
];

const directory = await mkdtemp("/tmp/m55-");
const trace: string[] = [];
const snapshots: LoginState[] = [];
const children: ChildProcess[] = [];
let controller: LoginController | undefined;
let lifecycle: SessionLifecycleAuthority | undefined;
let broker: Awaited<ReturnType<typeof startFakeGreetd>> | undefined;
let consoleIntent = false;
let changedCatalogBlocked = false;
let completedFlows = 0;
let greeterCreations = 0;
try {
  const executable = await realpath(process.execPath);
  const descriptorPath = join(directory, "moire.desktop");
  const argv = fixtureProcessArgv();
  const originalDescriptor = descriptor(argv);
  await writeFile(descriptorPath, originalDescriptor, { mode: 0o600 });
  const launcherPath = join(directory, "fixture-launcher");
  await writeFile(launcherPath, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
  const catalog: SessionCatalogOptions = {
    qualification: "fixture",
    descriptorPath,
    trustedRoots: [directory],
    executableRoots: [dirname(executable)],
    searchPath: [dirname(executable)],
  };
  const fixedLauncher = {
    qualification: "fixture" as const,
    path: launcherPath,
    trustedRoots: [directory],
  };
  const selection = await loadSessionSelection(catalog);
  const expectedBrokerLaunch = createBrokerLaunch(selection, fixedLauncher);
  const owned = createFixtureLifecycle({
    qualification: "fixture",
    launchSession: async ({ selection: selected }, context) => {
      trace.push("spawn-request");
      return launchSelectedSession({
        qualification: "fixture",
        catalog,
        id: selected.id,
        generation: selected.generation,
        ipc: true,
        signal: context.signal,
        environment: {
          PATH: dirname(executable),
          LANG: "C",
          GREETD_SOCK: "/fixture-never-inherit",
          WAYLAND_DISPLAY: "fixture-never-inherit",
          NOTIFY_SOCKET: "/fixture-never-inherit",
          NODE_OPTIONS: "fixture-never-inherit",
        },
        onSpawn: (child) => {
          context.onSpawn(child);
          children.push(child);
          child.once("close", () => trace.push("session-process-closed"));
        },
      });
    },
  });
  lifecycle = owned;
  const observed: SessionLifecycleAuthority = {
    qualification: "fixture",
    async createGreeter() {
      if (greeterCreations > 0 && children.length > 0)
        assert(children.every((child) => child.exitCode !== null || child.signalCode !== null));
      const identity = await owned.createGreeter();
      greeterCreations++;
      trace.push("greeter-created");
      return identity;
    },
    async retireGreeter(identity) {
      trace.push("greeter-retire-request");
      const result = await owned.retireGreeter(identity);
      trace.push(`greeter-${result.kind}`);
      return result;
    },
    async observeStarted(request) {
      assert.equal(trace.at(-1), "greeter-released");
      const identity = await owned.observeStarted(request);
      trace.push("session-observed");
      return identity;
    },
    async cancelLaunch(attemptId) {
      const result = await owned.cancelLaunch(attemptId);
      trace.push(`launch-cancel-${result.kind}`);
      return result;
    },
    async retireSession(identity) {
      trace.push("session-retire-request");
      const result = await owned.retireSession(identity);
      trace.push(`session-${result.kind}`);
      return result;
    },
    dispose: () => owned.dispose(),
  };
  broker = await startFakeGreetd({
    qualification: "fixture",
    directory,
    conversations: [conversation, conversation, conversation],
    async onStart(request) {
      assert.deepEqual(request.cmd, expectedBrokerLaunch.command);
      assert.deepEqual(request.env, []);
      assert.equal(children.length, completedFlows);
      trace.push("broker-scheduled");
    },
  });
  const privateBroker = broker;
  controller = createLoginController({
    qualification: "fixture",
    createBroker: () =>
      createFixtureGreetdClient({
        qualification: "fixture",
        connect: () => privateBroker.createConnection(),
      }),
    loadSelection: () => loadSessionSelection(catalog),
    brokerLaunch: (selected) => createBrokerLaunch(selected, fixedLauncher),
    lifecycle: observed,
    consoleRequested: () => consoleIntent,
    timeoutMs: 3000,
  });
  const active = controller;
  const unsubscribe = active.subscribe(() => snapshots.push(active.state));
  await active.initialize();
  const firstGreeter = ready(active).greeter;
  for (let flow = 0; flow < 2; flow++) {
    const greeter = ready(active).greeter;
    const beforeAuth = privateBroker.counters.authenticationBegins;
    await active.beginLogin({
      greeter,
      account: "fixture-account",
      sessionId: selection.id,
      catalogGeneration: selection.generation,
    });
    assert.equal(privateBroker.counters.authenticationBegins, beforeAuth + 1);
    const firstPrompt = prompt(active);
    for (const style of ["visible", "secret", "info", "error"]) {
      const current = prompt(active);
      assert.equal(current.prompt.style, style);
      assert.equal(privateBroker.counters.schedules, flow);
      const response = style === "visible" || style === "secret" ? "SYNTHETIC-C55-RESPONSE" : null;
      await active.answerPrompt({
        attemptId: current.attemptId,
        promptId: current.prompt.id,
        response,
      });
    }
    const session = running(active).session;
    assert.equal(children.length, flow + 1);
    assert.equal(privateBroker.counters.schedules, flow + 1);
    assert.equal(children[flow].exitCode, null);
    assert.equal(children[flow].signalCode, null);
    // A consumed prompt cannot authorize a second launch.
    await assert.rejects(
      active.answerPrompt({
        attemptId: firstPrompt.attemptId,
        promptId: firstPrompt.prompt.id,
        response: "SYNTHETIC-C55-RESPONSE",
      }),
      /prompt changed/,
    );
    assert.equal(privateBroker.counters.schedules, flow + 1);
    completedFlows++;
    await active.logout(session);
    const fresh = ready(active);
    assert.notDeepEqual(fresh.greeter, greeter);
    assert(fresh.greeter.generation > greeter.generation);
    assert.equal(children[flow].exitCode, 0);
    assert.equal(privateBroker.counters.authenticationBegins, beforeAuth + 1);
    await assert.rejects(active.logout(session), /identity changed/);
    assert.deepEqual(ready(active).greeter, fresh.greeter);
  }
  assert.notDeepEqual(ready(active).greeter, firstGreeter);
  assert.equal(greeterCreations, 3);

  // Independent descriptor revalidation blocks selection changes during a prompt.
  const fresh = ready(active);
  await active.beginLogin({
    greeter: fresh.greeter,
    account: "fixture-account",
    sessionId: selection.id,
    catalogGeneration: selection.generation,
  });
  await writeFile(descriptorPath, originalDescriptor.replace("Moire fixture", "Changed fixture"));
  for (const style of ["visible", "secret", "info", "error"]) {
    if (active.state.kind !== "prompt") break;
    const current = prompt(active);
    await active.answerPrompt({
      attemptId: current.attemptId,
      promptId: current.prompt.id,
      response: style === "visible" || style === "secret" ? "SYNTHETIC-C55-RESPONSE" : null,
    });
  }
  assert.notEqual(active.state.kind, "running");
  assert.equal(privateBroker.counters.schedules, 2);
  assert.equal(children.length, 2);
  changedCatalogBlocked = true;
  await writeFile(descriptorPath, originalDescriptor);
  assert.equal(JSON.stringify(snapshots).includes("SYNTHETIC-C55-RESPONSE"), false);
  assert.equal(JSON.stringify(privateBroker.counters).includes("SYNTHETIC-C55-RESPONSE"), false);
  unsubscribe();
  consoleIntent = true;
  await active.dispose();
  controller = undefined;
  await owned.dispose();
  const ownership = owned.diagnostics();
  assert(
    ownership.every(
      (record) => record.parentClosed && record.descendantCount === 1 && record.released,
    ),
  );
  lifecycle = undefined;
  await privateBroker.close();
  broker = undefined;
  console.log(
    JSON.stringify({
      fixture: "login-lifecycle",
      actualExitCode: 0,
      fullLoginLogoutFlows: completedFlows,
      freshAuthenticationRequired: true,
      greeterCreations,
      schedules: privateBroker.counters.schedules,
      descriptorChangeBlocked: changedCatalogBlocked,
      observedSessionProcessesClosed: children.filter((child) => child.exitCode === 0).length,
      ownedParentsRetired: ownership.length,
      ownedDescendantsRetired: ownership.reduce(
        (total, record) => total + record.descendantCount,
        0,
      ),
      order: trace,
      syntheticResponsesRecorded: false,
      realAuthentication: false,
      authoritativeNativeSeat: false,
      secureLock: false,
      newImageBuilt: false,
      vmLifecycleActions: false,
    }),
  );
} finally {
  await controller?.dispose();
  await lifecycle?.dispose();
  await broker?.close();
  await rm(directory, { recursive: true, force: true });
}
