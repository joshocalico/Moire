import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type StoreSnapshot<T> = { readonly items: readonly T[]; readonly revision: string | null };
export type StoreCleanup =
  | { readonly kind: "complete" }
  | { readonly kind: "pending"; readonly message: string };
export type StoreWriteResult<T> = StoreSnapshot<T> & { readonly cleanup: StoreCleanup };
export class StorageConflictError extends Error {}
const MAX_STORE_BYTES = 10 * 1024 * 1024;
const revision = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function loadSnapshot<T>(file: string, parse: (data: unknown) => T[]): StoreSnapshot<T> {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { items: [], revision: null };
    throw error;
  }
  const parts: Buffer[] = [];
  let bytes = 0;
  try {
    if (fs.fstatSync(fd).size > MAX_STORE_BYTES) throw new Error("Saved data exceeds 10 MiB.");
    for (;;) {
      const part = Buffer.alloc(Math.min(65536, MAX_STORE_BYTES + 1 - bytes));
      const count = fs.readSync(fd, part);
      if (count === 0) break;
      bytes += count;
      if (bytes > MAX_STORE_BYTES) throw new Error("Saved data exceeds 10 MiB.");
      parts.push(part.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  const content = Buffer.concat(parts);
  return { items: parse(JSON.parse(content.toString("utf8"))), revision: revision(content) };
}

function busy(): never {
  throw new Error(
    "Storage is busy or an interrupted save has an unknown owner. Try again after the other window finishes.",
  );
}
function claimLock(file: string) {
  const directory = `${file}.write-lock`,
    owner = `${process.pid}-${randomUUID()}.owner`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const lockIdentity = fs.lstatSync(directory);
      if (!lockIdentity.isDirectory() || lockIdentity.isSymbolicLink()) busy();
      const names = fs.readdirSync(directory);
      const owners = names.filter((name) => /^\d+-[0-9a-f-]{36}\.owner$/.test(name));
      const staleOwner = owners[0];
      if (
        owners.length !== 1 ||
        !staleOwner ||
        names.some((name) => name !== staleOwner && name !== `${staleOwner}.tmp`)
      )
        busy();
      const ownerStat = fs.lstatSync(path.join(directory, staleOwner));
      if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) busy();
      const pid = Number(staleOwner.split("-")[0]);
      if (!Number.isSafeInteger(pid) || pid <= 0) busy();
      let dead = false;
      try {
        process.kill(pid, 0);
      } catch (failure) {
        dead = failure instanceof Error && "code" in failure && failure.code === "ESRCH";
      }
      if (!dead) busy();
      // Names include the dead writer's UUID. Another writer cannot acquire this
      // directory until rmdir succeeds, and cannot reuse these private filenames.
      const currentLock = fs.lstatSync(directory);
      if (currentLock.dev !== lockIdentity.dev || currentLock.ino !== lockIdentity.ino) busy();
      const privateTemp = path.join(directory, `${staleOwner}.tmp`);
      if (fs.existsSync(privateTemp)) fs.unlinkSync(privateTemp);
      fs.unlinkSync(path.join(directory, staleOwner));
      fs.rmdirSync(directory);
      continue;
    }
    const ownerPath = path.join(directory, owner);
    const directoryIdentity = fs.lstatSync(directory);
    let fd: number;
    try {
      fd = fs.openSync(ownerPath, "wx", 0o600);
    } catch (error) {
      const current = fs.lstatSync(directory);
      if (
        current.dev === directoryIdentity.dev &&
        current.ino === directoryIdentity.ino &&
        fs.readdirSync(directory).length === 0
      )
        fs.rmdirSync(directory);
      throw error;
    }
    fs.closeSync(fd);
    const ownerIdentity = fs.lstatSync(ownerPath);
    let currentDirectory: string | null = directory;
    let retired: { path: string; dev: number; ino: number } | null = null;
    let ownerPresent = true;
    let temporaryIdentity: { dev: number; ino: number } | null = null;
    const verify = () => {
      if (currentDirectory === null) return;
      const current = fs.lstatSync(currentDirectory);
      if (current.dev !== directoryIdentity.dev || current.ino !== directoryIdentity.ino)
        throw new Error("Save ownership changed; the replacement was kept.");
      const currentOwnerPath = path.join(currentDirectory, owner);
      if (ownerPresent) {
        const currentOwner = fs.lstatSync(currentOwnerPath);
        if (currentOwner.dev !== ownerIdentity.dev || currentOwner.ino !== ownerIdentity.ino)
          throw new Error("Save ownership changed; the replacement was kept.");
      } else if (fs.existsSync(currentOwnerPath))
        throw new Error("Save cleanup ownership changed; the replacement was kept.");
    };
    return {
      directory,
      temporary: path.join(directory, `${owner}.tmp`),
      verify,
      recordTemporary: (fd: number) => {
        const identity = fs.fstatSync(fd);
        temporaryIdentity = { dev: identity.dev, ino: identity.ino };
      },
      get retired() {
        return currentDirectory !== directory;
      },
      cleanup: () => {
        if (currentDirectory === null) return;
        verify();
        // Atomically vacate the canonical lock before unlink/rmdir. The destination
        // is an empty private directory created by this lease, never a foreign path.
        if (currentDirectory === directory) {
          if (!retired) {
            const retiredPath = fs.mkdtempSync(`${directory}.released-`);
            const identity = fs.lstatSync(retiredPath);
            retired = { path: retiredPath, dev: identity.dev, ino: identity.ino };
          }
          const target = fs.lstatSync(retired.path);
          if (
            target.dev !== retired.dev ||
            target.ino !== retired.ino ||
            fs.readdirSync(retired.path).length
          )
            throw new Error("Save retirement ownership changed; the replacement was kept.");
          verify();
          fs.renameSync(directory, retired.path);
          currentDirectory = retired.path;
        }
        verify();
        const temporary = path.join(currentDirectory, `${owner}.tmp`);
        if (fs.existsSync(temporary)) {
          const identity = fs.lstatSync(temporary);
          if (
            !temporaryIdentity ||
            identity.dev !== temporaryIdentity.dev ||
            identity.ino !== temporaryIdentity.ino
          )
            throw new Error("Save temporary ownership changed; the replacement was kept.");
          fs.unlinkSync(temporary);
        }
        if (ownerPresent) {
          fs.unlinkSync(path.join(currentDirectory, owner));
          ownerPresent = false;
        }
        fs.rmdirSync(currentDirectory);
        currentDirectory = null;
      },
    };
  }
  return busy();
}
type WriteLease = ReturnType<typeof claimLock>;
const pendingCleanup = new Map<string, WriteLease[]>();
const MAX_PENDING_CLEANUP = 8;
const cleanupMessage = (errors: readonly string[]) =>
  `Storage cleanup is pending: ${errors.join("; ")}. Retrying cleanup never saves another copy.`;
