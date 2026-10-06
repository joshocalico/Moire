/** Real harmless CLI processes test command ownership only; no native OS authentication proof. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const supervisor = fileURLToPath(new URL("../moire-authenticated-session", import.meta.url));
const manager = fileURLToPath(new URL("./authenticated-service.fixture.mjs", import.meta.url));
const probe = fileURLToPath(new URL("../moire-session-probe", import.meta.url));
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "moire unit fixture "));
const receipts = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function events(directory) {
  try {
    return (await fs.readFile(path.join(directory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function waitForFixtureExit(directory) {
  const until = Date.now() + 11_000;
  while (true) {
    const pids = new Set(
      (await events(directory)).flatMap((entry) => [entry.pid, entry.workloadPid]).filter(Boolean),
    );
    const alive = [...pids].some((pid) => {
      try {
        process.kill(pid, 0); // Observe only; never signal a recorded PID after possible reuse.
        return true;
      } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
      }
    });
    if (!alive) return;
    assert(Date.now() < until, "Owned fixture processes did not exit");
    await sleep(20);
  }
}
async function run(name, scenario, signal = null, malformed = false) {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { mode: 0o700 });
  const systemdRun = path.join(directory, "systemd-run fixture"),
    systemctl = path.join(directory, "systemctl fixture");
  for (const [file, role] of [
    [systemdRun, "run"],
    [systemctl, "stop"],
  ])
    await fs.writeFile(
      file,
      `#!/bin/sh\nexport MOIRE_SERVICE_FIXTURE_ROLE=${role}\nexec ${quote(process.execPath)} ${quote(manager)} "$@"\n`,
      { mode: 0o700 },
    );
  const configuration = path.join(directory, "configuration.json");
  await fs.writeFile(
    configuration,
    JSON.stringify({
      qualification: "command-fixture",
      systemdRun,
      systemctl,
      runTimeoutMs: 2500,
      stopTimeoutMs: 750,
      killGraceMs: 100,
    }),
    { mode: malformed ? 0o644 : 0o600 },
  );
  const child = spawn(supervisor, [], {
    env: {
      ...process.env,
      MOIRE_SESSION_FIXTURE_CONFIG: configuration,
      MOIRE_SERVICE_FIXTURE_ROOT: directory,
      MOIRE_SERVICE_FIXTURE_SCENARIO: scenario,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    errors = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const finished = new Promise((resolve) =>
    child.once("close", (code, killed) => resolve({ code, killed })),
  );
  let deadline;
  try {
    if (signal) {
      const until = Date.now() + 2000;
      while (
        !(await events(directory)).some(
          (entry) => entry.event === (scenario === "late-registration" ? "run" : "registered"),
        )
      ) {
        assert(Date.now() < until);
        await sleep(5);
      }
      child.kill(signal);
      // Repeated interruption must not start a second unit or dispatch concurrent stops.
      await sleep(10);
      child.kill(signal);
    }
    const result = await Promise.race([
      finished,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`Fixture deadline ${name}`)), 8000);
      }),
    ]);
    clearTimeout(deadline);
    assert.equal(result.killed, null);
    assert.equal(output, "");
    const records = await events(directory);
    const runs = records.filter((entry) => entry.event === "run"),
      stops = records.filter((entry) => entry.event === "stop");
    if (malformed) {
      assert.equal(result.code, 126);
      assert.equal(records.length, 0);
    } else {
      assert.equal(runs.length, 1);
      const unit = runs[0].unit;
      assert.match(unit, /^moire-session-[0-9a-f-]{36}\.service$/);
      assert.deepEqual(runs[0].args, [
        "--user",
        "--wait",
        "--quiet",
        "--service-type=exec",
        `--unit=${unit}`,
        "--property=ExitType=main",
        "--property=Restart=no",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=5s",
        "--property=SendSIGKILL=yes",
        "--property=RuntimeMaxSec=30s",
        "--expand-environment=no",
        "--",
        probe,
      ]);
      for (const stop of stops) assert.deepEqual(stop.args, ["--user", "stop", "--", unit]);
      assert(records.some((entry) => entry.event === "fixed-probe-executed"));
      const messages = errors.trim().split("\n").map(JSON.parse);
      assert.equal(messages[0].pamSessionIdentityVerified, false);
      assert.equal(messages[0].qualification, "command-fixture");
      assert(messages.every((entry) => entry.unit === unit));
      if (scenario === "normal") {
        assert.equal(result.code, 0);
        assert.equal(stops.length, 0);
      } else if (scenario === "command-fails")
        assert.equal(result.code, 23, errors + JSON.stringify(records));
      else if (scenario === "exec-fails")
        assert.equal(result.code, 203, errors + JSON.stringify(records));
      else if (
        scenario === "stop-reject" ||
        scenario === "stop-hangs" ||
        scenario === "run-ignores-term" ||
        scenario === "late-registration"
      ) {
        assert.equal(result.code, 125);
        assert.equal(stops.length, 2);
      } else
        assert.equal(
          result.code,
          signal ? { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 }[signal] : 124,
        );
      if (scenario !== "normal") assert(stops.length >= 1);
      if (scenario !== "run-ignores-term")
        assert(records.some((entry) => entry.event === "deactivated" && entry.workloadClosed));
      for (const entry of messages.filter((item) => item.event.endsWith("result")))
        assert.equal(entry.closeObserved, true);
    }
    receipts.push({
      case: name,
      actualExitCode: result.code,
      exactOwnedUnit: !malformed,
      fixtureOnly: true,
    });
  } finally {
    clearTimeout(deadline);
    child.kill("SIGTERM");
    let cleanupTimer;
    await Promise.race([
      finished,
      new Promise((resolve) => {
        cleanupTimer = setTimeout(resolve, 6000);
      }),
    ]);
    clearTimeout(cleanupTimer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await finished;
    await waitForFixtureExit(directory);
  }
}
try {
  await run("normal", "normal");
  await run("command failure", "command-fails");
  await run("exec failure", "exec-fails");
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) await run(signal, "held", signal);
  await run("run timeout", "held");
  await run("stop rejection", "stop-reject", "SIGTERM");
  await run("stop timeout", "stop-hangs", "SIGTERM");
  await run("CLI escalation", "run-ignores-term", "SIGTERM");
  await run("late registration", "late-registration", "SIGTERM");
  await run("invalid fixture permission", "normal", null, true);
  console.log(
    JSON.stringify({
      actualExitCode: 0,
      cases: receipts.length,
      qualification: "command fixtures on " + process.platform,
      nativeUserServicesValidated: false,
      nativePamIdentityValidated: false,
      receipts,
    }),
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
