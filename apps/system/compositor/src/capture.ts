import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

export function screenshotPng(frame: {
  width: number;
  height: number;
  pixels: Uint8Array;
}): Buffer {
  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width < 1 ||
    frame.height < 1 ||
    frame.width * frame.height > 16_777_216 ||
    frame.pixels.length !== frame.width * frame.height * 4
  )
    throw new Error("Invalid display capture dimensions");
  const rgba = Buffer.alloc(frame.pixels.length);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = frame.pixels[offset + 2]!;
    rgba[offset + 1] = frame.pixels[offset + 1]!;
    rgba[offset + 2] = frame.pixels[offset]!;
    rgba[offset + 3] = 255;
  }
  const image = new PNG({ width: frame.width, height: frame.height });
  image.data = rgba;
  return PNG.sync.write(image);
}

/** Private capture files belong to the requesting app after delivery. */
export async function writeScreenshot(
  frame: Parameters<typeof screenshotPng>[0],
  runtime: string,
): Promise<string> {
  const png = screenshotPng(frame);
  const directory = await fs.mkdtemp(path.join(runtime, "moire-capture-"));
  await fs.chmod(directory, 0o700);
  const file = path.join(directory, "capture.png");
  try {
    await fs.writeFile(file, png, { mode: 0o600, flag: "wx" });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
  return file;
}
