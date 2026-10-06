import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { GreeterMotionPreferences, GreeterMotionSnapshot } from "./types";

export type FixtureGreeterMotionOptions = Readonly<{ qualification: "fixture"; path: string }>;
/** Explicit disposable fixture file. Never discovers a home or writes shared Moire settings. */
export async function createFixtureGreeterMotionPreferences(
  options: FixtureGreeterMotionOptions,
): Promise<GreeterMotionPreferences> {
  const uid = process.getuid?.();
  if (
    options.qualification !== "fixture" ||
    uid === undefined ||
    typeof options.path !== "string" ||
    !path.isAbsolute(options.path) ||
    options.path.includes("\0")
  )
    throw new Error("Invalid fixture motion preferences");
  const filename = options.path,
    directory = path.dirname(filename);
  let state: GreeterMotionSnapshot = Object.freeze({ reducedMotion: true, status: "ready" });
  let disposed = false,
    latest = 0,
    queue = Promise.resolve();
  const listeners = new Set<() => void>();
  function publish(next: GreeterMotionSnapshot) {
    if (disposed) return;
    state = Object.freeze(next);
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {}
    }
  }
  async function privateDirectory() {
    const info = await fs.lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== uid ||
      (info.mode & 0o777) !== 0o700
    )
      throw new Error("Fixture motion directory is not private");
    return info;
  }
  async function existingFile() {
    try {
      const info = await fs.lstat(filename);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== uid ||
        (info.mode & 0o777) !== 0o600 ||
        info.size > 128
      )
        throw new Error("Invalid fixture motion file");
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return false;
      throw new Error("Fixture motion file unavailable");
    }
  }
  try {
    await privateDirectory();
    if (await existingFile()) {
      const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.uid !== uid || (info.mode & 0o777) !== 0o600 || info.size > 128)
          throw new Error("Invalid fixture motion file");
        const value: unknown = JSON.parse(await file.readFile("utf8"));
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).length !== 1 ||
          !("reducedMotion" in value) ||
          typeof value.reducedMotion !== "boolean"
        )
          throw new Error("Invalid fixture motion value");
        state = Object.freeze({ reducedMotion: value.reducedMotion, status: "ready" });
      } finally {
        await file.close();
      }
    }
  } catch {
    state = Object.freeze({ reducedMotion: true, status: "failed" });
  }
  async function write(value: boolean) {
    const before = await privateDirectory();
    await existingFile();
    const temporary = path.join(
      directory,
      "." + path.basename(filename) + "." + randomUUID() + ".tmp",
    );
    try {
      const file = await fs.open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(JSON.stringify({ reducedMotion: value }) + "\n", "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      const after = await privateDirectory();
      if (after.dev !== before.dev || after.ino !== before.ino)
        throw new Error("Fixture motion directory changed");
      await existingFile();
      await fs.rename(temporary, filename);
      const parent = await fs.open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }
  return {
    qualification: "fixture",
    snapshot() {
      return state;
    },
    subscribe(listener) {
      if (disposed || listeners.size >= 64) throw new Error("Fixture motion observer unavailable");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setReducedMotion(value) {
      if (disposed || typeof value !== "boolean")
        throw new Error("Fixture motion save unavailable");
      const request = ++latest;
      const operation = queue.then(async () => {
        if (disposed) throw new Error("Fixture motion save unavailable");
        try {
          await write(value);
          if (request === latest) publish({ reducedMotion: value, status: "saved" });
        } catch {
          if (request === latest) publish({ reducedMotion: value, status: "failed" });
          throw new Error("Fixture motion preference save failed");
        }
      });
      // Own the serialized operation before notifying observers who may request another value.
      queue = operation.catch(() => {});
      publish({ reducedMotion: value, status: "saving" });
      return operation;
    },
    dispose() {
      disposed = true;
      latest++;
      listeners.clear();
    },
  };
}
