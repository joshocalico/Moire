import fs from "node:fs";
import path from "node:path";
import { observeBootServiceOwners, revalidateBootOwnerProof } from "./boot-service-cleanup";
import { releaseBootConsole, type BootConsoleIo } from "./boot-console-release";
import {
  bootServicePaths,
  readBootServiceLease,
  readBootServiceRelease,
  sameDirectory,
  sameInvocation,
  releaseMatchesLease,
  writeBootServiceRecord,
  cgroupDirectory,
  directoryIdentity,
  type BootServiceIdentity,
  type BootServicePaths,
  type BootServiceRelease,
} from "./boot-service-state";

export type BootCleanupResult =
  | { kind: "released"; acknowledgement: Extract<BootServiceRelease, { kind: "released" }> }
  | { kind: "skipped"; acknowledgement: Extract<BootServiceRelease, { kind: "skipped" }> }
  | { kind: "pending"; pids: readonly number[] }
  | { kind: "unresolved"; reason: string };
export function cleanupBootService(options: {
  stateDirectory: string;
  expected: BootServiceIdentity;
  paths?: BootServicePaths;
  consoleIo?: BootConsoleIo;
}): BootCleanupResult {
  try {
    const lease = readBootServiceLease(options.stateDirectory);
    if (!sameInvocation(lease, options.expected))
      throw new Error("Lease belongs to another boot/service invocation");
    // Never retain a prior success if this attempt cannot reproduce ownership proof.
    try {
      fs.unlinkSync(path.join(options.stateDirectory, "release.json"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const owners = observeBootServiceOwners(lease, options.paths ?? bootServicePaths);
    if (owners.kind === "other-processes") return { kind: "pending", pids: owners.pids };
    if (owners.kind === "unresolved") return owners;
    const verifyCurrentLease = () => {
      if (JSON.stringify(readBootServiceLease(options.stateDirectory)) !== JSON.stringify(lease))
        throw new Error("Boot lease changed during cleanup");
    };
    const base = {
      version: 1 as const,
      bootId: lease.bootId,
      invocationId: lease.invocationId,
      unit: lease.unit,
      cgroupPath: lease.cgroupPath,
      cgroupIdentity: lease.cgroupIdentity,
    };
    let acknowledgement: BootServiceRelease;
    if (lease.phase === "graphics-intent") {
      releaseBootConsole(owners.proof, options.consoleIo, verifyCurrentLease);
      acknowledgement = { ...base, kind: "released", ttyPath: lease.console.ttyPath, mode: 0 };
    } else {
      acknowledgement = {
        ...base,
        kind: "skipped",
        reason: lease.phase === "skipped" ? lease.reason : "before-graphics",
      };
    }
    revalidateBootOwnerProof(owners.proof);
    verifyCurrentLease();
    writeBootServiceRecord(options.stateDirectory, "release", acknowledgement);
    return acknowledgement.kind === "released"
      ? { kind: "released", acknowledgement }
      : { kind: "skipped", acknowledgement };
  } catch (error) {
    return { kind: "unresolved", reason: error instanceof Error ? error.message : String(error) };
  }
}
/** Historical successful cleanup remains valid after systemd removes the root.
 * The caller supplies the manager's invocation captured before requesting stop,
 * and must reject a new manager invocation before desktop handoff. */
export function checkBootServiceRelease(options: {
  stateDirectory: string;
  expected: BootServiceIdentity;
  paths?: BootServicePaths;
}): BootCleanupResult {
  try {
    const paths = options.paths ?? bootServicePaths;
    const lease = readBootServiceLease(options.stateDirectory),
      release = readBootServiceRelease(options.stateDirectory);
    if (
      !sameInvocation(lease, options.expected) ||
      !sameInvocation(release, options.expected) ||
      !releaseMatchesLease(lease, release)
    )
      throw new Error("No release acknowledgement for this exact lease/invocation");
    // A missing root is accepted only AFTER a validated historical success above.
    const root = path.join(fs.realpathSync(paths.cgroupMount), lease.cgroupPath.slice(1));
    let missing = false;
    try {
      fs.lstatSync(root);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") missing = true;
      else throw error;
    }
    if (!missing) {
      if (
        !sameDirectory(
          directoryIdentity(cgroupDirectory(lease.cgroupPath, paths)),
          lease.cgroupIdentity,
        )
      )
        throw new Error("Service root was recreated after cleanup");
      const owners = observeBootServiceOwners(lease, paths, false);
      if (owners.kind !== "exited")
        throw new Error(
          owners.kind === "unresolved" ? owners.reason : "Service owners reappeared after cleanup",
        );
    }
    return release.kind === "released"
      ? { kind: "released", acknowledgement: release }
      : { kind: "skipped", acknowledgement: release };
  } catch (error) {
    return { kind: "unresolved", reason: error instanceof Error ? error.message : String(error) };
  }
}
