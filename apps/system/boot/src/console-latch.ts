import fs from "node:fs";
import path from "node:path";

export type ConsoleRequestLatch = { kind: "absent" } | { kind: "requested" };
/** Existing guardian format. Read-only; unsafe or malformed state is never treated as absent. */
export function readConsoleRequestLatch(file: string): ConsoleRequestLatch {
  if (!path.isAbsolute(file) || path.resolve(file) !== file)
    throw new Error("Console latch requires a canonical absolute path");
  const parent = path.dirname(file),
    owner = process.getuid?.();
  const directory = fs.lstatSync(parent);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== owner ||
    (directory.mode & 0o077) !== 0 ||
    fs.realpathSync(parent) !== parent
  )
    throw new Error("Console latch parent must be private and owned by this service user");
  const verifyParent = () => {
    const current = fs.lstatSync(parent);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.uid !== owner ||
      (current.mode & 0o077) !== 0 ||
      current.dev !== directory.dev ||
      current.ino !== directory.ino ||
      fs.realpathSync(parent) !== parent
    )
      throw new Error("Console latch parent changed during observation");
  };
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      verifyParent();
      return { kind: "absent" };
    }
    throw error;
  }
  const privateFile = (value: fs.Stats) =>
    value.isFile() &&
    !value.isSymbolicLink() &&
    value.uid === owner &&
    (value.mode & 0o077) === 0 &&
    value.nlink === 1 &&
    value.size === 7;
  if (!privateFile(stat))
    throw new Error("Console latch must be one private regular escape record");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!privateFile(opened) || opened.dev !== stat.dev || opened.ino !== stat.ino)
      throw new Error("Console latch identity changed during open");
    const bytes = Buffer.alloc(8);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fs.fstatSync(fd),
      current = fs.lstatSync(file);
    if (
      length !== 7 ||
      bytes.subarray(0, length).toString("utf8") !== "escape\n" ||
      !privateFile(after) ||
      !privateFile(current) ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    )
      throw new Error("Console latch content or identity changed during read");
    verifyParent();
    return { kind: "requested" };
  } finally {
    fs.closeSync(fd);
  }
}
