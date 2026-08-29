import fs from "node:fs";
import path from "node:path";
import { parseDesktopFile, type DesktopEntry } from "./desktop";

export function xdgDataDirs(): string[] {
  const home = process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? "", ".local/share");
  const dirs = (process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":");
  return [home, ...dirs].filter(Boolean);
}

const iconPathCache = new Map<string, string | undefined>();

/** Resolve a freedesktop application icon to a PNG the software renderer can load. */
export function resolveApplicationIcon(icon?: string): string | undefined {
  if (!icon) return undefined;
  if (iconPathCache.has(icon)) return iconPathCache.get(icon);

  if (path.isAbsolute(icon)) {
    const resolved = icon.toLowerCase().endsWith(".png") && fs.existsSync(icon) ? icon : undefined;
    iconPathCache.set(icon, resolved);
    return resolved;
  }

  const fileName = icon.toLowerCase().endsWith(".png") ? icon : `${icon}.png`;
  const sizes = ["64x64", "48x48", "32x32", "128x128", "256x256", "24x24"];
  for (const root of xdgDataDirs()) {
    for (const size of sizes) {
      for (const context of ["apps", "applications"]) {
        const candidate = path.join(root, "icons", "hicolor", size, context, fileName);
        if (fs.existsSync(candidate)) {
          iconPathCache.set(icon, candidate);
          return candidate;
        }
      }
    }
    const pixmap = path.join(root, "pixmaps", fileName);
    if (fs.existsSync(pixmap)) {
      iconPathCache.set(icon, pixmap);
      return pixmap;
    }
  }

  iconPathCache.set(icon, undefined);
  return undefined;
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
      files = fs.readdirSync(appDir).filter((file) => file.endsWith(".desktop"));
    } catch {
      continue;
    }

    for (const file of files) {
      const full = path.join(appDir, file);
      try {
        const text = fs.readFileSync(full, "utf8");
        const entry = parseDesktopFile(text, file, desktop);
        if (entry && !byId.has(entry.id)) byId.set(entry.id, entry);
      } catch {
        // Skip unreadable or malformed entries.
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterApplications(apps: DesktopEntry[], query: string): DesktopEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return apps;
  return apps.filter(
    (app) =>
      app.name.toLowerCase().includes(normalized) ||
      (app.genericName?.toLowerCase().includes(normalized) ?? false) ||
      app.exec.toLowerCase().includes(normalized) ||
      app.id.toLowerCase().includes(normalized),
  );
}
