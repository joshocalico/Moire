/**
 * Palette files: GIMP palettes (.gpl, plain text read by GIMP, Inkscape and Krita) and a small
 * JSON format. Failures come back as typed values for the status line, never thrown.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { errorText } from "@moire/app-tools";
import { parseHex, rgbHex, isChannel } from "./color";

export type PaletteFile = {
  name: string;
  colors: Array<{ name: string; hex: string }>;
};
export type PaletteFileFormat = "gpl" | "json";
export const PALETTE_EXTENSIONS: readonly PaletteFileFormat[] = ["gpl", "json"];

export type PaletteFileError =
  | { kind: "unsupported"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "io"; message: string };
export type PaletteFileResult<T> = { ok: true; value: T } | { ok: false; error: PaletteFileError };

class InvalidPalette extends Error {}

export function paletteFormat(file: string): PaletteFileFormat | null {
  const ext = path.extname(file).slice(1).toLowerCase();
  return (PALETTE_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as PaletteFileFormat)
    : null;
}

export function formatGpl(palette: PaletteFile): string {
  const rows = palette.colors.map(({ name, hex }) => {
    const { r, g, b } = parseHex(hex);
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${name}`;
  });
  return ["GIMP Palette", `Name: ${palette.name}`, "Columns: 0", "#", ...rows, ""].join("\n");
}

export function parseGpl(text: string, fallbackName: string): PaletteFile {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "GIMP Palette")
    throw new InvalidPalette("This is not a GIMP palette (the first line must be “GIMP Palette”).");
  let name = fallbackName;
  const colors: PaletteFile["colors"] = [];
  lines.slice(1).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const header = /^(Name|Columns):\s*(.*)$/i.exec(line);
    if (header) {
      if (header[1]!.toLowerCase() === "name" && header[2]!.trim()) name = header[2]!.trim();
      return;
    }
    const color = /^(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    const [r, g, b] = color ? [Number(color[1]), Number(color[2]), Number(color[3])] : [];
    if (!color || ![r, g, b].every((value) => isChannel(value!)))
      throw new InvalidPalette(`Line ${index + 2} is not a color (expected “R G B name”).`);
    const hex = rgbHex({ r: r!, g: g!, b: b! });
    colors.push({ name: color[4]!.trim() || hex, hex });
  });
  return { name, colors };
}

export function formatJsonPalette(palette: PaletteFile): string {
  return JSON.stringify(palette, null, 2) + "\n";
}

/** `{ name, colors: [{ name, hex } | "#hex"] }`; `swatches` is accepted for `colors`. */
export function parseJsonPalette(text: string, fallbackName: string): PaletteFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new InvalidPalette("This JSON file could not be parsed.");
  }
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(data) ? data : (record.colors ?? record.swatches);
  if (!Array.isArray(list)) throw new InvalidPalette("The JSON file has no “colors” list.");
  const colors = list.map((entry: unknown, index) => {
    const item = typeof entry === "string" ? { hex: entry } : (entry as Record<string, unknown>);
    if (typeof item?.hex !== "string")
      throw new InvalidPalette(`Color ${index + 1} has no “hex” value.`);
    let hex: string;
    try {
      hex = rgbHex(parseHex(item.hex));
    } catch {
      throw new InvalidPalette(`Color ${index + 1} (“${item.hex}”) is not a HEX color.`);
    }
    return {
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : hex,
      hex,
    };
  });
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "";
  return { name: name || fallbackName, colors };
}

export async function readPaletteFile(file: string): Promise<PaletteFileResult<PaletteFile>> {
  const format = paletteFormat(file);
  if (!format)
    return {
      ok: false,
      error: {
        kind: "unsupported",
        message: "Choose a .gpl or .json palette file.",
      },
    };
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (cause) {
    return { ok: false, error: { kind: "io", message: errorText(cause) } };
  }
  const fallback = path.basename(file, path.extname(file));
  try {
    const palette = format === "gpl" ? parseGpl(text, fallback) : parseJsonPalette(text, fallback);
    if (!palette.colors.length)
      return {
        ok: false,
        error: { kind: "invalid", message: "The palette file has no colors." },
      };
    return { ok: true, value: palette };
  } catch (cause) {
    if (cause instanceof InvalidPalette)
      return { ok: false, error: { kind: "invalid", message: cause.message } };
    throw cause;
  }
}

/** Writes in the format the extension names; a name without one is saved as .gpl. */
export async function writePaletteFile(
  file: string,
  palette: PaletteFile,
): Promise<PaletteFileResult<string>> {
  const target = path.extname(file) ? file : `${file}.gpl`;
  const format = paletteFormat(target);
  if (!format)
    return {
      ok: false,
      error: {
        kind: "unsupported",
        message: "Save palettes as .gpl or .json.",
      },
    };
  try {
    await fs.writeFile(
      target,
      format === "gpl" ? formatGpl(palette) : formatJsonPalette(palette),
      "utf8",
    );
    return { ok: true, value: target };
  } catch (cause) {
    return { ok: false, error: { kind: "io", message: errorText(cause) } };
  }
}
