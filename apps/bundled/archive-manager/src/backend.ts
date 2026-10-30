import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { spawn } from "node:child_process";
import { localPath, readableFile, runTool } from "@moire/app-tools";
import { applyChange, writableFormat, type Entry, type WritableFormat } from "./model";

/** Called with how many archive members have been written so far. */
export type Progress = (done: number) => void;

/**
 * Run bsdtar verbosely so each member it writes is reported as progress. Its other output is
 * kept as the error message. Aborting kills the process.
 */
async function bsdtarWithProgress(
  args: readonly string[],
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<void> {
  signal?.throwIfAborted();
  const child = spawn("bsdtar", ["-v", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      LC_ALL: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8",
    },
  });
  const abort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });
  let done = 0;
  let pending = "";
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      // bsdtar -v reports each member as "a name" (create) or "x name" (extract).
      if (/^[ax] /.test(line)) onProgress?.(++done);
      else if (line.trim()) errors = (errors + line + "\n").slice(-2000);
    }
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    signal?.throwIfAborted();
    if (code !== 0) throw new Error(errors.trim() || `bsdtar exited with status ${code}.`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new Error("bsdtar is unavailable. Install this app's backend to continue.");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export function safeMember(value: string): string {
  const normalized = value.replace(/\/$/, "");
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").includes("..")
  )
    throw new Error(`Unsafe archive path: ${value}`);
  if (!normalized || normalized === ".") return ".";
  return path.posix.normalize(normalized);
}
export const MAX_GZIP_BYTES = 64 * 1024 * 1024;
type ArchiveListing = { file: string } & (
  | { kind: "archive"; entries: string[] }
  | { kind: "gzip"; entries: [string] }
);
async function gzipHeader(file: string): Promise<boolean> {
  const handle = await fs.open(file, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return (
      bytesRead === 4 &&
      header[0] === 0x1f &&
      header[1] === 0x8b &&
      header[2] === 8 &&
      (header[3]! & 0xe0) === 0
    );
  } finally {
    await handle.close();
  }
}
function gzipLimit() {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_GZIP_BYTES)
        callback(new Error("Plain gzip output exceeds this app's 64 MiB limit."));
      else callback(null, chunk);
    },
  });
}
async function gzipContainsTar(file: string, signal?: AbortSignal): Promise<boolean> {
  let prefix = Buffer.alloc(0);
  await pipeline(
    createReadStream(file),
    createGunzip(),
    gzipLimit(),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (prefix.length < 512)
          prefix = Buffer.concat([prefix, chunk.subarray(0, 512 - prefix.length)]);
        callback();
      },
    }),
    { signal },
  );
  // A failed tar listing must not turn a recognisable damaged tar into a plain file.
  const checksum = prefix.subarray(148, 156).toString("ascii").replace(/\0/g, "").trim();
  const tarHeader =
    prefix.subarray(257, 262).toString("ascii") === "ustar" ||
    /^0?[0-7]{6,}$/.test(checksum) ||
    (prefix.length === 512 && prefix.every((byte) => byte === 0));
  return tarHeader || /\.(tar\.gz|tgz)$/i.test(file);
}
function plainGzipListing(file: string): Extract<ArchiveListing, { kind: "gzip" }> {
  const basename = path.basename(file).replace(/\.gz$/i, "");
  const name = !basename || basename === "." || basename === ".." ? "uncompressed" : basename;
  return { file, entries: [safeMember(name)], kind: "gzip" };
}
export async function listArchive(value: string, signal?: AbortSignal): Promise<ArchiveListing> {
  const file = await readableFile(value);
  let listing: string;
  try {
    listing = await runTool("bsdtar", ["-tf", file], signal, {
      utf8Locale: true,
    });
  } catch (error) {
    if (signal?.aborted || !(await gzipHeader(file))) throw error;
    if (await gzipContainsTar(file, signal))
      throw new Error("This gzip stream contains a damaged or unsupported tar archive.");
    return plainGzipListing(file);
  }
  const entries = listing.split("\n").filter(Boolean);
  // libarchive recognises an empty gzip stream as an empty archive. Preserve
  // the actual zero-byte file, while a real empty tar retains archive semantics.
  if (!entries.length && (await gzipHeader(file)) && !(await gzipContainsTar(file, signal)))
    return plainGzipListing(file);
  const seen = new Set<string>();
  for (const entry of entries) {
    const safe = safeMember(entry);
    if (seen.has(safe)) throw new Error(`Duplicate archive path: ${entry}`);
    seen.add(safe);
  }
  const details = await runTool("bsdtar", ["-tvf", file], signal, {
    utf8Locale: true,
  });
  for (const line of details.split("\n").filter(Boolean))
    if (!["-", "d"].includes(line[0] ?? ""))
      throw new Error(
        "Archives containing links or special files cannot be extracted safely by this app.",
      );
  if (entries.length > 100000) throw new Error("This archive contains too many entries.");
  return { file, entries, kind: "archive" };
}
async function publishExtraction(staging: string, destination: string, signal?: AbortSignal) {
  try {
    await fs.lstat(destination);
    throw Object.assign(new Error("That output already exists. Choose a new folder."), {
      code: "EEXIST",
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const identity = await fs.lstat(staging);
  if (signal?.aborted) throw new Error("Extraction cancelled.");
  try {
    // GNU mv uses atomic no-replace publication, including existing empty directories.
    await runTool(
      process.platform === "darwin" ? "gmv" : "mv",
      ["--no-copy", "--update=none", "--no-target-directory", "--", staging, destination],
      signal,
    );
  } catch (error) {
    const published = await fs.lstat(destination).catch(() => null);
    if (published?.dev === identity.dev && published.ino === identity.ino)
      throw new Error(
        `Extraction was published at ${destination}, but its launcher reported an error.`,
        { cause: error },
      );
    throw error;
  }
  const published = await fs.lstat(destination);
  if (published.dev !== identity.dev || published.ino !== identity.ino)
    throw Object.assign(
      new Error("That output already exists or changed during publication. Choose a new folder."),
      { code: "EEXIST" },
    );
}
export async function extractArchive(
  value: string,
  destinationValue: string,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<string> {
  const archive = await listArchive(value, signal),
    destination = localPath(destinationValue);
  const parent = path.dirname(destination);
  if (!(await fs.stat(parent)).isDirectory())
    throw new Error("Choose an existing parent folder and a new extraction folder name.");
  const staging = await fs.mkdtemp(path.join(parent, ".moire-extract-"));
  const stagingIdentity = await fs.lstat(staging);
  try {
    if (archive.kind === "gzip") {
      const output = path.join(staging, archive.entries[0]);
      await pipeline(
        createReadStream(archive.file),
        createGunzip(),
        gzipLimit(),
        createWriteStream(output, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      onProgress?.(1);
    } else {
      await bsdtarWithProgress(
        ["-xkf", archive.file, "--no-same-owner", "--no-same-permissions", "-C", staging],
        signal,
        onProgress,
      );
    }
    const validate = async (directory: string): Promise<void> => {
      for (const name of await fs.readdir(directory)) {
        const file = path.join(directory, name),
          stat = await fs.lstat(file);
        if (stat.isDirectory()) {
          // This is a private extraction tree. Retain access while publishing
          // it so a read-only directory in an archive cannot strand staging.
          await fs.chmod(file, stat.mode | 0o700);
          await validate(file);
        } else if (!stat.isFile())
          throw new Error("Only regular files and directories can be extracted.");
      }
    };
    await validate(staging);
    if (signal?.aborted) throw new Error("Extraction cancelled.");
    await publishExtraction(staging, destination, signal);
    return destination;
  } finally {
    let current;
    try {
      current = await fs.lstat(staging);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (current && (current.dev !== stagingIdentity.dev || current.ino !== stagingIdentity.ino))
      throw new Error("Private extraction staging changed; it was left untouched.");
    const writable = async (directory: string): Promise<void> => {
      await fs.chmod(directory, 0o700);
      for (const name of await fs.readdir(directory)) {
        const file = path.join(directory, name);
        if ((await fs.lstat(file)).isDirectory()) await writable(file);
      }
    };
    if (current) {
      await writable(staging);
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
/** Make a private tree removable even when it holds read-only folders. */
async function makeWritable(directory: string): Promise<void> {
  await fs.chmod(directory, 0o700);
  for (const name of await fs.readdir(directory)) {
    const file = path.join(directory, name);
    if ((await fs.lstat(file)).isDirectory()) await makeWritable(file);
  }
}

async function countEntries(directory: string): Promise<number> {
  let count = 0;
  for (const name of await fs.readdir(directory)) {
    count++;
    const file = path.join(directory, name);
    if ((await fs.lstat(file)).isDirectory()) count += await countEntries(file);
  }
  return count;
}

/** bsdtar options that write the format an output name asks for. */
function formatArguments(format: WritableFormat): string[] {
  return format === "zip" ? ["--format", "zip"] : format === "tar.gz" ? ["-z"] : [];
}

/**
 * Write an archive holding `entries`: members of `original` (extracted privately first), files
 * and folders from disk, and new empty folders. The archive is built and checked beside `output`
 * before it appears there. A new output is never overwritten; with `replace`, the existing
 * archive is replaced atomically and kept as a hidden backup until the new one is in place.
 */
export async function writeArchive(options: {
  original: string | null;
  entries: readonly Entry[];
  output: string;
  replace?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<string> {
  const { entries, signal } = options;
  const output = localPath(options.output);
  const format = writableFormat(output);
  if (!format) throw new Error("Save archives as .tar.gz, .tgz, .tar or .zip.");
  for (const entry of entries)
    if (entry.origin.kind === "source") {
      const source = entry.origin.path;
      const stat = await fs.lstat(source);
      if (!stat.isFile() && !stat.isDirectory())
        throw new Error("Archive sources must be regular files or folders.");
      if (output === source || output.startsWith(source + path.sep))
        throw new Error("Save the archive outside the folders it contains.");
    }
  const work = await fs.mkdtemp(path.join(path.dirname(output), ".moire-archive-"));
  try {
    const extracted = path.join(work, "original");
    if (options.original && entries.some((entry) => entry.origin.kind === "member"))
      await extractArchive(options.original, extracted, signal);
    const build = path.join(work, "build");
    await fs.mkdir(build);
    for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
      signal?.throwIfAborted();
      const target = path.join(build, ...safeMember(entry.path).split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (entry.origin.kind === "source")
        await fs.cp(entry.origin.path, target, {
          recursive: true,
          errorOnExist: true,
        });
      else if (entry.folder) await fs.mkdir(target, { recursive: true });
      else if (entry.origin.kind === "member")
        await fs.copyFile(path.join(extracted, ...entry.origin.member.split("/")), target);
    }
    const total = await countEntries(build);
    const names = (await fs.readdir(build)).map((name) =>
      name.startsWith("-") ? `./${name}` : name,
    );
    const temporary = path.join(work, `archive.${format}`);
    const empty = path.join(work, "no-members");
    await fs.writeFile(empty, "");
    await bsdtarWithProgress(
      [
        "-cf",
        temporary,
        ...formatArguments(format),
        "-C",
        build,
        ...(names.length ? names : ["-T", empty]),
      ],
      signal,
      (done) => options.onProgress?.(done, total),
    );
    await listArchive(temporary, signal);
    signal?.throwIfAborted();
    if (!options.replace) await fs.link(temporary, output);
    else {
      const backup = path.join(path.dirname(output), `.${path.basename(output)}.moire-backup`);
      await fs.rm(backup, { force: true });
      await fs.link(output, backup);
      await fs.rename(temporary, output);
      await fs.rm(backup, { force: true });
    }
    return output;
  } finally {
    await makeWritable(work).catch(() => {});
    await fs.rm(work, { recursive: true, force: true });
  }
}

/** A new archive holding these files and folders at its top level. */
export async function createArchive(
  sourceValues: readonly string[],
  outputValue: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!sourceValues.length) throw new Error("Add files or folders to create an archive.");
  let entries: Entry[] = [];
  for (const source of sourceValues.map(localPath))
    entries = applyChange(entries, {
      kind: "add",
      parent: "",
      source,
      folder: (await fs.stat(source)).isDirectory(),
    });
  return writeArchive({ original: null, entries, output: outputValue, signal });
}
