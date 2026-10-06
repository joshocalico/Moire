import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { localPath, readableFile, runTool } from "@moire/app-tools";
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
    listing = await runTool("bsdtar", ["-tf", file], signal, { utf8Locale: true });
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
  const details = await runTool("bsdtar", ["-tvf", file], signal, { utf8Locale: true });
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
    } else {
      await runTool(
        "bsdtar",
        ["-xkf", archive.file, "--no-same-owner", "--no-same-permissions", "-C", staging],
        signal,
        { utf8Locale: true },
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
export async function createArchive(
  sourceValues: readonly string[],
  outputValue: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!sourceValues.length) throw new Error("Add files or folders to create an archive.");
  const sources = sourceValues.map(localPath),
    output = localPath(outputValue),
    parent = path.dirname(sources[0] ?? "");
  if (!output.endsWith(".tar.gz")) throw new Error("New archives use the .tar.gz format.");
  if (sources.some((file) => path.dirname(file) !== parent))
    throw new Error("Choose files from the same containing folder.");
  for (const file of sources) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() && !stat.isDirectory())
      throw new Error("Archive sources must be regular files or folders.");
    if (output === file || output.startsWith(file + path.sep))
      throw new Error("Save the archive outside the selected source folders.");
  }
  const staging = await fs.mkdtemp(path.join(path.dirname(output), ".moire-archive-")),
    temporary = path.join(staging, "archive.tar.gz");
  try {
    await runTool(
      "bsdtar",
      ["-czf", temporary, "-C", parent, "--", ...sources.map((file) => path.basename(file))],
      signal,
      { utf8Locale: true },
    );
    await listArchive(temporary, signal);
    if (signal?.aborted) throw new Error("Archive creation cancelled.");
    await fs.link(temporary, output);
    return output;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
