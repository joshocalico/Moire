import fs from "node:fs";
import path from "node:path";
import {
  bootServicePaths,
  cgroupDirectory,
  currentCgroup,
  directoryIdentity,
  sameDirectory,
  readBoundedBootFile,
  type BootServiceLease,
  type BootServicePaths,
} from "./boot-service-state";

const proofToken: unique symbol = Symbol("boot-owner-proof");
const proofs = new WeakSet<ExitedOwnersProof>();
export type ExitedOwnersProof = Readonly<{
  [proofToken]: true;
  lease: BootServiceLease;
  paths: BootServicePaths;
  excludeSelf: boolean;
}>;
export type BootOwnerObservation =
  | { kind: "exited"; proof: ExitedOwnersProof }
  | { kind: "other-processes"; pids: readonly number[] }
  | { kind: "unresolved"; reason: string };

/** Reads actual cgroup membership; never signals, migrates or opens a device. */
export function observeBootServiceOwners(
  lease: BootServiceLease,
  paths = bootServicePaths,
  excludeSelf = true,
): BootOwnerObservation {
  try {
    const root = cgroupDirectory(lease.cgroupPath, paths);
    if (!sameDirectory(directoryIdentity(root), lease.cgroupIdentity))
      throw new Error("Service root was recreated");
    const membership = currentCgroup(paths);
    const inside = membership === lease.cgroupPath || membership.startsWith(lease.cgroupPath + "/");
    if (excludeSelf && !inside) throw new Error("Cleanup helper is outside the recorded service");
    if (!excludeSelf && inside)
      throw new Error("Readiness gate must be outside the workload service");
    const scan = () => {
      const directories: {
        directory: string;
        identity: string;
        pids: number[];
        populated: number;
      }[] = [];
      const allPids = new Set<number>();
      const visit = (directory: string) => {
        if (directories.length >= 256) throw new Error("Cgroup directory scan limit exceeded");
        const before = directoryIdentity(directory);
        if (readBoundedBootFile(path.join(directory, "cgroup.type"), 64).trim() !== "domain")
          throw new Error("Unsupported threaded cgroup ownership");
        const raw = readBoundedBootFile(path.join(directory, "cgroup.procs"), 65536);
        if (Buffer.byteLength(raw) > 65536) throw new Error("Cgroup PID input limit exceeded");
        const pids = [
          ...new Set(
            raw.trim()
              ? raw
                  .trim()
                  .split(/\s+/)
                  .map((value) => {
                    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
                      throw new Error("Malformed cgroup PID");
                    return Number(value);
                  })
              : [],
          ),
        ].sort((a, b) => a - b);
        for (const pid of pids) {
          allPids.add(pid);
          if (allPids.size > 4096) throw new Error("Cgroup PID scan limit exceeded");
        }
        const events = readBoundedBootFile(path.join(directory, "cgroup.events"), 4096);
        const matches = [...events.matchAll(/^populated ([01])$/gm)];
        if (matches.length !== 1) throw new Error("Malformed cgroup populated evidence");
        const populated = Number(matches[0]?.[1]);
        directories.push({ directory, identity: JSON.stringify(before), pids, populated });
        const entries = fs
          .readdirSync(directory, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.isSymbolicLink()) throw new Error("Unexpected symlink in cgroup tree");
          if (entry.isDirectory()) visit(path.join(directory, entry.name));
        }
        if (!sameDirectory(before, directoryIdentity(directory)))
          throw new Error("Cgroup changed during scan");
        const hasRecursiveMembers = directories.some(
          (node) =>
            (node.directory === directory || node.directory.startsWith(directory + path.sep)) &&
            node.pids.length > 0,
        );
        if (populated !== Number(hasRecursiveMembers))
          throw new Error("Cgroup membership changed during scan");
      };
      visit(root);
      return { directories, allPids };
    };
    const first = scan(),
      second = scan();
    if (
      JSON.stringify(first.directories) !== JSON.stringify(second.directories) ||
      currentCgroup(paths) !== membership ||
      !sameDirectory(directoryIdentity(root), lease.cgroupIdentity)
    )
      throw new Error("Unstable cgroup ownership observation");
    if (excludeSelf) {
      const selfDirectory =
        membership === lease.cgroupPath
          ? root
          : path.join(root, membership.slice(lease.cgroupPath.length + 1));
      const placements = second.directories.filter((node) => node.pids.includes(paths.selfPid));
      if (placements.length !== 1 || placements[0]?.directory !== selfDirectory)
        throw new Error("Exact cleanup helper membership is missing or inconsistent");
    }
    const others = [...second.allPids]
      .filter((pid) => !excludeSelf || pid !== paths.selfPid)
      .sort((a, b) => a - b);
    if (others.length) return { kind: "other-processes", pids: others };
    // Lifecycle requirement: systemd has stopped workload creation/migration,
    // and this helper stays childless. Stable scans alone are not an atomic lock.
    const pinnedLease = structuredClone(lease);
    Object.freeze(pinnedLease.cgroupIdentity);
    if (pinnedLease.phase !== "skipped") Object.freeze(pinnedLease.console);
    Object.freeze(pinnedLease);
    const proof = Object.freeze<ExitedOwnersProof>({
      [proofToken]: true,
      lease: pinnedLease,
      paths: Object.freeze({ ...paths }),
      excludeSelf,
    });
    proofs.add(proof);
    return { kind: "exited", proof };
  } catch (error) {
    return { kind: "unresolved", reason: error instanceof Error ? error.message : String(error) };
  }
}
/** Revalidate at the ioctl boundary; externally fabricated tokens are rejected. */
export function revalidateBootOwnerProof(proof: ExitedOwnersProof): void {
  if (!proofs.has(proof)) throw new Error("Unrecognized boot owner proof");
  const current = observeBootServiceOwners(proof.lease, proof.paths, proof.excludeSelf);
  if (current.kind !== "exited")
    throw new Error(current.kind === "unresolved" ? current.reason : "Renderer owners remain");
}
