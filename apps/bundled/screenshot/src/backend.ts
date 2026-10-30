/** Screenshot I/O: compositor capture, PNG files and the default save location. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { SessionBus } from "@moire/dbus";
import type { ImageData } from "@moire/ui";

/** Where screenshots go unless the person picks another folder: ~/Pictures/Screenshots. */
export function defaultSaveDirectory(): string {
  return path.join(os.homedir(), "Pictures", "Screenshots");
}
export async function readPNG(file: string): Promise<ImageData> {
  const bytes = await fs.readFile(file);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Choose a PNG image.");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 32 * 1024 * 1024)
    throw new Error("Screenshot is too large to edit.");
  const png = PNG.sync.read(bytes);
  return {
    width: png.width,
    height: png.height,
    rgba: new Uint8Array(png.data),
  };
}
/** The primary display, through the compositor; the capture file is removed after reading. */
export async function captureDesktop(): Promise<ImageData> {
  let bus: SessionBus | null = null;
  let file: string | null = null;
  try {
    bus = await SessionBus.connect();
    const reply = await bus.call({
      destination: "org.moire.Display1",
      path: "/org/moire/Display1",
      interface: "org.moire.Display1",
      member: "CaptureScreenshot",
    });
    const result = reply.body?.[0];
    if (typeof result !== "string" || !path.isAbsolute(result))
      throw new Error("The compositor did not return a capture file.");
    file = result;
    return await readPNG(file);
  } catch (error) {
    throw new Error(
      `Desktop capture is unavailable: ${error instanceof Error ? error.message : String(error)}. You can open a PNG to edit it.`,
    );
  } finally {
    bus?.close();
    if (
      file &&
      path.basename(file) === "capture.png" &&
      path.basename(path.dirname(file)).startsWith("moire-capture-")
    )
      await fs.rm(path.dirname(file), { recursive: true, force: true });
  }
}
/** Write a PNG atomically; without `overwrite` an existing file fails with EEXIST. */
export async function savePNG(image: ImageData, file: string, overwrite = false): Promise<void> {
  const target = path.resolve(file);
  if (path.extname(target).toLowerCase() !== ".png")
    throw new Error("Save the image with a .png extension.");
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.rgba);
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const temp = path.join(directory, `.moire-screenshot-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, PNG.sync.write(png), { mode: 0o600, flag: "wx" });
    if (overwrite) await fs.rename(temp, target);
    else await fs.link(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
