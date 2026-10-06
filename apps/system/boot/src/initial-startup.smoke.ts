import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initBootAttemptLedger,
  currentBootServiceIdentity,
  recordBootAttempt,
  beginBootService,
  writeBootServiceRecord,
  cleanupBootService,
  checkBootDesktopAdmission,
  parseBootAdmissionCheckpoint,
  observeBootManager,
  bootManagerProperties,
  type BootServicePaths,
} from "@moire/sys";
import { createInitialStartupCoordinator, runInitialStartupCommand } from "./initial-startup";

/** Same source/compiled module is a disposable argv subprocess fixture, never a native manager. */
async function fixtureCommand() {
  const directory = process.env.MOIRE_INITIAL_FIXTURE_DIRECTORY;
  if (!directory) throw new Error("Missing isolated fixture directory");
  const unit = process.env.MOIRE_BOOT_UNIT ?? "moire-fixture-boot.service";
  const group = `/system.slice/${unit}`;
  const paths: BootServicePaths = {
    cgroupMount: path.join(directory, "cgroup"),
    procRoot: path.join(directory, "proc"),
    selfPid: process.pid,
  };
  const root = path.join(paths.cgroupMount, group),
    state = path.join(directory, "service"),
    trace = path.join(directory, "commands.jsonl");
  const argv = process.argv.slice(2),
    scenario = process.env.MOIRE_INITIAL_CASE;
  fs.appendFileSync(trace, JSON.stringify(argv) + "\n");
  const node = (pids: readonly number[]) => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "cgroup.type"), "domain\n");
    fs.writeFileSync(path.join(root, "cgroup.procs"), pids.join("\n") + "\n");
    fs.writeFileSync(path.join(root, "cgroup.events"), `populated ${Number(pids.length > 0)}\n`);
  };
  const membership = (value: string) => {
    const proc = path.join(paths.procRoot, String(paths.selfPid));
    fs.mkdirSync(proc, { recursive: true });
    fs.writeFileSync(path.join(proc, "cgroup"), `0::${value}\n`);
  };
  const managerFile = path.join(directory, "manager.txt");
  const manager = (
    active: string,
    id: string,
    pid: number,
    control: number,
    controlGroup: string,
    job: string,
  ) => {
    const values = new Map<string, string>([
      ["Id", unit],
      ["LoadState", "loaded"],
      ["ActiveState", active],
      ["InvocationID", id],
      ["MainPID", String(pid)],
      ["ControlPID", String(control)],
      ["ControlGroup", controlGroup],
      ["Job", job],
    ]);
    fs.writeFileSync(
      managerFile,
      bootManagerProperties.map((name) => `${name}=${values.get(name) ?? "0"}`).join("\n") + "\n",
    );
  };
  const identity = {
    ...currentBootServiceIdentity(process.env, paths),
    invocationId: "a".repeat(32),
  };
  if (argv.includes("show")) {
    process.stdout.write(fs.readFileSync(managerFile, "utf8"));
    return;
  }
  if (argv[0] === "--admission-check") {
    membership("/fixture-gate.service");
    const token = argv[2];
    if (!token) throw new Error("Missing expected token");
    const result = await checkBootDesktopAdmission({
      stateDirectory: state,
      current: identity,
      paths,
      checkpoint: parseBootAdmissionCheckpoint(token),
      observeManager: () => observeBootManager(unit, process.env.MOIRE_SYSTEMCTL),
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = result.kind === "unresolved" ? 1 : 0;
    return;
  }
  if (argv.includes("start") && argv.at(-1) === unit) {
    if (scenario === "missing-ledger") {
      fs.unlinkSync(path.join(state, "attempt.json"));
      process.exitCode = 1;
      return;
    }
    if (scenario === "bad-ledger") {
      fs.writeFileSync(path.join(state, "attempt.json"), "{}");
      process.exitCode = 1;
      return;
    }
    if (scenario === "start-timeout") {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return;
    }
    node([process.pid]);
    membership(group);
    manager("activating", identity.invocationId, 0, process.pid, group, "123");
    await recordBootAttempt({
      stateDirectory: state,
      expected: identity,
      paths,
      observeManager: () => observeBootManager(unit, process.env.MOIRE_SYSTEMCTL),
    });
    if (scenario === "pre-lease-failure") {
      process.exitCode = 1;
      return;
    }
    const base = beginBootService(state, identity, paths);
    if (scenario === "console-skip-no-latch")
      writeBootServiceRecord(state, "lease", {
        ...base,
        phase: "skipped",
        reason: "console-requested",
      });
    manager("active", identity.invocationId, process.pid, 0, group, "");
    if (scenario === "failed-start-released") process.exitCode = 1;
    return;
  }
  if (argv.includes("stop")) {
    if (scenario === "stop-timeout") {
      manager("deactivating", identity.invocationId, 0, 0, group, "456");
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return;
    }
    node(scenario === "remaining-owner" ? [process.pid, 777] : [process.pid]);
    membership(group);
    const result = cleanupBootService({ stateDirectory: state, expected: identity, paths });
    node(scenario === "remaining-owner" ? [777] : []);
    manager("inactive", "", 0, 0, "", "");
    if (scenario === "changed-attempt")
      writeBootServiceRecord(state, "attempt", {
        version: 1,
        bootId: identity.bootId,
        unit,
        state: "attempted",
        invocationId: "b".repeat(32),
      });
    if (scenario === "escape")
      fs.writeFileSync(path.join(directory, "console-requested"), "escape\n", { mode: 0o600 });
    if (scenario === "unsafe-latch") {
      fs.writeFileSync(path.join(directory, "console-requested"), "escape\n", { mode: 0o600 });
      fs.chmodSync(path.join(directory, "console-requested"), 0o644);
    }
    process.exitCode = scenario === "failed-stop-released" ? 1 : result.kind === "skipped" ? 0 : 1;
    return;
  }
  if (argv.includes("start")) {
    if (scenario === "desktop-failure") process.exitCode = 3;
    return;
  }
  throw new Error("Unsupported fixture argv");
}
async function tests() {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "moire-initial-startup-")),
  );
  const source = fileURLToPath(import.meta.url),
    unit = "moire-fixture-boot.service",
    session = "moire-fixture-session.service";
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const reports: { scenario: string; kind: string }[] = [];
  try {
    for (const scenario of [
      "healthy-before-graphics",
      "failed-start-released",
      "failed-stop-released",
      "escape",
      "console-skip-no-latch",
      "pre-lease-failure",
      "missing-ledger",
      "bad-ledger",
      "changed-attempt",
      "remaining-owner",
      "unsafe-latch",
      "desktop-failure",
      "start-timeout",
      "stop-timeout",
    ]) {
      const fixture = path.join(directory, scenario);
      fs.mkdirSync(fixture, { mode: 0o700 });
      const paths: BootServicePaths = {
        cgroupMount: path.join(fixture, "cgroup"),
        procRoot: path.join(fixture, "proc"),
        selfPid: process.pid,
      };
      fs.mkdirSync(paths.cgroupMount);
      fs.mkdirSync(path.join(paths.procRoot, "sys/kernel/random"), { recursive: true });
      fs.writeFileSync(
        path.join(paths.procRoot, "sys/kernel/random/boot_id"),
        "12345678-1234-1234-1234-123456789abc\n",
      );
      const state = path.join(fixture, "service");
      initBootAttemptLedger(state, currentBootServiceIdentity({ MOIRE_BOOT_UNIT: unit }, paths));
      const executable = path.join(fixture, "command"),
        trace = path.join(fixture, "commands.jsonl");
      fs.writeFileSync(
        executable,
        `#!/bin/sh\nexec ${[process.execPath, ...process.execArgv, source].map(quote).join(" ")} "$@"\n`,
        { mode: 0o700 },
      );
      const owner = createInitialStartupCoordinator({
        systemctlPath: executable,
        cleanupPath: executable,
        stateDirectory: state,
        consoleLatchPath: path.join(fixture, "console-requested"),
        bootUnit: unit,
        sessionUnit: session,
        paths,
        environment: {
          MOIRE_INITIAL_FIXTURE: "1",
          MOIRE_INITIAL_FIXTURE_DIRECTORY: fixture,
          MOIRE_INITIAL_CASE: scenario,
        },
        timeouts: scenario.endsWith("timeout")
          ? {
              startMs: scenario === "start-timeout" ? 1000 : 20000,
              stopMs: scenario === "stop-timeout" ? 1000 : 10000,
              admissionMs: 5000,
            }
          : undefined,
      });
      const first = owner.run();
      assert.equal(owner.run(), first, "duplicate run shares the same transaction owner");
      const result = await first;
      assert.deepEqual(await owner.run(), result);
      const blocked = [
        "pre-lease-failure",
        "missing-ledger",
        "bad-ledger",
        "changed-attempt",
        "remaining-owner",
        "unsafe-latch",
        "desktop-failure",
        "start-timeout",
        "stop-timeout",
      ].includes(scenario);
      const expected =
        scenario === "escape" || scenario === "console-skip-no-latch"
          ? "console-retained"
          : blocked
            ? "blocked"
            : "desktop-started";
      assert.equal(result.kind, expected, `${scenario}: ${JSON.stringify(result)}`);
      const raw: unknown[] = fs
        .readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const commands = raw.map((value) => {
        if (!Array.isArray(value) || !value.every((arg): arg is string => typeof arg === "string"))
          throw new Error("Invalid fixture trace");
        return value;
      });
      const actual = commands.filter((args) => !args.includes("show"));
      assert.equal(
        actual.filter((args) => args.includes("start") && args.at(-1) === unit).length,
        1,
      );
      assert.equal(
        actual.filter((args) => args.includes("stop") && args.at(-1) === unit).length,
        1,
        "stop attempted even after malformed/missing ledger",
      );
      assert.equal(actual[0]?.at(-1), unit);
      assert.ok(actual[1]?.includes("stop"));
      const startsDesktop = actual.filter(
        (args) => args.includes("start") && args.at(-1) === session,
      );
      assert.equal(
        startsDesktop.length,
        expected === "desktop-started" || scenario === "desktop-failure" ? 1 : 0,
        "no desktop before proof or after console request",
      );
      if (result.kind !== "blocked") {
        if (scenario === "failed-start-released")
          assert.deepEqual(result.bootStart, { kind: "exited", exitCode: 1, diagnostic: "" });
        if (scenario === "failed-stop-released")
          assert.deepEqual(result.stop, { kind: "exited", exitCode: 1, diagnostic: "" });
        assert.equal(
          result.bootDisposition.kind,
          scenario === "start-timeout" ? "not-invoked" : "skipped",
          "fixture never claims renderer scanout",
        );
      }
      reports.push({ scenario, kind: result.kind });
    }
    assert.equal(await runInitialStartupCommand(["--fake-ready"]), 1);
    console.log(
      `initial startup: ${JSON.stringify(reports)} PASS; actual disposable subprocess argv/timeout/record/admission/owner paths, simulated manager+cgroup files, no readiness/device claim`,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
if (process.env.MOIRE_INITIAL_FIXTURE === "1") await fixtureCommand();
else await tests();