function retryOwnedCleanup(): string[] {
  const pending = [...pendingCleanup.entries()].flatMap(([file, leases]) =>
    leases.map((lease) => ({ file, lease })),
  );
  const errors: string[] = [];
  // At most eight authenticated leases are retained for this module/process.
  // Unretired leases go first because they may still occupy canonical paths.
  pending.sort((a, b) => Number(a.lease.retired) - Number(b.lease.retired));
  pendingCleanup.clear();
  for (const { file, lease } of pending) {
    try {
      lease.cleanup();
    } catch (error) {
      pendingCleanup.set(file, [...(pendingCleanup.get(file) ?? []), lease]);
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}
export function retryStoreCleanup(): StoreCleanup {
  const errors = retryOwnedCleanup();
  return errors.length
    ? { kind: "pending", message: cleanupMessage(errors) }
    : { kind: "complete" };
}
export function writeSnapshot<T>(
  file: string,
  items: readonly T[],
  expectedRevision: string | null,
  parse: (data: unknown) => T[],
): StoreWriteResult<T> {
  file = path.resolve(file);
  const content = JSON.stringify(items, null, 2) + "\n";
  const parsed = parse(JSON.parse(content));
  if (Buffer.byteLength(content, "utf8") > MAX_STORE_BYTES)
    throw new Error("Saved data exceeds 10 MiB; your draft remains here.");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const cleanupErrors = retryOwnedCleanup();
  if (
    [...pendingCleanup.values()].reduce((count, leases) => count + leases.length, 0) >=
    MAX_PENDING_CLEANUP
  )
    throw new Error(
      "Owned storage cleanup is still pending after eight saves. No new changes were published; retry once cleanup can finish.",
    );
  const lease = claimLock(file);
  let fd: number | null = null;
  let publication:
    | { kind: "committed"; snapshot: StoreSnapshot<T> }
    | { kind: "failed"; error: unknown };
  try {
    if (loadSnapshot(file, parse).revision !== expectedRevision)
      throw new StorageConflictError(
        "Saved data changed in another window. Reload saved data before retrying; your draft remains here.",
      );
    fd = fs.openSync(lease.temporary, "wx", 0o600);
    lease.recordTemporary(fd);
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    lease.verify();
    if (loadSnapshot(file, parse).revision !== expectedRevision)
      throw new StorageConflictError("Saved data changed while saving; your draft remains here.");
    fs.renameSync(lease.temporary, file);
    publication = { kind: "committed", snapshot: { items: parsed, revision: revision(content) } };
  } catch (error) {
    publication = { kind: "failed", error };
  }
  if (fd !== null) {
    try {
      fs.closeSync(fd);
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    lease.cleanup();
  } catch (error) {
    pendingCleanup.set(file, [...(pendingCleanup.get(file) ?? []), lease]);
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
  }
  if (publication.kind === "failed") {
    if (cleanupErrors.length && publication.error instanceof StorageConflictError) {
      publication.error.message += `. Storage cleanup is pending: ${cleanupErrors.join("; ")}`;
      throw publication.error;
    }
    if (cleanupErrors.length)
      throw new Error(
        `${publication.error instanceof Error ? publication.error.message : String(publication.error)}. Storage cleanup is pending: ${cleanupErrors.join("; ")}`,
        { cause: publication.error },
      );
    throw publication.error;
  }
  return {
    ...publication.snapshot,
    cleanup: cleanupErrors.length
      ? { kind: "pending", message: cleanupMessage(cleanupErrors) }
      : { kind: "complete" },
  };
}
