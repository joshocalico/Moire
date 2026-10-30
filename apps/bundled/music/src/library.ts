/** Local library metadata is probed at import; original media is never modified. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { localPath, runTool, errorText } from "@moire/app-tools";
import { loadDocument, writeDocument, type StoreCleanup } from "@moire/app-tools/local-store";
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
const MAX_TRACKS = 5000;
type LibraryRecord = { version: 1; tracks: Track[] };
function parseLibrary(value: unknown): LibraryRecord {
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.tracks) ||
    value.tracks.length > MAX_TRACKS
  )
    throw new Error("Music library is invalid. The original library is preserved.");
  const tracks = value.tracks.map(parseTrack);
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length)
    throw new Error("Music library has duplicate track identities.");
  return { version: 1, tracks };
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
    const { value, revision } = loadDocument(this.file, parseLibrary);
    return { tracks: value?.tracks ?? [], revision };
  }
  /** Throws when another window saved first ("Reload before editing"). */
  save(library: Library): Library & { cleanup: StoreCleanup } {
    if (library.tracks.length > MAX_TRACKS)
      throw new Error(`Music supports up to ${MAX_TRACKS} tracks.`);
    const written = writeDocument(
      this.file,
      parseLibrary({ version: 1, tracks: library.tracks }),
      library.revision,
      parseLibrary,
    );
    return { tracks: written.value.tracks, revision: written.revision, cleanup: written.cleanup };
  }
}
/** Extensions a folder import picks up; a directly chosen file may have any extension. */
export const AUDIO_EXTENSIONS: readonly string[] = [
  "mp3",
  "flac",
  "ogg",
  "opus",
  "wav",
  "m4a",
  "m4b",
  "aac",
  "aif",
  "aiff",
  "wma",
  "alac",
];
const audioExtensions = new Set(AUDIO_EXTENSIONS.map((extension) => `.${extension}`));
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
      if (result.length > MAX_TRACKS)
        throw new MusicImportLimitError(`Import supports at most ${MAX_TRACKS} audio files.`);
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
    if (candidates.size > MAX_TRACKS)
      throw new MusicImportLimitError(`Import supports at most ${MAX_TRACKS} audio files.`);
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
