import fs from "node:fs";
import path from "node:path";
import { readBootAttemptLedger, type BootCurrentIdentity } from "./boot-attempt-ledger";
import {
  observeBootManager,
  type BootManagerObserver,
  type BootManagerObservation,
} from "./boot-manager-observation";
import { checkBootServiceRelease } from "./boot-service-release";
import {
  bootServicePaths,
  directoryIdentity,
  sameDirectory,
  readBootServiceLease,
  readBootServiceRelease,
  validateBootStateDirectory,
  type BootServiceIdentity,
  type BootServicePaths,
} from "./boot-service-state";

export type BootAdmissionCheckpoint =
  | { kind: "never-attempted" }
  | { kind: "invocation"; invocationId: string };
export type BootAdmissionResult =
  | { kind: "not-invoked"; bootId: string; unit: string }
  | { kind: "released" | "skipped"; expected: BootServiceIdentity }
  | { kind: "unresolved"; reason: string };
export function parseBootAdmissionCheckpoint(token: string): BootAdmissionCheckpoint {
  if (token === "not-invoked") return { kind: "never-attempted" };
  if (/^[0-9a-f]{32}$/.test(token)) return { kind: "invocation", invocationId: token };
  throw new Error("Admission checkpoint must be not-invoked or 32 lowercase hexadecimal digits");
}
function assertStopped(manager: BootManagerObservation, unit: string): void {
  if (
    manager.unit !== unit ||
    (manager.activeState !== "inactive" && manager.activeState !== "failed") ||
    manager.jobId !== null ||
    manager.mainPid !== 0 ||
    manager.controlPid !== 0
  )
    throw new Error("Boot manager does not confirm a stopped workload without pending jobs");
}
/** Never-attempted means no records, temporary publication, or service root anywhere in this hierarchy. */
function assertNoAttemptArtifacts(
  stateDirectory: string,
  unit: string,
  paths: BootServicePaths,
): void {
  validateBootStateDirectory(stateDirectory);
  if (fs.readdirSync(stateDirectory).some((name) => name !== "attempt.json"))
    throw new Error("Never-attempted ledger conflicts with state artifacts");
  let count = 0;
  const visit = (directory: string, depth: number) => {
    if (++count > 4096 || depth > 64) throw new Error("Cgroup absence observation limit exceeded");
    const pinned = directoryIdentity(directory);
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    const names = entries.map((entry) => entry.name);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error("Unexpected cgroup symlink");
      if (entry.isDirectory()) {
        if (entry.name === unit) throw new Error("Never-attempted service root exists");
        visit(path.join(directory, entry.name), depth + 1);
      }
    }
    if (
      !sameDirectory(pinned, directoryIdentity(directory)) ||
      JSON.stringify(fs.readdirSync(directory).sort((a, b) => a.localeCompare(b))) !==
        JSON.stringify(names)
    )
      throw new Error("Cgroup topology changed during absence check");
  };
  visit(fs.realpathSync(paths.cgroupMount), 0);
}
/** Read-only. The surrounding unit transaction must exclude competing boot launches/migration. */
export async function checkBootDesktopAdmission(options: {
  stateDirectory: string;
  current: BootCurrentIdentity;
  paths?: BootServicePaths;
  checkpoint?: BootAdmissionCheckpoint;
  observeManager?: BootManagerObserver;
}): Promise<BootAdmissionResult> {
  try {
    const { stateDirectory, current } = options,
      paths = options.paths ?? bootServicePaths;
    const observe = options.observeManager ?? (() => observeBootManager(current.unit));
    const before = await observe();
    assertStopped(before, current.unit);
    const ledger = readBootAttemptLedger(stateDirectory, current);
    let result: Exclude<BootAdmissionResult, { kind: "unresolved" }>;
    let records: string | null = null;
    const snapshot = () =>
      JSON.stringify({
        lease: readBootServiceLease(stateDirectory),
        release: readBootServiceRelease(stateDirectory),
      });
    if (ledger.state === "never-attempted") {
      if (
        before.activeState !== "inactive" ||
        before.invocationId !== null ||
        before.executed ||
        before.cgroupPath !== null ||
        (options.checkpoint !== undefined && options.checkpoint.kind !== "never-attempted")
      )
        throw new Error("Never-attempted ledger conflicts with manager/checkpoint evidence");
      assertNoAttemptArtifacts(stateDirectory, current.unit, paths);
      result = { kind: "not-invoked", ...current };
    } else {
      const expected = { ...current, invocationId: ledger.invocationId };
      if (
        (before.invocationId !== null && before.invocationId !== ledger.invocationId) ||
        (options.checkpoint !== undefined &&
          (options.checkpoint.kind !== "invocation" ||
            options.checkpoint.invocationId !== ledger.invocationId))
      )
        throw new Error("Boot invocation changed since the recorded attempt/checkpoint");
      records = snapshot();
      const checked = checkBootServiceRelease({ stateDirectory, expected, paths });
      if (checked.kind !== "released" && checked.kind !== "skipped")
        throw new Error(checked.kind === "unresolved" ? checked.reason : "Boot owners remain");
      if (before.cgroupPath !== null && before.cgroupPath !== checked.acknowledgement.cgroupPath)
        throw new Error("Manager cgroup disagrees with released workload");
      result = { kind: checked.kind, expected };
    }
    const after = await observe();
    assertStopped(after, current.unit);
    if (
      JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(readBootAttemptLedger(stateDirectory, current)) !== JSON.stringify(ledger)
    )
      throw new Error("Manager or attempt ledger changed during admission");
    if (records !== null) {
      if (snapshot() !== records || result.kind === "not-invoked")
        throw new Error("Cleanup history changed during admission");
      const checked = checkBootServiceRelease({ stateDirectory, expected: result.expected, paths });
      if (checked.kind !== result.kind) throw new Error("Final historical owner proof failed");
    } else assertNoAttemptArtifacts(stateDirectory, current.unit, paths);
    if (
      JSON.stringify(readBootAttemptLedger(stateDirectory, current)) !== JSON.stringify(ledger) ||
      (records !== null && snapshot() !== records)
    )
      throw new Error("Admission evidence changed during final owner check");
    return result;
  } catch (error) {
    return { kind: "unresolved", reason: error instanceof Error ? error.message : String(error) };
  }
}
