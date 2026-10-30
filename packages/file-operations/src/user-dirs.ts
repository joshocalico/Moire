import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type UserDirectory = "DESKTOP" | "DOWNLOAD" | "DOCUMENTS" | "PICTURES" | "MUSIC" | "VIDEOS";

const FALLBACK: Record<UserDirectory, string> = {
  DESKTOP: "Desktop",
  DOWNLOAD: "Downloads",
  DOCUMENTS: "Documents",
  PICTURES: "Pictures",
  MUSIC: "Music",
  VIDEOS: "Videos",
};

/** XDG user directories from `user-dirs.dirs`, so Files and the desktop agree on locations. */
export function xdgUserDirectories(): Map<string, string> {
  const result = new Map<string, string>();
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  try {
    const source = fs.readFileSync(path.join(configHome, "user-dirs.dirs"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = /^XDG_([A-Z]+)_DIR="(.*)"$/.exec(line.trim());
      if (!match) continue;
      const expanded = match[2]!.replace(/^\$HOME(?=\/|$)/, os.homedir());
      result.set(match[1]!, path.resolve(expanded));
    }
  } catch {
    // user-dirs.dirs is optional; conventional locations remain useful.
  }
  return result;
}

export function userDirectory(name: UserDirectory): string {
  return xdgUserDirectories().get(name) ?? path.join(os.homedir(), FALLBACK[name]);
}
