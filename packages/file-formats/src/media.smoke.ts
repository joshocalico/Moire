/**
 * Media reader smoke: committed fixtures (made with ffmpeg, lame and a hand-built Opus picture)
 * against expected tags, and against ffprobe's duration and streams when ffprobe is installed.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readMediaInfo, type MediaInfo } from "./media";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const TAGGED = {
  title: "Sine_Title",
  artist: "Moire_Band",
  album: "Fixture_Album",
  year: "2024",
  track: "3",
  genre: "Ambient",
};
const JPEG = [0xff, 0xd8];
const PNG = [0x89, 0x50];

type Expected = Partial<Omit<MediaInfo, "picture" | "audio" | "video">> & {
  picture?: readonly number[];
  codec?: string;
  video?: { width: number; height: number };
};

const EXPECTED: Record<string, Expected> = {
  "media-cbr.mp3": { format: "mp3", ...TAGGED, picture: JPEG, codec: "mp3" },
  "media-vbr24.mp3": { format: "mp3", title: "Ünïcødé ☃", artist: "Ärtist", year: "2021" },
  "media-utf16.mp3": { format: "mp3", title: "Ünïcødé ☃", artist: "Moire Band" },
  "media-id3v1.mp3": {
    format: "mp3",
    title: "Lame Title",
    artist: "Lame Artist",
    album: "Lame Album",
    year: "1999",
    track: "7",
  },
  "media.flac": { format: "flac", ...TAGGED, picture: PNG, codec: "flac" },
  "media.ogg": { format: "ogg", ...TAGGED, codec: "vorbis" },
  "media.opus": { format: "opus", ...TAGGED, picture: PNG, codec: "opus" },
  "media.wav": { format: "wav", title: "Wave_Title", artist: "Wave_Artist", codec: "pcm" },
  "media.m4a": { format: "mp4", ...TAGGED, picture: JPEG, codec: "aac" },
  "media.mp4": { format: "mp4", title: "Clip", codec: "aac", video: { width: 64, height: 48 } },
  "media-moov-end.mov": { format: "mp4", video: { width: 64, height: 48 } },
  "media.webm": { format: "matroska", title: "Webm_Title", video: { width: 64, height: 48 } },
};

async function ffprobe(file: string): Promise<{ duration: number; streams: string[] } | null> {
  try {
    const { stdout } = await promisify(execFile)(
      "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
      { timeout: 10_000 },
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; disposition?: { attached_pic?: number } }>;
    };
    return {
      duration: Number(parsed.format?.duration),
      streams: (parsed.streams ?? [])
        .filter((stream) => stream.disposition?.attached_pic !== 1)
        .map((stream) => stream.codec_type ?? ""),
    };
  } catch {
    return null;
  }
}

let probed = 0;
for (const [name, expected] of Object.entries(EXPECTED)) {
  const file = path.join(fixtures, name);
  const info = await readMediaInfo(file);
  const { picture, codec, video, ...fields } = expected;
  for (const [key, value] of Object.entries(fields))
    assert.equal(info[key as keyof MediaInfo], value, `${name}: ${key}`);
  if (picture) assert.deepEqual([...info.picture!.data.subarray(0, 2)], picture, `${name}: art`);
  else assert.equal(info.picture, null, `${name}: no art`);
  if (codec) assert.equal(info.audio?.codec, codec, `${name}: codec`);
  if (video) assert.deepEqual({ width: info.video?.width, height: info.video?.height }, video);
  assert.ok(info.duration && info.duration > 0.4, `${name}: duration`);
  assert.ok(info.bitrate && info.bitrate > 0, `${name}: bitrate`);
  const reference = await ffprobe(file);
  if (reference) {
    probed++;
    const tolerance = Math.max(0.08, reference.duration * 0.03);
    assert.ok(
      Math.abs(info.duration - reference.duration) <= tolerance,
      `${name}: duration ${info.duration} vs ffprobe ${reference.duration}`,
    );
    assert.equal(!!info.video, reference.streams.includes("video"), `${name}: video stream`);
    if (info.format !== "matroska")
      assert.equal(!!info.audio, reference.streams.includes("audio"), `${name}: audio stream`);
  }
}

// Not media, truncated media and cancellation.
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "moire-media-"));
try {
  assert.equal((await readMediaInfo(path.join(fixtures, "media-cover.png"))).format, "unknown");
  const empty = path.join(scratch, "empty.mp3");
  await fs.writeFile(empty, "");
  assert.equal((await readMediaInfo(empty)).format, "unknown");
  for (const name of ["media-cbr.mp3", "media.flac", "media.opus", "media.m4a", "media.webm"]) {
    const bytes = await fs.readFile(path.join(fixtures, name));
    const cut = path.join(scratch, name);
    for (const length of [12, 100, Math.floor(bytes.length / 3)]) {
      await fs.writeFile(cut, bytes.subarray(0, length));
      await readMediaInfo(cut); // must not throw on a damaged file
    }
  }
  await assert.rejects(readMediaInfo(path.join(scratch, "missing.mp3")), { code: "ENOENT" });
  await assert.rejects(
    readMediaInfo(path.join(fixtures, "media.flac"), AbortSignal.abort()),
    (error: Error) => error.name === "AbortError",
  );
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}

console.log(
  `[file-formats] media: ${Object.keys(EXPECTED).length} fixtures passed` +
    (probed ? `, ${probed} matched ffprobe` : ", ffprobe absent (tags only)"),
);
