import fs from "node:fs/promises";
import path from "node:path";
import { privatePreview, readableFile, runTool, type Preview } from "@moire/app-tools";
import { isImage, sortImages } from "./model";

/** Largest edge decoded; bigger images are scaled down to keep the bitmap in memory bounds. */
const MAX_DECODE_EDGE = 4096;

/**
 * Decode `value` to an RGBA preview, turned clockwise `turns` quarter turns (negative: counter).
 * `fitEdge` scales it down (Lanczos) to fit that many pixels along its long edge, for showing it
 * smaller than its size without the shimmer of nearest-neighbour drawing.
 */
export async function decodeImage(
  value: string,
  turns = 0,
  signal?: AbortSignal,
  fitEdge = MAX_DECODE_EDGE,
): Promise<Preview> {
  const file = await readableFile(value);
  if (!isImage(file))
    throw new Error("Unsupported image format. Open a PNG, JPEG, WebP, GIF, BMP or TIFF image.");
  const edge = Math.max(1, Math.min(MAX_DECODE_EDGE, Math.round(fitEdge)));
  const filters = [
    `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:flags=lanczos`,
  ];
  const quarterTurns = ((turns % 4) + 4) % 4;
  for (let turn = 0; turn < quarterTurns; turn++) filters.push("transpose=clock");
  return privatePreview(async (output) => {
    await runTool(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        filters.join(","),
        "-update",
        "1",
        output,
      ],
      signal,
    );
  });
}

/** The images in `directory`, in the order Files lists them (hidden files left out). */
export async function folderImages(directory: string): Promise<string[]> {
  const names = await fs.readdir(directory);
  return sortImages(
    names
      .filter((name) => !name.startsWith(".") && isImage(name))
      .map((name) => path.join(directory, name)),
  );
}
