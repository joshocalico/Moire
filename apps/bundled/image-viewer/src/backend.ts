import path from "node:path";
import { privatePreview, readableFile, runTool, type Preview } from "@moire/app-tools";
export async function decodeImage(
  value: string,
  turns = 0,
  signal?: AbortSignal,
): Promise<Preview> {
  const file = await readableFile(value);
  if (
    ![".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"].includes(
      path.extname(file).toLowerCase(),
    )
  )
    throw new Error("Unsupported image format. Open a PNG, JPEG, WebP, GIF, BMP or TIFF image.");
  const filters = ["scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease"];
  for (let turn = 0; turn < ((turns % 4) + 4) % 4; turn++) filters.push("transpose=clock");
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
