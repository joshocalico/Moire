import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { FileActivationService, type DesktopEntry } from "@moire/app-discovery";
import { FileLauncher, launchFailureNotice, type FileLaunchFailure } from "./activation";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-activation-"));
const environment = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_CONFIG_DIRS: process.env.XDG_CONFIG_DIRS,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_DATA_DIRS: process.env.XDG_DATA_DIRS,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
process.env.XDG_CONFIG_DIRS = path.join(fixture, "config-system");
process.env.XDG_DATA_HOME = path.join(fixture, "data");
process.env.XDG_DATA_DIRS = path.join(fixture, "data-system");
process.env.XDG_CACHE_HOME = path.join(fixture, "cache");
process.env.XDG_RUNTIME_DIR = path.join(fixture, "runtime");
process.env.WAYLAND_DISPLAY = "wayland-files-fixture";
process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${fixture}/bus`;

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const launcher = new FileLauncher();
const failures: FileLaunchFailure[] = [];
let stopObserving = launcher.observeFailures((failure) => failures.push(failure));
let fixtureAppPid: number | null = null;
const children: ChildProcess[] = [];

function waitForClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Fixture process did not close.")), 10000);
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function waitForResult(file: string): Promise<unknown> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.fail(`Fixture did not publish ${file}`);
}

try {
  const input = path.join(fixture, "Workflow's notes 日本語.txt");
  await fs.writeFile(input, "Actual opened bytes");
  const script = path.join(fixture, "application.mjs");
  await fs.writeFile(
    script,
    `import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const [mode, ...args] = process.argv.slice(2);
fs.writeFileSync(path.join(directory, mode + ".json"), JSON.stringify({
  pid: process.pid,
  ...(mode === "path" ? {PATH: process.env.PATH, executable: process.execPath, sessionRuntime: process.env.MOIRE_FIXTURE_RUNTIME} : {}),
  args,
  contents: fs.readFileSync(fileURLToPath(args[0]), "utf8"),
  HOME: process.env.HOME,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
}));
if (mode === "wait") {
  process.on("SIGTERM", () => process.exit(23));
  setInterval(() => {}, 1000);
} else process.exit(mode === "fail" ? 23 : 0);
`,
  );
  const application = (id: string, name: string, execTemplate: string): DesktopEntry => ({
    id: `${id}.desktop`,
    name,
    exec: execTemplate,
    execTemplate,
    terminal: false,
    categories: [],
    mimeTypes: ["text/plain"],
  });
  const sessionBin = path.join(fixture, "session runtime tools");
  await fs.mkdir(sessionBin);
  await fs.writeFile(
    path.join(sessionBin, "node"),
    `#!/bin/sh
MOIRE_FIXTURE_RUNTIME=private-session-node exec ${shellQuote(process.execPath)} "$@"
`,
    { mode: 0o700 },
  );
  await fs.writeFile(
    path.join(sessionBin, "moire-image-viewer"),
    `#!/bin/sh
