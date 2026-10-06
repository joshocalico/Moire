import fs from "node:fs";
import path from "node:path";
import {
  bootServicePaths,
  cgroupDirectory,
  currentCgroup,
  directoryIdentity,
  readBootStateRecord,
  readBootServiceLease,
  readBootServiceRelease,
  releaseMatchesLease,
  sameInvocation,
  validateBootStateDirectory,
  writeBootServiceRecord,
  type BootServiceIdentity,
  type BootServicePaths,
  type BootServiceLease,
} from "./boot-service-state";
import { observeBootServiceOwners, revalidateBootOwnerProof } from "./boot-service-cleanup";
import { observeBootManager, type BootManagerObserver } from "./boot-manager-observation";

export type BootAttemptLedger = Readonly<{ version: 1; bootId: string; unit: string }> &
  (Readonly<{ state: "never-attempted" }> | Readonly<{ state: "attempted"; invocationId: string }>);
export type BootCurrentIdentity = Pick<BootServiceIdentity, "bootId" | "unit">;
function validateIdentity(current: BootCurrentIdentity): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(current.bootId) ||
    !/^[a-zA-Z0-9_.@-]+\.service$/.test(current.unit)
  )
    throw new Error("Invalid boot ledger identity");
}
export function readBootAttemptLedger(
  stateDirectory: string,
  current: BootCurrentIdentity,
): BootAttemptLedger {
  validateIdentity(current);
  const value = readBootStateRecord(stateDirectory, "attempt");
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("bootId" in value) ||
    value.bootId !== current.bootId ||
    !("unit" in value) ||
    value.unit !== current.unit ||
    !("state" in value)
  )
    throw new Error("Invalid or foreign boot attempt ledger");
  if (
    value.state === "never-attempted" &&
    Object.keys(value).sort().join(",") === "bootId,state,unit,version"
  )
    return { version: 1, bootId: current.bootId, unit: current.unit, state: "never-attempted" };
  if (
    value.state === "attempted" &&
    "invocationId" in value &&
    typeof value.invocationId === "string" &&
    /^[0-9a-f]{32}$/.test(value.invocationId) &&
    Object.keys(value).sort().join(",") === "bootId,invocationId,state,unit,version"
  )
    return {
      version: 1,
      bootId: current.bootId,
      unit: current.unit,
      state: "attempted",
      invocationId: value.invocationId,
    };
  throw new Error("Invalid boot attempt ledger state");
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
/** Only the common current-boot initializer may create an absent ledger. */
export function initBootAttemptLedger(
  stateDirectory: string,
  current: BootCurrentIdentity,
): BootAttemptLedger {
  validateIdentity(current);
  if (!path.isAbsolute(stateDirectory)) throw new Error("Absolute boot state directory required");
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  validateBootStateDirectory(stateDirectory);
  try {
    return readBootAttemptLedger(stateDirectory, current);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (fs.readdirSync(stateDirectory).length !== 0)
    throw new Error("Missing attempt ledger conflicts with existing state evidence");
  const ledger: BootAttemptLedger = {
    version: 1,
    bootId: current.bootId,
    unit: current.unit,
    state: "never-attempted",
  };
  writeBootServiceRecord(stateDirectory, "attempt", ledger);
  return ledger;
}
/** ExecStartPre only: authenticate old history separately from the new root's exact-self proof. */
export async function recordBootAttempt(options: {
  stateDirectory: string;
  expected: BootServiceIdentity;
  paths?: BootServicePaths;
  observeManager?: BootManagerObserver;
}): Promise<BootAttemptLedger> {
  const { stateDirectory, expected } = options,
    paths = options.paths ?? bootServicePaths;
  if (!/^[0-9a-f]{32}$/.test(expected.invocationId))
    throw new Error("Invalid attempted invocation");
  const observe = options.observeManager ?? (() => observeBootManager(expected.unit));
  const before = await observe();
  const membership = currentCgroup(paths);
  const group = membership.endsWith("/.control") ? path.posix.dirname(membership) : membership;
  if (
    path.posix.basename(group) !== expected.unit ||
    (membership !== group && membership !== group + "/.control")
  )
    throw new Error("Attempt helper must belong to the exact service root or .control");
  const assertManager = (manager: typeof before) => {
    if (
      manager.unit !== expected.unit ||
      manager.loadState !== "loaded" ||
      manager.activeState !== "activating" ||
      manager.invocationId !== expected.invocationId ||
      manager.cgroupPath !== group ||
      manager.mainPid !== 0 ||
      (manager.controlPid !== 0 && manager.controlPid !== paths.selfPid)
    )
      throw new Error("Manager does not confirm this pre-start invocation/root");
  };
  assertManager(before);
  const ledger = readBootAttemptLedger(stateDirectory, expected);
  let history: {
    lease: BootServiceLease;
    release: ReturnType<typeof readBootServiceRelease>;
  } | null = null;
  if (ledger.state === "attempted") {
    const lease = readBootServiceLease(stateDirectory),
      release = readBootServiceRelease(stateDirectory);
    if (
      !sameInvocation(lease, { ...expected, invocationId: ledger.invocationId }) ||
      !releaseMatchesLease(lease, release)
    )
      throw new Error("Previous attempted invocation lacks matching cleanup history");
    history = { lease, release };
  } else if (fs.readdirSync(stateDirectory).some((name) => name !== "attempt.json")) {
    throw new Error("Never-attempted ledger has unexpected state evidence");
  }
  const candidate: BootServiceLease = {
    ...expected,
    version: 1,
    cgroupPath: group,
    cgroupIdentity: directoryIdentity(cgroupDirectory(group, paths)),
    phase: "skipped",
    reason: "before-graphics",
  };
  const owners = observeBootServiceOwners(candidate, paths);
  if (owners.kind !== "exited")
    throw new Error(
      owners.kind === "unresolved"
        ? owners.reason
        : "Prior workload owners remain in the new service root",
    );
  const after = await observe();
  assertManager(after);
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    JSON.stringify(readBootAttemptLedger(stateDirectory, expected)) !== JSON.stringify(ledger)
  )
    throw new Error("Attempt admission changed during observation");
  if (
    history &&
    JSON.stringify({
      lease: readBootServiceLease(stateDirectory),
      release: readBootServiceRelease(stateDirectory),
    }) !== JSON.stringify(history)
  )
    throw new Error("Prior cleanup history changed during attempt admission");
  revalidateBootOwnerProof(owners.proof);
  const next: BootAttemptLedger = {
    version: 1,
    bootId: expected.bootId,
    unit: expected.unit,
    state: "attempted",
    invocationId: expected.invocationId,
  };
  writeBootServiceRecord(stateDirectory, "attempt", next);
  return next;
}
