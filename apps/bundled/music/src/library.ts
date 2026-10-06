/** Local library metadata is probed at import; original media is never modified. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { localPath, runTool, errorText } from "@moire/app-tools";
export type Track = {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  number: number;
  duration: number;
  addedAt: number;
  artwork?: string;
};
export type Library = { tracks: Track[]; revision: string | null };
export type Album = {
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: Track[];
  artwork?: string;
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const tag = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 1000) : "");
export function parseTrack(value: unknown): Track {
  if (
    !object(value) ||
    typeof value.path !== "string" ||
    !path.isAbsolute(value.path) ||
    value.id !== hash(value.path) ||
    typeof value.title !== "string" ||
    typeof value.artist !== "string" ||
    typeof value.album !== "string" ||
    typeof value.year !== "string" ||
    typeof value.number !== "number" ||
    !Number.isFinite(value.number) ||
    value.number < 0 ||
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration < 0 ||
    typeof value.addedAt !== "number" ||
    !Number.isFinite(value.addedAt) ||
    (value.artwork !== undefined &&
      (typeof value.artwork !== "string" || !path.isAbsolute(value.artwork)))
  )
    throw new Error("Music library contains an invalid track. The original library is preserved.");
  return {
    id: value.id,
    path: value.path,
    title: value.title,
    artist: value.artist,
    album: value.album,
    year: value.year,
    number: value.number,
    duration: value.duration,
    addedAt: value.addedAt,
    ...(typeof value.artwork === "string" ? { artwork: value.artwork } : {}),
  };
}
export class MusicLibraryStore {
  readonly directory: string;
  readonly file: string;
  constructor(
    directory = path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"),
      "moire/music",
    ),
  ) {
    this.directory = directory;
    this.file = path.join(directory, "library.json");
  }
  load(): Library {
    if (!fs.existsSync(this.file)) return { tracks: [], revision: null };
    if (fs.statSync(this.file).size > 16 * 1024 * 1024)
      throw new Error("Music library is too large to open.");
    const content = fs.readFileSync(this.file, "utf8"),
      value: unknown = JSON.parse(content);
    if (
      !object(value) ||
      value.version !== 1 ||
      !Array.isArray(value.tracks) ||
      value.tracks.length > 5000
    )
      throw new Error("Music library is invalid. The original library is preserved.");
    const tracks = value.tracks.map(parseTrack);
    if (new Set(tracks.map((track) => track.id)).size !== tracks.length)
      throw new Error("Music library has duplicate track identities.");
    return { tracks, revision: hash(content) };
  }
  save(library: Library): Library {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, ".write-lock");
    // A crashed writer can leave a lock; a live writer is never overridden.
    if (fs.existsSync(lock)) {
      const owner = fs.readFileSync(lock, "utf8"),
        pid = Number(owner);
      let stale = false;
      if (/^\d+$/.test(owner) && Number.isSafeInteger(pid) && pid > 0)
        try {
          process.kill(pid, 0);
        } catch (error) {
          stale = error instanceof Error && "code" in error && error.code === "ESRCH";
        }
      if (!/^\d+$/.test(owner)) stale = Date.now() - fs.statSync(lock).mtimeMs > 30000;
      if (stale && fs.readFileSync(lock, "utf8") === owner) fs.unlinkSync(lock);
    }
    let lockFd: number;
    try {
      lockFd = fs.openSync(lock, "wx", 0o600);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw new Error("Another Music window is saving. Try again shortly.");
      throw error;
    }
    const temporary = path.join(this.directory, `.library-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(lockFd, String(process.pid));
      if (this.load().revision !== library.revision)
        throw new Error("Music changed in another window. Reload before editing.");
      const tracks = library.tracks.map(parseTrack);
      if (tracks.length > 5000 || new Set(tracks.map((track) => track.id)).size !== tracks.length)
        throw new Error("Music supports up to 5000 distinct tracks.");
      const content = JSON.stringify({ version: 1, tracks }, null, 2) + "\n";
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(fd, content);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, this.file);
      return { tracks, revision: hash(content) };
    } finally {
      fs.closeSync(lockFd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      fs.unlinkSync(lock);
    }
  }
}
const audioExtensions = new Set([
  ".mp3",
  ".flac",
  ".ogg",
  ".opus",
  ".wav",
  ".m4a",
  ".m4b",
  ".aac",
  ".aif",
  ".aiff",
  ".wma",
  ".alac",
]);
class MusicImportLimitError extends Error {}
async function audioFiles(value: string, signal: AbortSignal): Promise<string[]> {
  const root = await fsp.realpath(localPath(value)),
    result: string[] = [];
  const walk = async (file: string, depth: number) => {
    signal.throwIfAborted();
    const stat = await fsp.lstat(file);
    if (stat.isSymbolicLink()) return; // No cycles or traversal outside the chosen tree.
    if (stat.isFile()) {
      if (depth === 0 || audioExtensions.has(path.extname(file).toLowerCase())) result.push(file);
      if (result.length > 5000)
        throw new MusicImportLimitError("Import supports at most 5000 audio files.");
    } else if (stat.isDirectory()) {
      if (depth > 16) throw new Error("The music folder is nested more than 16 levels deep.");
      for (const entry of (await fsp.readdir(file)).sort())
        await walk(path.join(file, entry), depth + 1);
    }
  };
  await walk(root, 0);
  if (!result.length) throw new Error("No supported audio files were found in that location.");
  return result;
}
export async function probeTrack(
  file: string,
  directory: string,
  signal?: AbortSignal,
): Promise<Track> {
  const resolved = await fsp.realpath(file),
    stat = await fsp.stat(resolved);
  const raw: unknown = JSON.parse(
    await runTool(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe,crypto,data",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        resolved,
      ],
      signal,
    ),
  );
  if (
    !object(raw) ||
    !Array.isArray(raw.streams) ||
    !raw.streams.some(
      (stream) =>
        object(stream) &&
        stream.codec_type === "audio" &&
        Number(stream.sample_rate) > 0 &&
        Number(stream.channels) > 0,
    )
  )
    throw new Error("This file does not contain an audio track.");
  const format = object(raw.format) ? raw.format : {};
  const audio = raw.streams.find((stream) => object(stream) && stream.codec_type === "audio");
  const tags = {
    ...(object(audio) && object(audio.tags) ? audio.tags : {}),
    ...(object(format.tags) ? format.tags : {}),
  };
  const lowercase = Object.fromEntries(
    Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const seconds = Number(format.duration ?? (object(audio) ? audio.duration : 0));
  const trackNumber = parseInt(tag(lowercase.track), 10);
  let artwork: string | undefined;
  for (const name of ["cover.png", "folder.png"]) {
    const candidate = path.join(path.dirname(resolved), name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      artwork = candidate;
      break;
    }
  }
  const cover = raw.streams.find(
    (stream) =>
      object(stream) && object(stream.disposition) && stream.disposition.attached_pic === 1,
  );
  if (
    !artwork &&
    object(cover) &&
    typeof cover.index === "number" &&
    Number.isInteger(cover.index)
  ) {
    const cache = path.join(directory, "artwork");
    await fsp.mkdir(cache, { recursive: true, mode: 0o700 });
    const image = path.join(cache, `${hash(`${resolved}:${stat.mtimeMs}:${stat.size}`)}.png`);
    const temporary = path.join(cache, `${randomUUID()}.png`);
    try {
      if (!fs.existsSync(image)) {
        await runTool(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            resolved,
            "-map",
            `0:${cover.index}`,
            "-frames:v",
            "1",
            "-vf",
            "scale=512:512:force_original_aspect_ratio=decrease",
            "-update",
            "1",
            temporary,
          ],
          signal,
        );
        await fsp.rename(temporary, image);
      }
      artwork = image;
    } catch (error) {
      if (signal?.aborted)
        throw error; /* Audio remains useful without a decodable embedded cover. */
    } finally {
      await fsp.rm(temporary, { force: true });
    }
  }
  return {
    id: hash(resolved),
    path: resolved,
    title: tag(lowercase.title) || path.basename(resolved, path.extname(resolved)),
    artist: tag(lowercase.artist) || tag(lowercase.album_artist),
    album: tag(lowercase.album),
    year: tag(lowercase.date) || tag(lowercase.year),
    number: Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber : 0,
    duration: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    addedAt: Date.now(),
    ...(artwork ? { artwork } : {}),
  };
}
export async function importMusic(
  values: readonly string[],
  store: MusicLibraryStore,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<{ library: Library; warnings: string[]; imported: Track[] }> {
  const candidates = new Set<string>(),
    warnings: string[] = [];
  for (const value of values) {
    signal.throwIfAborted();
    try {
      for (const file of await audioFiles(value, signal)) candidates.add(file);
    } catch (error) {
      if (signal.aborted || error instanceof MusicImportLimitError) throw error;
      warnings.push(`${path.basename(value)}: ${errorText(error)}`);
    }
    if (candidates.size > 5000)
      throw new MusicImportLimitError("Import supports at most 5000 audio files.");
  }
  const files = [...candidates],
    imported: Track[] = [];
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    try {
      imported.push(await probeTrack(file, store.directory, signal));
    } catch (error) {
      if (signal.aborted) throw error;
      warnings.push(`${path.basename(file)}: ${errorText(error)}`);
    }
    onProgress?.(index + 1, files.length);
  }
  if (!imported.length) throw new Error(warnings[0] ?? "No readable audio tracks were found.");
  signal.throwIfAborted();
  const actual = store.load(),
    merged = new Map(actual.tracks.map((track) => [track.id, track]));
  for (const track of imported)
    merged.set(track.id, { ...track, addedAt: merged.get(track.id)?.addedAt ?? track.addedAt });
  return { library: store.save({ ...actual, tracks: [...merged.values()] }), warnings, imported };
}
export function albumsFor(tracks: readonly Track[]): Album[] {
  const albums = new Map<string, Album>();
  for (const track of tracks) {
    const id = JSON.stringify([track.artist, track.album || path.dirname(track.path)]);
    let album = albums.get(id);
    if (!album) {
      album = {
        id,
        title: track.album || path.basename(path.dirname(track.path)),
        artist: track.artist,
        year: track.year,
        tracks: [],
        artwork: track.artwork,
      };
      albums.set(id, album);
    }
    album.tracks.push(track);
    if (!album.artwork && track.artwork) album.artwork = track.artwork;
  }
  return [...albums.values()]
    .map((album) => ({
      ...album,
      tracks: album.tracks.sort(
        (a, b) => (a.number || Infinity) - (b.number || Infinity) || a.title.localeCompare(b.title),
      ),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
export const filterTracks = (tracks: readonly Track[], query: string): Track[] => {
  const needle = query.trim().toLocaleLowerCase();
  return tracks.filter((track) =>
    `${track.title}\n${track.artist}\n${track.album}`.toLocaleLowerCase().includes(needle),
  );
};