exec node ${shellQuote(script)} path "$@"
`,
    { mode: 0o700 },
  );
  const template = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  const apps = [
    application("success", "Fixture Editor", `${template} success %U`),
    application(
      "missing",
      "Missing Editor",
      `${shellQuote(path.join(fixture, "not-installed"))} %U`,
    ),
    application("fail", "Failed Editor", `${template} fail %U`),
    application("wait", "Running Editor", `${template} wait %U`),
    application("session-viewer", "Session Viewer Fixture", "moire-image-viewer %U"),
  ];
  const activation = new FileActivationService((request) => {
    const child = launcher.launchDesktop(request);
    assert.ok(child);
    children.push(child);
  }, apps);
  const activate = (id: string) => {
    const result = activation.openWith(input, id);
    assert.ok(result, "application resolution alone is not a successful launch");
    const child = children.at(-1);
    assert.ok(child);
    return child;
  };

  process.env.PATH = sessionBin;
  const sessionChild = activate("session-viewer");
  assert.equal(
    await waitForClose(sessionChild),
    0,
    "registered launcher and its node runtime resolve only from inherited session PATH",
  );
  const sessionResult: unknown = JSON.parse(
    await fs.readFile(path.join(fixture, "path.json"), "utf8"),
  );
  assert.ok(typeof sessionResult === "object" && sessionResult !== null && "pid" in sessionResult);
  assert.deepEqual(
    sessionResult,
    {
      pid: sessionResult.pid,
      PATH: sessionBin,
      executable: process.execPath,
      sessionRuntime: "private-session-node",
      args: [pathToFileURL(input).href],
      contents: "Actual opened bytes",
      HOME: fixture,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
      WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    },
    "session environment and safely quoted URI survive both shell and application wrapper",
  );
  assert.equal(failures.length, 0, "session wrapper success emits no failure");
  if (environment.PATH === undefined) delete process.env.PATH;
  else process.env.PATH = environment.PATH;
  activation.setDefaultApplication("text/plain", "success.desktop");
  assert.ok(activation.openDefault(input));
  const defaultChild = children.at(-1);
  assert.ok(defaultChild);
  assert.equal(await waitForClose(defaultChild), 0);
  const result: unknown = JSON.parse(await fs.readFile(path.join(fixture, "success.json"), "utf8"));
  assert.ok(typeof result === "object" && result !== null && "pid" in result);
  assert.deepEqual(result, {
    pid: result.pid,
    args: [pathToFileURL(input).href],
    contents: "Actual opened bytes",
    HOME: fixture,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
  });
  assert.equal(failures.length, 0, "successful app exit does not produce a failure notice");

  assert.equal(await waitForClose(activate("missing")), 127);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, "exit", "shell success does not hide command lookup failure");
  const missing = failures[0];
  assert.ok(missing?.kind === "exit");
  assert.equal(missing.code, 127);
  assert.match(
    launchFailureNotice(missing),
    /Missing Editor.*Workflow's notes 日本語\.txt.*Try Open With/,
  );

  assert.equal(await waitForClose(activate("fail")), 23);
  assert.equal(failures.length, 2, "an application wrapper failure is observed too");
  assert.equal(failures[1]?.kind, "exit");

  const emptyPath = path.join(fixture, "empty-path");
  await fs.mkdir(emptyPath);
  process.env.PATH = emptyPath;
  const unavailableFallback = launcher.launchFallback(input);
  assert.ok(unavailableFallback);
  assert.notEqual(await waitForClose(unavailableFallback), 0);
  assert.equal(failures.length, 3, "spawn error and subsequent close produce one failure");
  assert.equal(failures[2]?.kind, "spawn");
  const spawnFailure = failures[2];
  assert.ok(spawnFailure?.kind === "spawn");
  assert.ok("code" in spawnFailure.error && spawnFailure.error.code === "ENOENT");
  assert.match(launchFailureNotice(spawnFailure), /default application.*Try Open With/);

  assert.equal(launcher.launchFallback("invalid\0path"), null);
  assert.equal(failures.length, 4, "synchronous spawn validation errors are reported once");
  assert.equal(failures[3]?.kind, "spawn");

  const bin = path.join(fixture, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, "xdg-open"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(__dirname, "fallback.json"), JSON.stringify(process.argv.slice(2)));
`,
    { mode: 0o700 },
  );
  process.env.PATH = bin;
  const fallback = launcher.launchFallback(input);
  assert.ok(fallback);
  assert.equal(await waitForClose(fallback), 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(bin, "fallback.json"), "utf8")), [input]);
  assert.equal(failures.length, 4, "xdg-open receives the local path without shell expansion");

  await fs.writeFile(
    path.join(bin, "xdg-open"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(__dirname, "signal.json"), JSON.stringify({pid: process.pid}));
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );
  const signalled = launcher.launchFallback(input);
  assert.ok(signalled?.pid);
  fixtureAppPid = signalled.pid;
  const signalClosed = waitForClose(signalled);
  const signalReady = await waitForResult(path.join(bin, "signal.json"));
  assert.deepEqual(signalReady, { pid: fixtureAppPid });
  process.kill(fixtureAppPid, "SIGTERM");
  assert.equal(await signalClosed, null, "a real signal termination has no exit code");
  fixtureAppPid = null;
  assert.equal(failures.length, 5, "signal termination produces one failure notice");
  const signalFailure = failures[4];
  assert.ok(signalFailure?.kind === "signal");
  assert.equal(signalFailure.signal, "SIGTERM");
  assert.match(launchFailureNotice(signalFailure), /terminated.*Workflow's notes 日本語\.txt/);

  if (environment.PATH === undefined) delete process.env.PATH;
  else process.env.PATH = environment.PATH;
  const running = activate("wait");
  const closed = waitForClose(running);
  const ready = await waitForResult(path.join(fixture, "wait.json"));
  assert.ok(typeof ready === "object" && ready !== null && "pid" in ready);
  assert.ok(typeof ready.pid === "number" && Number.isSafeInteger(ready.pid));
  fixtureAppPid = ready.pid;
  stopObserving();
  assert.equal(
    process.kill(fixtureAppPid, 0),
    true,
    "Files cleanup must not kill the launched app",
  );
  process.kill(fixtureAppPid, "SIGTERM");
  assert.equal(await closed, 23);
  fixtureAppPid = null;
  assert.equal(failures.length, 5, "late failures do not update an unmounted Files workspace");

  stopObserving = launcher.observeFailures((failure) => failures.push(failure));
  assert.equal(await waitForClose(activate("missing")), 127);
  assert.equal(failures.length, 6, "observation can resume after effect cleanup");
  console.log(
    "[files/activation] real child success/argv/session env, unavailable command, nonzero exit, signal termination, spawn error deduplication, direct fallback and non-killing cleanup passed",
  );
} finally {
  stopObserving();
  if (fixtureAppPid !== null) {
    try {
      process.kill(fixtureAppPid, "SIGKILL");
    } catch {
      // The disposable fixture may have already exited.
    }
  }
  for (const child of children) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Only process groups created for these disposable fixture launches.
      }
    }
  }
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}
