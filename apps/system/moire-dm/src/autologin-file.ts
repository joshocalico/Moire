/**
 * The automatic-login state file on disk, shared by its one reader (the broker, root) and its
 * one writer (moire-dm-settings, unprivileged). Both sides go through `parseAutologin`, so the
 * writer can only produce what the broker accepts.
 *
 * - Reading opens with O_NOFOLLOW and checks the open descriptor, so a symlink or a swap between
 *   the check and the read can't make root read some other file.
 * - Writing goes to a fresh temporary file in the same directory (O_EXCL, O_NOFOLLOW, mode 0644),
 *   is flushed, renamed over the old file, and the directory is flushed.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseAutologin, type Autologin, type DmConfig, type FileFacts } from "./config";

export const AUTOLOGIN_PATH = "/var/lib/moire-dm/autologin.json";
/** One byte over the parser's limit, so an oversized file is seen as oversized. */
const READ_LIMIT = 4097;
const STATE_MODE = 0o644;

export type AutologinFile = Readonly<{ facts: FileFacts | null; text: string | null }>;

/** What is on disk, without following links. A missing file is `{ facts: null }`. */
export function readAutologinFile(file: string): AutologinFile {
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ELOOP: the name is a symlink. Anything there that we can't open as a file is "odd".
    if (code === "ENOENT") return { facts: null, text: null };
    return {
      facts: { regularFile: false, ownerUid: -1, mode: 0, size: 0 },
      text: null,
    };
  }
  try {
    const stat = fs.fstatSync(fd);
    const facts = {
      regularFile: stat.isFile(),
      ownerUid: stat.uid,
      mode: stat.mode,
      size: stat.size,
    };
    if (!stat.isFile()) return { facts, text: "" };
    const buffer = Buffer.alloc(READ_LIMIT);
    let length = 0;
    while (length < READ_LIMIT) {
      const read = fs.readSync(fd, buffer, length, READ_LIMIT - length, null);
      if (read === 0) break;
      length += read;
    }
    return {
      facts: { ...facts, size: Math.max(stat.size, length) },
      text: buffer.toString("utf8", 0, length),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** The broker's view of the file: anything odd is `invalid`, a missing file is `disabled`. */
export function loadAutologin(config: DmConfig, file: string, writerUid: number): Autologin {
  const { facts, text } = readAutologinFile(file);
  // A non-file still has to come back as "owner", which parseAutologin decides from the facts.
  return parseAutologin(config, facts, facts && text === null ? "" : text, writerUid);
}

export type AutologinRecord = Readonly<{ user: string; session: string }> | null;

export function encodeAutologin(record: AutologinRecord): string {
  return `${JSON.stringify(
    record
      ? { version: 1, user: record.user, session: record.session }
      : { version: 1, user: null },
  )}\n`;
}

/**
 * Write the state atomically. The content is checked with the broker's own parser, as if it were
 * already on disk with this process as its owner, before anything is written.
 */
export function writeAutologinFile(
  config: DmConfig,
  file: string,
  record: AutologinRecord,
  ownerUid: number,
): void {
  const text = encodeAutologin(record);
  const expected = parseAutologin(
    config,
    { regularFile: true, ownerUid, mode: 0o100000 | STATE_MODE, size: Buffer.byteLength(text) },
    text,
    ownerUid,
  );
  const matches = record
    ? expected.kind === "enabled" &&
      expected.user === record.user &&
      expected.session.id === record.session
    : expected.kind === "disabled";
  if (!matches) throw new Error("automatic-login state would not be accepted");
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${crypto.randomBytes(8).toString("hex")}`,
  );
  const fd = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    STATE_MODE,
  );
  try {
    try {
      // The unit's umask may be stricter or looser; the broker requires exactly not-writable-by-others.
      fs.fchmodSync(fd, STATE_MODE);
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  const dir = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
