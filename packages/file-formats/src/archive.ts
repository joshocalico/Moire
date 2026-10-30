/**
 * What an archive holds, for a preview: its top-level entries with their sizes and the totals.
 * libarchive's `bsdtar` reads every format; zip and plain gzip are also read directly, so a
 * system without it still previews the common cases.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { listZip } from "./zip";

export type ArchiveEntry = {
  /** The top-level name, without a trailing slash. */
  name: string;
  isDir: boolean;
  /** Bytes of the file, or of every file under the folder. */
  size: number;
  /** Members under a folder (0 for a file). */
  items: number;
};

export type ArchiveSummary = {
  entries: ArchiveEntry[];
  files: number;
  folders: number;
  /** Uncompressed bytes of every file. */
  totalSize: number;
  /** The listing stopped at the member cap. */
  truncated: boolean;
};

/** Listings stop here; the totals then say "at least". */
const MAX_MEMBERS = 200_000;
/** Without bsdtar, zips up to this size are read into memory for their central directory. */
const MAX_DIRECT_ZIP_BYTES = 64 * 1024 * 1024;
const LISTING_TIMEOUT_MS = 15_000;

type Member = { path: string; isDir: boolean; size: number };

export async function archiveSummary(file: string, signal?: AbortSignal): Promise<ArchiveSummary> {
  let members: Member[] | null;
  let truncated = false;
  try {
    ({ members, truncated } = await bsdtarMembers(file, signal));
  } catch (error) {
    signal?.throwIfAborted();
    members = await directMembers(file);
    if (!members) throw error;
  }
  return summarize(members, truncated);
}

function summarize(members: readonly Member[], truncated: boolean): ArchiveSummary {
  const top = new Map<string, ArchiveEntry>();
  const folders = new Set<string>();
  let files = 0;
  let totalSize = 0;
  for (const member of members) {
    const parts = member.path
      .replace(/^\.\//, "")
      .split("/")
      .filter((part) => part && part !== ".");
    if (!parts.length) continue;
    // Every ancestor of a member is a folder, listed or not.
    for (let depth = 1; depth < parts.length; depth++) folders.add(parts.slice(0, depth).join("/"));
    if (member.isDir) folders.add(parts.join("/"));
    else {
      files++;
      totalSize += member.size;
    }
    const name = parts[0]!;
    const isDir = member.isDir || parts.length > 1;
    const entry = top.get(name) ?? { name, isDir, size: 0, items: 0 };
    entry.isDir ||= isDir;
    if (!member.isDir) entry.size += member.size;
    if (parts.length > 1) entry.items++;
    top.set(name, entry);
  }
  const entries = [...top.values()].sort(
    (a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name),
  );
  return { entries, files, folders: folders.size, totalSize, truncated };
}

/** `bsdtar -tv` prints `ls -l` lines: mode, links, owner, group, size, date, name. */
const LISTING_LINE = /^(\S)\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(.+)$/;

function bsdtarMembers(
  file: string,
  signal?: AbortSignal,
): Promise<{ members: Member[]; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn("bsdtar", ["-tvf", file], {
      stdio: ["ignore", "pipe", "pipe"],
      // Month names and sizes in the C locale, names in UTF-8.
      env: { ...process.env, LC_ALL: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8" },
      signal,
      timeout: LISTING_TIMEOUT_MS,
    });
    const members: Member[] = [];
    let pending = "";
    let errors = "";
    let truncated = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = LISTING_LINE.exec(line);
        if (!match) continue;
        const [, type, size, name] = match;
        // A link's line ends "name -> target" (symbolic) or "name link to target" (hard).
        const member = type === "l" ? name!.replace(/ -> .*$/, "") : name!;
        members.push({ path: member, isDir: type === "d", size: Number(size) });
        if (members.length >= MAX_MEMBERS) {
          truncated = true;
          child.kill();
          return;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (errors = (errors + chunk).slice(-1000)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (truncated || code === 0) resolve({ members, truncated });
      else reject(new Error(errors.trim() || `bsdtar exited with status ${code}.`));
    });
  });
}

/** Zip by its central directory, or plain gzip as its one member; null for anything else. */
async function directMembers(file: string): Promise<Member[] | null> {
  const stat = await fs.stat(file);
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(4);
    await handle.read(head, 0, 4, 0);
    if (head.readUInt32LE(0) === 0x04034b50 && stat.size <= MAX_DIRECT_ZIP_BYTES) {
      const entries = listZip(await handle.readFile());
      return (
        entries?.map((entry) => ({ path: entry.name, isDir: entry.isDir, size: entry.size })) ??
        null
      );
    }
    if (head[0] === 0x1f && head[1] === 0x8b && stat.size >= 18) {
      // The last four bytes hold the uncompressed size modulo 4 GiB.
      const tail = Buffer.alloc(4);
      await handle.read(tail, 0, 4, stat.size - 4);
      const name = path.basename(file).replace(/\.(gz|tgz)$/i, "") || "uncompressed";
      return [{ path: name, isDir: false, size: tail.readUInt32LE(0) }];
    }
    return null;
  } finally {
    await handle.close();
  }
}
