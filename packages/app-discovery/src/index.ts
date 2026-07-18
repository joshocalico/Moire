import fs from "node:fs";
import path from "node:path";
import { parseDesktopFile, type DesktopEntry } from "./desktop.js";

export type { DesktopEntry } from "./desktop.js";
export { parseDesktopFile } from "./desktop.js";

export function xdgDataDirs(): string[] {
  const home = process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? "", ".local/share");
  const dirs = (process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":");
  return [home, ...dirs].filter(Boolean);
}

/**
 * Scan Freedesktop application directories and merge by desktop-file-id.
 * XDG_DATA_HOME is searched first and wins over system entries with the same id.
 */
export function discoverApplications(desktop = "Moire"): DesktopEntry[] {
  const byId = new Map<string, DesktopEntry>();

  for (const root of xdgDataDirs()) {
    const appDir = path.join(root, "applications");
    if (!fs.existsSync(appDir)) continue;

    let files: string[];
    try {
      files = fs.readdirSync(appDir).filter((f) => f.endsWith(".desktop"));
    } catch {
      continue;
    }

    for (const file of files) {
      const full = path.join(appDir, file);
      try {
        const text = fs.readFileSync(full, "utf8");
        const entry = parseDesktopFile(text, file, desktop);
        // XDG_DATA_HOME is first and has highest precedence.
        if (entry && !byId.has(entry.id)) {
          byId.set(entry.id, entry);
        }
      } catch {
        // skip unreadable / malformed
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export {
  MimeAssociationDatabase,
  buildDesktopExec,
  loadMimeAssociationDatabase,
  type MimeAssociationSnapshot,
} from "./mime.js";
export {
  ContextActionRegistry,
  type ContextAction,
  type ContextActionPlugin,
  type FileActionContext,
  type FileActionSource,
} from "./actions.js";

export function filterApplications(
  apps: DesktopEntry[],
  query: string,
): DesktopEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return apps;
  return apps.filter((app) => {
    return (
      app.name.toLowerCase().includes(q) ||
      (app.genericName?.toLowerCase().includes(q) ?? false) ||
      app.exec.toLowerCase().includes(q) ||
      app.id.toLowerCase().includes(q)
    );
  });
}
