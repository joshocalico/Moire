/** Fixed, unprivileged workload ownership. Neither this entry nor a user unit authenticates. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const probe = fileURLToPath(new URL("../moire-session-probe", import.meta.url));
const uid = process.getuid?.();
const unit = `moire-session-${randomUUID()}.service`;
const defaults = {
  systemdRun: "/run/current-system/systemd/bin/systemd-run",
  systemctl: "/run/current-system/systemd/bin/systemctl",
  runTimeoutMs: 45_000,
  stopTimeoutMs: 8_000,
  killGraceMs: 500,
};
function report(event, fields = {}) {
  // Never include caller environment, command output or raw exception text.
  process.stderr.write(
    JSON.stringify({ component: "moire-session-supervisor", event, unit, ...fields }) + "\n",
  );
}
async function fixtureConfiguration(filename) {
  if (!path.isAbsolute(filename)) throw new Error("Invalid fixture configuration");
  const directory = path.dirname(filename);
  const parent = await fs.lstat(directory),
    file = await fs.lstat(filename);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== uid ||
    (parent.mode & 0o777) !== 0o700 ||
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.uid !== uid ||
    (file.mode & 0o777) !== 0o600 ||
    file.size > 4096
  )
    throw new Error("Invalid fixture configuration");
  const value = JSON.parse(await fs.readFile(filename, "utf8"));
  const keys = ["qualification", ...Object.keys(defaults)];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== keys.sort().join() ||
    value.qualification !== "command-fixture"
  )
    throw new Error("Invalid fixture configuration");
  for (const key of ["systemdRun", "systemctl"]) {
    if (
      typeof value[key] !== "string" ||
      !path.isAbsolute(value[key]) ||
      path.dirname(value[key]) !== directory
    )
      throw new Error("Invalid fixture executable");
    const executable = await fs.lstat(value[key]);
    if (
      !executable.isFile() ||
      executable.isSymbolicLink() ||
      executable.uid !== uid ||
      (executable.mode & 0o777) !== 0o700
    )
      throw new Error("Invalid fixture executable");
  }
  for (const key of ["runTimeoutMs", "stopTimeoutMs", "killGraceMs"]) {
    if (!Number.isInteger(value[key]) || value[key] < 50 || value[key] > defaults[key])
      throw new Error("Invalid fixture timeout");
  }
  return value;
}
function command(executable, args) {
  const child = spawn(executable, args, { stdio: "ignore" });
  let settled = false,
    closeObserved = false;
  const closed = new Promise((resolve) => {
    child.once("error", () => {
      settled = true;
      resolve({ code: 127, signal: null });
    });
    child.once("close", (code, signal) => {
      settled = true;
      closeObserved = true;
      resolve({ code: code ?? 1, signal });
    });
  });
  return {
    child,
    closed,
    get settled() {
      return settled;
    },
    get closeObserved() {
      return closeObserved || child.pid === undefined;
    },
  };
}
async function bounded(operation, timeoutMs, graceMs) {
  let timeout;
  const result = await Promise.race([
    operation.closed,
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
  clearTimeout(timeout);
  if (result !== null)
    return { ...result, timedOut: false, closeObserved: operation.closeObserved };
  operation.child.kill("SIGTERM");
  let escalation;
  await Promise.race([
    operation.closed,
    new Promise((resolve) => {
      escalation = setTimeout(resolve, graceMs);
    }),
  ]);
  clearTimeout(escalation);
  if (!operation.closeObserved) operation.child.kill("SIGKILL");
  let finalWait;
  await Promise.race([
    operation.closed,
    new Promise((resolve) => {
      finalWait = setTimeout(resolve, graceMs);
    }),
  ]);
  clearTimeout(finalWait);
  if (!operation.closeObserved) operation.child.unref();
  // Only our CLI child is signalled; the service manager owns workload cleanup.
  return { code: 124, signal: null, timedOut: true, closeObserved: operation.closeObserved };
}
async function main() {
  if (process.argv.length !== 2 || uid === undefined || uid === 0)
    throw new Error("Unprivileged fixed session entry required");
  const fixture = process.env.MOIRE_SESSION_FIXTURE_CONFIG;
  const config = fixture ? await fixtureConfiguration(fixture) : defaults;
  if (!fixture && process.platform !== "linux")
    throw new Error("Linux user service manager required");
  report("entry", {
    qualification: fixture ? "command-fixture" : "os-integration-unvalidated",
    uid,
    pamSessionIdentityVerified: false,
  });
  let interrupted = null;
  let wake;
  const interruption = new Promise((resolve) => {
    wake = resolve;
  });
  const handlers = new Map();
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGHUP", 129],
    ["SIGTERM", 143],
  ]) {
    const handler = () => {
      if (interrupted === null) {
        interrupted = code;
        wake();
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  const running = command(config.systemdRun, [
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
  let runTimer;
  const outcome = await Promise.race([
    running.closed.then((result) => ({ kind: "closed", result })),
    interruption.then(() => ({ kind: "interrupted" })),
    new Promise((resolve) => {
      runTimer = setTimeout(() => resolve({ kind: "timeout" }), config.runTimeoutMs);
    }),
  ]);
  clearTimeout(runTimer);
  let code =
    outcome.kind === "closed"
      ? outcome.result.code
      : outcome.kind === "interrupted"
        ? interrupted
        : 124;
  try {
    if (outcome.kind !== "closed" || outcome.result.code !== 0 || outcome.result.signal) {
      report("stop-requested", { reason: outcome.kind });
      const stopping = command(config.systemctl, ["--user", "stop", "--", unit]);
      const stopped = await bounded(stopping, config.stopTimeoutMs, config.killGraceMs);
      report("stop-result", {
        code: stopped.code,
        timedOut: stopped.timedOut,
        closeObserved: stopped.closeObserved,
      });
      const waited = await bounded(running, config.stopTimeoutMs, config.killGraceMs);
      report("wait-result", {
        code: waited.code,
        timedOut: waited.timedOut,
        closeObserved: waited.closeObserved,
      });
      if (
        stopped.code !== 0 ||
        waited.timedOut ||
        !stopped.closeObserved ||
        !waited.closeObserved
      ) {
        // A start request may register after an early stop. Retry only our exact name;
        // bounded CLI cleanup still cannot establish native release in an uncertain case.
        const retry = await bounded(
          command(config.systemctl, ["--user", "stop", "--", unit]),
          config.stopTimeoutMs,
          config.killGraceMs,
        );
        report("stop-retry-result", {
          code: retry.code,
          timedOut: retry.timedOut,
          closeObserved: retry.closeObserved,
        });
        code = 125;
      }
    }
    report("exit", { code });
    return code;
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}
try {
  process.exitCode = await main();
} catch {
  report("entry-failed");
  process.exitCode = 126;
}
