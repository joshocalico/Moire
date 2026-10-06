import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { SessionBus } from "@moire/dbus";
import type { ImageData } from "@moire/ui";
export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Color = readonly [number, number, number, number];
export type Edit =
  | { kind: "crop"; bounds: Bounds }
  | { kind: "pen"; points: readonly Point[]; color: Color; width: number }
  | { kind: "rectangle"; bounds: Bounds; color: Color; width: number };
export function parseColor(hex: string): Color {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Annotation color must use #RRGGBB.");
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
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
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}
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
export function cropBounds(image: ImageData, bounds: Bounds): Bounds {
  if ([bounds.x, bounds.y, bounds.width, bounds.height].some((value) => !Number.isFinite(value)))
    throw new Error("Crop coordinates must be finite numbers.");
  if (bounds.width <= 0 || bounds.height <= 0)
    throw new Error("Drag a crop region with a positive width and height.");
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(bounds.x))),
    y = Math.max(0, Math.min(image.height - 1, Math.floor(bounds.y))),
    right = Math.min(image.width, Math.ceil(bounds.x + bounds.width)),
    bottom = Math.min(image.height, Math.ceil(bounds.y + bounds.height));
  if (right <= x || bottom <= y)
    throw new Error("Drag a crop region with a positive width and height.");
  return { x, y, width: right - x, height: bottom - y };
}
export function cropImage(image: ImageData, bounds: Bounds): ImageData {
  const box = cropBounds(image, bounds),
    rgba = new Uint8Array(box.width * box.height * 4);
  for (let row = 0; row < box.height; row++)
    rgba.set(
      image.rgba.subarray(
        ((box.y + row) * image.width + box.x) * 4,
        ((box.y + row) * image.width + box.x + box.width) * 4,
      ),
      row * box.width * 4,
    );
  return { rgba, width: box.width, height: box.height };
}
function dot(image: ImageData, point: Point, color: Color, width: number): void {
  const radius = Math.max(0.5, Math.min(32, width / 2)),
    cx = Math.round(point.x),
    cy = Math.round(point.y);
  for (
    let y = Math.max(0, Math.floor(cy - radius));
    y <= Math.min(image.height - 1, Math.ceil(cy + radius));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(cx - radius));
      x <= Math.min(image.width - 1, Math.ceil(cx + radius));
      x++
    )
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        const offset = (y * image.width + x) * 4;
        image.rgba.set(color, offset);
      }
}
function line(image: ImageData, start: Point, end: Point, color: Color, width: number): void {
  const steps = Math.ceil(Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)));
  for (let step = 0; step <= steps; step++) {
    const t = steps ? step / steps : 0;
    dot(
      image,
      { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t },
      color,
      width,
    );
  }
}
export function applyEdits(original: ImageData, edits: readonly Edit[]): ImageData {
  let image: ImageData = { ...original, rgba: new Uint8Array(original.rgba) };
  for (const edit of edits) {
    if (edit.kind === "crop") {
      image = cropImage(image, edit.bounds);
      continue;
    }
    if (edit.kind === "pen") {
      const first = edit.points[0];
      if (first) dot(image, first, edit.color, edit.width);
      for (let i = 1; i < edit.points.length; i++) {
        const start = edit.points[i - 1],
          end = edit.points[i];
        if (start && end) line(image, start, end, edit.color, edit.width);
      }
      continue;
    }
    const b = edit.bounds,
      points = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
        { x: b.x, y: b.y },
      ];
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1],
        end = points[i];
      if (start && end) line(image, start, end, edit.color, edit.width);
    }
  }
  return image;
}
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
