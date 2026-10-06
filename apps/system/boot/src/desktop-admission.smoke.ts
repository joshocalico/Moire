import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginBootService,
  bootManagerProperties,
  cleanupBootService,
  initBootAttemptLedger,
  observeBootManager,
  readBootServiceLease,
  recordBootAttempt,
  writeBootServiceRecord,
  type BootManagerObservation,
  type BootServicePaths,
  type BootSkipReason,
} from "@moire/sys";
import { checkDesktopAdmission } from "./desktop-admission";

const identity = {
  bootId: "12345678-1234-1234-1234-123456789abc",
  unit: "moire-fixture-boot.service",
  invocationId: "a".repeat(32),
};
const stopped: BootManagerObservation = {
  unit: identity.unit,
  loadState: "loaded",
  activeState: "inactive",
  invocationId: null,
  mainPid: 0,
  controlPid: 0,
  cgroupPath: null,
  jobId: null,
  timestamps: ["0", "0", "0", "0", "0", "0"],
  executed: false,
};
function writeManager(directory: string, manager: BootManagerObservation) {
  const values = new Map<string, string>([
    ["Id", manager.unit],
    ["LoadState", manager.loadState],
    ["ActiveState", manager.activeState],
    ["InvocationID", manager.invocationId ?? ""],
    ["MainPID", String(manager.mainPid)],
    ["ControlPID", String(manager.controlPid)],
    ["ControlGroup", manager.cgroupPath ?? ""],
    ["Job", manager.jobId === null ? "" : String(manager.jobId)],
  ]);
  fs.writeFileSync(
    path.join(directory, "manager.txt"),
    bootManagerProperties.map((name) => `${name}=${values.get(name) ?? "0"}`).join("\n") + "\n",
  );
}
function observeFixture() {
  const directory = process.env.MOIRE_DESKTOP_FIXTURE;
  if (!directory) throw new Error("Missing private fixture directory");
  const countFile = path.join(directory, "observations");
  const count = Number(fs.readFileSync(countFile, "utf8")) + 1;
  fs.writeFileSync(countFile, String(count));
  const mutationFile = path.join(directory, "mutation.json");
  if (fs.existsSync(mutationFile)) {
    const mutation: unknown = JSON.parse(fs.readFileSync(mutationFile, "utf8"));
    if (
      typeof mutation !== "object" ||
      mutation === null ||
      !("at" in mutation) ||
      !("kind" in mutation)
    )
      throw new Error("Invalid fixture mutation");
    if (mutation.at === count) {
      if (mutation.kind === "escape")
        fs.writeFileSync(path.join(directory, "console-requested"), "escape\n", { mode: 0o600 });
      else if (mutation.kind === "identity")
        writeBootServiceRecord(path.join(directory, "service"), "attempt", {
          version: 1,
          bootId: identity.bootId,
          unit: identity.unit,
          state: "attempted",
          invocationId: "b".repeat(32),
        });
      else if (mutation.kind === "disposition") {
        const lease = readBootServiceLease(path.join(directory, "service"));
        writeBootServiceRecord(path.join(directory, "service"), "lease", {
          ...lease,
          phase: "skipped",
          reason: "console-requested",
        });
      } else throw new Error("Unsupported fixture mutation");
    }
  }
  process.stdout.write(fs.readFileSync(path.join(directory, "manager.txt"), "utf8"));
}
async function tests() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "moire-desktop-admission-")));
  const source = fileURLToPath(import.meta.url);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const reports: { scenario: string; kind: string; reason?: string }[] = [];
  try {
    for (const scenario of [
      "never-invoked",
      "never-invoked-missing-parent",
      "never-invoked-escape",
      "before-graphics",
      "display-unavailable",
      "console-disposition-without-latch",
      "escape",
      "unsafe-latch",
      "remaining-owner",
      "late-escape",
      "changed-identity",
      "changed-disposition",
    ]) {
      const directory = path.join(base, scenario);
      fs.mkdirSync(directory, { mode: 0o700 });
      const paths: BootServicePaths = {
        cgroupMount: path.join(directory, "cgroup"),
        procRoot: path.join(directory, "proc"),
        selfPid: process.pid,
      };
      fs.mkdirSync(paths.cgroupMount);
      const stateDirectory = path.join(directory, "service");
      initBootAttemptLedger(stateDirectory, identity);
      const executable = path.join(directory, "manager");
      fs.writeFileSync(
        executable,
        `#!/bin/sh\nexport MOIRE_DESKTOP_FIXTURE=${quote(directory)}\nexec ${[
          process.execPath,
          ...process.execArgv,
          source,
          "--observe",
        ]
          .map(quote)
          .join(" ")} "$@"\n`,
        { mode: 0o700 },
      );
      const observeManager = () => observeBootManager(identity.unit, executable);
      const group = `/system.slice/${identity.unit}`;
      const root = path.join(paths.cgroupMount, group);
      const node = (pids: readonly number[]) => {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, "cgroup.type"), "domain\n");
        fs.writeFileSync(path.join(root, "cgroup.procs"), pids.join("\n") + "\n");
        fs.writeFileSync(
          path.join(root, "cgroup.events"),
          `populated ${Number(pids.length > 0)}\n`,
        );
      };
      const membership = (value: string) => {
        const proc = path.join(paths.procRoot, String(process.pid));
        fs.mkdirSync(proc, { recursive: true });
        fs.writeFileSync(path.join(proc, "cgroup"), `0::${value}\n`);
      };
      fs.writeFileSync(path.join(directory, "observations"), "0");
      membership("/fixture-gate.service");
      if (!scenario.startsWith("never-invoked")) {
        node([process.pid]);
        membership(group);
        writeManager(directory, {
          ...stopped,
          activeState: "activating",
          invocationId: identity.invocationId,
          cgroupPath: group,
          controlPid: process.pid,
          jobId: 123,
        });
        await recordBootAttempt({ stateDirectory, expected: identity, paths, observeManager });
        const lease = beginBootService(stateDirectory, identity, paths);
        const reason: BootSkipReason =
          scenario === "console-disposition-without-latch"
            ? "console-requested"
            : scenario === "display-unavailable"
              ? "display-unavailable"
              : "before-graphics";
        writeBootServiceRecord(stateDirectory, "lease", { ...lease, phase: "skipped", reason });
        assert.equal(
          cleanupBootService({ stateDirectory, expected: identity, paths }).kind,
          "skipped",
        );
        node(scenario === "remaining-owner" ? [777] : []);
        membership("/fixture-gate.service");
      }
      writeManager(directory, stopped);
      fs.writeFileSync(path.join(directory, "observations"), "0");
      const consoleLatchPath =
        scenario === "never-invoked-missing-parent"
          ? path.join(directory, "missing-parent", "console-requested")
          : path.join(directory, "console-requested");
      if (["escape", "never-invoked-escape", "unsafe-latch"].includes(scenario)) {
        fs.writeFileSync(consoleLatchPath, "escape\n", { mode: 0o600 });
        if (scenario === "unsafe-latch") fs.chmodSync(consoleLatchPath, 0o644);
      }
      const mutation =
        scenario === "late-escape"
          ? { at: 4, kind: "escape" }
          : scenario === "changed-identity"
            ? { at: 3, kind: "identity" }
            : scenario === "changed-disposition"
              ? { at: 3, kind: "disposition" }
              : null;
      if (mutation)
        fs.writeFileSync(path.join(directory, "mutation.json"), JSON.stringify(mutation));
      const before = fs.readdirSync(directory).sort();
      const stateBefore = fs
        .readdirSync(stateDirectory)
        .sort()
        .map((name) => ({
          name,
          bytes: fs.readFileSync(path.join(stateDirectory, name)),
        }));
      const result = await checkDesktopAdmission({
        stateDirectory,
        current: identity,
        paths,
        observeManager,
        consoleLatchPath,
      });
      const allowed = ["never-invoked", "before-graphics", "display-unavailable"].includes(
        scenario,
      );
      assert.equal(
        result.kind === "unresolved",
        !allowed,
        `${scenario}: ${JSON.stringify(result)}`,
      );
      if (scenario === "late-escape") {
        assert.equal(result.kind, "unresolved");
        if (result.kind === "unresolved") assert.match(result.reason, /Escape latch/);
      }
      if (!mutation) {
        assert.deepEqual(fs.readdirSync(directory).sort(), before, "policy gate creates no state");
        assert.deepEqual(
          fs
            .readdirSync(stateDirectory)
            .sort()
            .map((name) => ({
              name,
              bytes: fs.readFileSync(path.join(stateDirectory, name)),
            })),
          stateBefore,
          "policy gate preserves authenticated record bytes",
        );
      }
      if (scenario === "never-invoked-missing-parent")
        assert.equal(
          fs.existsSync(path.dirname(consoleLatchPath)),
          false,
          "no implicit runtime initialization",
        );
      // Repeat as a second session/restart policy invocation: persisted intent remains blocked.
      if (scenario === "escape" || scenario === "console-disposition-without-latch") {
        const repeated = await checkDesktopAdmission({
          stateDirectory,
          current: identity,
          paths,
          observeManager,
          consoleLatchPath,
        });
        assert.equal(repeated.kind, "unresolved");
      }
      reports.push({
        scenario,
        kind: result.kind,
        ...(result.kind === "unresolved" ? { reason: result.reason } : {}),
      });
    }
    console.log(
      `desktop admission: ${JSON.stringify(reports)} PASS; production owner/policy checks with real subprocess manager observations and disposable cgroup files; no native manager/readiness/device claim`,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
if (process.argv[2] === "--observe") observeFixture();
else await tests();
