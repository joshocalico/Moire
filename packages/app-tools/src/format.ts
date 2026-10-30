/** Formatting shared by the apps, so sizes read the same in every window. */
import os from "node:os";
import path from "node:path";

/** A byte count for people: "512 B", "4.2 KB", "38 MB" (1024-based, like the file chooser). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** How long ago a moment was, for "updated …" lines: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatTimeAgo(then: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** A path for people: inside the home folder it starts with "~" ("~/Pictures/beach.jpg"). */
export function tidyPath(file: string): string {
  const home = os.homedir();
  return file === home || file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}
