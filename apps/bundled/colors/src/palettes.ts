import os from "node:os";
import path from "node:path";
import { loadSnapshot, writeSnapshot } from "@moire/app-tools/local-store";
export type RGB = { r: number; g: number; b: number };
export type Swatch = { id: string; name: string; hex: string };
export type Palette = { id: string; name: string; swatches: Swatch[] };
export function parseHex(value: string): RGB {
  const hex = value.trim().replace(/^#/, "");
  const expanded = /^[0-9a-f]{3}$/i.test(hex)
    ? hex
        .split("")
        .map((char) => char + char)
        .join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) throw new Error("Use a HEX color such as #BF5AF2 or #F80.");
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}
export function rgbHex(rgb: RGB): string {
  const values = [rgb.r, rgb.g, rgb.b];
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255))
    throw new Error("RGB channels must be whole numbers from 0 to 255.");
  return (
    "#" +
    values
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}
export function colorFill(rgb: RGB): number {
  return (0xff000000 | (rgb.r << 16) | (rgb.g << 8) | rgb.b) >>> 0;
}
export function contrastText(rgb: RGB): number {
  const linear = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b) > 0.179
    ? 0xff000000
    : 0xffffffff;
}
function parseSwatch(value: unknown): Swatch {
  if (
    typeof value !== "object" ||
    !value ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !value.id ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("hex" in value) ||
    typeof value.hex !== "string"
  )
    throw new Error("Palette contains an invalid color.");
  return { id: value.id, name: value.name, hex: rgbHex(parseHex(value.hex)) };
}
function parsePalettes(data: unknown): Palette[] {
  if (!Array.isArray(data)) throw new Error("Palette file is invalid.");
  const ids = new Set<string>();
  return data.map((item: unknown) => {
    if (
      typeof item !== "object" ||
      !item ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !item.id ||
      !("name" in item) ||
      typeof item.name !== "string" ||
      !("swatches" in item) ||
      !Array.isArray(item.swatches)
    )
      throw new Error("Palette file contains an invalid palette.");
    if (ids.has(item.id)) throw new Error("Palette file contains duplicate palette IDs.");
    ids.add(item.id);
    const swatches = item.swatches.map(parseSwatch);
    if (new Set(swatches.map((swatch) => swatch.id)).size !== swatches.length)
      throw new Error("Palette contains duplicate color IDs.");
    return { id: item.id, name: item.name, swatches };
  });
}
export class PaletteStore {
  constructor(
    readonly file = path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"),
      "moire/colors/palettes.json",
    ),
  ) {}
  load() {
    return loadSnapshot(this.file, parsePalettes);
  }
  read(): Palette[] {
    return [...this.load().items];
  }
  write(palettes: readonly Palette[], expectedRevision: string | null) {
    return writeSnapshot(this.file, palettes, expectedRevision, parsePalettes);
  }
}
