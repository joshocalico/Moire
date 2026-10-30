/** The user's saved palettes, kept in one local-store snapshot with revision checks. */
import os from "node:os";
import path from "node:path";
import { loadSnapshot, writeSnapshot } from "@moire/app-tools/local-store";
import { parseHex, rgbHex } from "./color";

export type Swatch = { id: string; name: string; hex: string };
export type Palette = { id: string; name: string; swatches: Swatch[] };

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
