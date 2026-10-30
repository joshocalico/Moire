/** Installing a font for the person: a copy in their fonts folder and a font cache refresh. */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readableFile } from "@moire/app-tools";
import { isFontFile } from "./model";

export type InstallResult = {
  /** Where the font now lives. */
  path: string;
  /** False when that exact font was already installed. */
  copied: boolean;
  /** Whether fontconfig's cache was refreshed, so other apps see the font straight away. */
  cache: { kind: "refreshed" } | { kind: "unavailable" } | { kind: "failed"; message: string };
};

/** The person's fonts folder (fontconfig reads it): $XDG_DATA_HOME/fonts, ~/.local/share/fonts. */
export function fontsFolder(): string {
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(data, "fonts");
}

/** Where `file` is installed, when an identical copy already is; otherwise null. */
export async function installedCopy(file: string): Promise<string | null> {
  const target = path.join(fontsFolder(), path.basename(file));
  if (path.resolve(file) === target) return target;
  try {
    const [installed, source] = await Promise.all([fs.readFile(target), fs.readFile(file)]);
    return installed.equals(source) ? target : null;
  } catch {
    return null;
  }
}

export async function installFont(value: string): Promise<InstallResult> {
  const file = await readableFile(value);
  if (!isFontFile(file)) throw new Error("Only TrueType, OpenType and collection fonts install.");
  const existing = await installedCopy(file);
  const folder = fontsFolder();
  const target = path.join(folder, path.basename(file));
  if (!existing) {
    await fs.mkdir(folder, { recursive: true });
    try {
      await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw new Error(
          `A different font named ${path.basename(file)} is already installed. Rename this file to install it too.`,
        );
      throw error;
    }
  }
  return { path: target, copied: !existing, cache: await refreshCache(folder) };
}

async function refreshCache(folder: string): Promise<InstallResult["cache"]> {
  try {
    await promisify(execFile)("fc-cache", ["-f", folder], { timeout: 60_000 });
    return { kind: "refreshed" };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { kind: "unavailable" };
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    return { kind: "failed", message: stderr || (error instanceof Error ? error.message : "") };
  }
}
