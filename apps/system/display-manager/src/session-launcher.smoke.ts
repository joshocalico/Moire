/** Real harmless argv/environment oracle and shell-evaluated fixed-launcher boundary. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  loadSessionSelection,
  type SessionCatalogOptions,
  type FixedSessionLauncher,
} from "./session-catalog";
import {
  createBrokerLaunch,
  launchSelectedSession,
  selectedSessionEnvironment,
} from "./session-launcher";
import { loginId } from "./types";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "moire-c55-launcher-"));
fs.chmodSync(root, 0o700);
const descriptorPath = path.join(root, "chosen ; session.desktop"),
  marker = path.join(root, "must-not-exist");
const oracle = path.join(root, "argv-oracle.cjs");
fs.writeFileSync(
  oracle,
  "process.stdout.write(JSON.stringify({argv:process.argv.slice(2),environment:process.env}));\n",
  { mode: 0o600 },
);
const quote = (value: string) =>
  `"${value.replaceAll("%", "%%").replace(/[\\"`$]/g, (character) => `\\${character}`)}"`.replaceAll(
    "\\",
    "\\\\",
  );
const name = `Fixture 'name' ; $(${process.execPath}) %k`,
  literal = `hello ; touch ${marker} | & > < ' " $HOME \\ tail`;
const contents = `[Desktop Entry]\nType=Application\nName=${name}\nExec=${quote(process.execPath)} ${quote(oracle)} ${quote(literal)} %c %k %i ${quote("100%")} ""\nIcon=fixture-icon\nDesktopNames=Moire\n`;
fs.writeFileSync(descriptorPath, contents, { mode: 0o600 });
const catalog: SessionCatalogOptions = {
  qualification: "fixture",
  descriptorPath,
  trustedRoots: [root],
  executableRoots: [path.dirname(process.execPath)],
  searchPath: [],
  uid: process.getuid?.(),
};
let cases = 0;
const runtimeAddedEnvironmentKeys = new Set<string>();
function assertEnvironment(actual: unknown, expected: Record<string, string>) {
  assert.ok(actual && typeof actual === "object" && !Array.isArray(actual));
  const entries = Object.entries(actual);
  const supplied: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (process.platform === "darwin" && key === "__CF_USER_TEXT_ENCODING") {
      assert.equal(typeof value, "string");
      assert.match(String(value), /^0x[0-9a-f]+:(?:0x)?[0-9a-f]+:(?:0x)?[0-9a-f]+$/i);
      runtimeAddedEnvironmentKeys.add(key);
    } else supplied[key] = value;
  }
  assert.deepEqual(supplied, expected);
}
const collect = async (child: ChildProcess) => {
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  child.stdout?.on("data", (value: Buffer) => stdout.push(value));
  child.stderr?.on("data", (value: Buffer) => stderr.push(value));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, Buffer.concat(stderr).toString());
  return Buffer.concat(stdout).toString();
};
try {
  const selection = await loadSessionSelection(catalog);
  let observed: ChildProcess | null = null;
  const environment = {
    HOME: root,
    USER: "fixture-user",
    LOGNAME: "fixture-user",
    LANG: "C",
    PATH: path.dirname(process.execPath),
    GREETD_SOCK: "/must-not-inherit",
    DISPLAY: "forbidden",
    WAYLAND_DISPLAY: "forbidden",
    NOTIFY_SOCKET: "forbidden",
    DBUS_SESSION_BUS_ADDRESS: "forbidden",
    XDG_RUNTIME_DIR: "forbidden",
    LD_PRELOAD: "forbidden",
    DYLD_INSERT_LIBRARIES: "forbidden",
    NODE_OPTIONS: "--invalid-fixture-option",
    NODE_PATH: "forbidden",
    PRIVATE_SECRET: "not-a-real-secret",
    __CF_USER_TEXT_ENCODING: "forged-value-must-not-cross",
  };
  const child = await launchSelectedSession({
    qualification: "fixture",
    catalog,
    id: selection.id,
    generation: selection.generation,
    environment,
    onSpawn: (value) => {
      observed = value;
    },
  });
  assert.equal(observed, child);
  assert.ok(child.pid);
  const result: unknown = JSON.parse(await collect(child));
  assert.ok(result && typeof result === "object" && "argv" in result && "environment" in result);
  assert.deepEqual(result.argv, [
    literal,
    name,
    fs.realpathSync(descriptorPath),
    "--icon",
    "fixture-icon",
    "100%",
    "",
  ]);
  const allowedEnvironment = selectedSessionEnvironment(environment);
  assertEnvironment(result.environment, allowedEnvironment);
  assert.equal(fs.existsSync(marker), false);
  cases++;
  assert.deepEqual(selectedSessionEnvironment(), {});
  cases++;
  const noEnv = await launchSelectedSession({
    qualification: "fixture",
    catalog,
    id: selection.id,
    generation: selection.generation,
  });
  const emptyResult: unknown = JSON.parse(await collect(noEnv));
  assert.ok(emptyResult && typeof emptyResult === "object" && "environment" in emptyResult);
  assertEnvironment(emptyResult.environment, {});
  cases++;
  assert.throws(() => selectedSessionEnvironment({ HOME: "bad\0data" }));
  cases++;
  // The actual broker's shell join must see only the configured launcher and ID.
  const launcher = path.join(root, "fixed ' launcher ; safe");
  fs.writeFileSync(launcher, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o700 });
  const fixed: FixedSessionLauncher = {
    qualification: "fixture",
    path: launcher,
    trustedRoots: [root],
    uid: process.getuid?.(),
  };
  const request = createBrokerLaunch(selection, fixed);
  assert.equal(request.environment.length, 0);
  assert.equal(request.command.length, 2);
  assert.ok(!request.command.join(" ").includes(name));
  const shell = spawn("/bin/sh", ["-c", request.command.join(" ")], {
    shell: false,
    env: {},
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal((await collect(shell)).trim(), selection.id);
  assert.equal(fs.existsSync(marker), false);
  cases++;
  assert.throws(() => createBrokerLaunch({ ...selection, id: loginId("other-id") }, fixed));
  cases++;
  assert.throws(() => createBrokerLaunch({ ...selection, generation: "forged" }, fixed));
  cases++;
  fs.chmodSync(launcher, 0o777);
  assert.throws(() => createBrokerLaunch(selection, fixed));
  cases++;
  fs.chmodSync(launcher, 0o700);
  await assert.rejects(
    launchSelectedSession({
      qualification: "fixture",
      catalog,
      id: loginId("other"),
      generation: selection.generation,
    }),
  );
  cases++;
  await assert.rejects(
    launchSelectedSession({
      qualification: "fixture",
      catalog,
      id: selection.id,
      generation: "stale",
    }),
  );
  cases++;
  fs.writeFileSync(descriptorPath, contents.replace(name, "Changed fixture"), { mode: 0o600 });
  await assert.rejects(
    launchSelectedSession({
      qualification: "fixture",
      catalog,
      id: selection.id,
      generation: selection.generation,
    }),
  );
  cases++;
  fs.writeFileSync(descriptorPath, contents, { mode: 0o600 });
  const refreshed = await loadSessionSelection(catalog);
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(
    launchSelectedSession({
      qualification: "fixture",
      catalog,
      id: refreshed.id,
      generation: refreshed.generation,
      signal: signal.signal,
    }),
  );
  cases++;
  // IPC is explicitly injected by a fixture lifecycle; not descriptor-controlled.
  const ipcOracle = path.join(root, "ipc-oracle.cjs");
  fs.writeFileSync(
    ipcOracle,
    'process.on("message", m => { process.send({kind:"fixture-reply",nonce:m.nonce}); process.disconnect(); });\n',
    { mode: 0o600 },
  );
  fs.writeFileSync(
    descriptorPath,
    `[Desktop Entry]\nType=Application\nName=IPC fixture\nExec=${quote(process.execPath)} ${quote(ipcOracle)}\n`,
    { mode: 0o600 },
  );
  const ipcSelection = await loadSessionSelection(catalog);
  let reply: Promise<unknown> | null = null;
  const ipcChild = await launchSelectedSession({
    qualification: "fixture",
    catalog,
    id: ipcSelection.id,
    generation: ipcSelection.generation,
    ipc: true,
    onSpawn: (value) => {
      reply = new Promise((resolve) => value.once("message", resolve));
    },
  });
  const closed = collect(ipcChild);
  ipcChild.send({ nonce: "fixture-nonce" });
  assert.deepEqual(await reply, { kind: "fixture-reply", nonce: "fixture-nonce" });
  await closed;
  cases++;
  process.stdout.write(
    `${JSON.stringify({ fixture: "session-launcher", actualExitCode: 0, actualCode: 0, cases, qualification: "fixture", runtimeAddedEnvironmentKeys: [...runtimeAddedEnvironmentKeys], scope: "Harmless real direct-argv process, supplied allowlisted or empty environment (Darwin runtime-added CF key separately observed), opaque-ID shell broker boundary and IPC only; no production/native authentication." })}\n`,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
