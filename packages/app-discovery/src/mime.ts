import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { discoverApplications, xdgDataDirs } from "./index.js";
import type { DesktopEntry } from "./desktop.js";

type Associations = {
  defaults: Map<string, string[]>;
  added: Map<string, string[]>;
  removed: Map<string, Set<string>>;
};

type MimeGlob = {
  mime: string;
  weight: number;
  pattern: string;
  regex: RegExp;
};

export type MimeAssociationSnapshot = {
  defaults: ReadonlyMap<string, readonly string[]>;
  added: ReadonlyMap<string, readonly string[]>;
  removed: ReadonlyMap<string, ReadonlySet<string>>;
};

function configHome(): string {
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

function configDirs(): string[] {
  return (process.env.XDG_CONFIG_DIRS ?? "/etc/xdg").split(":").filter(Boolean);
}

function splitIds(value: string): string[] {
  return value.split(";").map((v) => v.trim()).filter(Boolean);
}

function addUnique(map: Map<string, string[]>, key: string, values: string[]): void {
  const list = map.get(key) ?? [];
  for (const value of values) {
    if (!list.includes(value)) list.push(value);
  }
  map.set(key, list);
}

function parseAssociationFile(filePath: string): Map<string, Map<string, string[]>> {
  const sections = new Map<string, Map<string, string[]>>();
  let section = "";
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return sections;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }
    const eq = line.indexOf("=");
    if (!section || eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const values = splitIds(line.slice(eq + 1));
    const map = sections.get(section) ?? new Map<string, string[]>();
    map.set(key, values);
    sections.set(section, map);
  }
  return sections;
}

function associationFiles(desktop: string): string[] {
  const desktopName = desktop.trim().toLowerCase();
  const configRoots = [configHome(), ...configDirs()];
  const dataRoots = xdgDataDirs().map((root) => path.join(root, "applications"));
  return [...configRoots, ...dataRoots].flatMap((root) => [
    ...(desktopName ? [path.join(root, `${desktopName}-mimeapps.list`)] : []),
    path.join(root, "mimeapps.list"),
  ]);
}

function loadAssociations(desktop: string): Associations {
  const out: Associations = {
    defaults: new Map(),
    added: new Map(),
    removed: new Map(),
  };
  for (const filePath of associationFiles(desktop)) {
    const sections = parseAssociationFile(filePath);
    for (const [mime, ids] of sections.get("Default Applications") ?? []) {
      if (!out.defaults.has(mime) && ids.length > 0) out.defaults.set(mime, ids);
    }
    for (const [mime, ids] of sections.get("Added Associations") ?? []) {
      addUnique(out.added, mime, ids);
    }
    for (const [mime, ids] of sections.get("Removed Associations") ?? []) {
      const removed = out.removed.get(mime) ?? new Set<string>();
      for (const id of ids) removed.add(id);
      out.removed.set(mime, removed);
    }
  }
  for (const root of xdgDataDirs()) {
    const sections = parseAssociationFile(
      path.join(root, "applications", "mimeinfo.cache"),
    );
    for (const [mime, ids] of sections.get("MIME Cache") ?? []) {
      addUnique(out.added, mime, ids);
    }
  }
  return out;
}

function globRegex(pattern: string, caseSensitive: boolean): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`, caseSensitive ? "" : "i");
}

function loadMimeGlobs(): MimeGlob[] {
  const globs: MimeGlob[] = [];
  for (const root of xdgDataDirs()) {
    const mimeRoot = path.join(root, "mime");
    const globs2 = path.join(mimeRoot, "globs2");
    try {
      for (const raw of fs.readFileSync(globs2, "utf8").split(/\r?\n/)) {
        if (!raw || raw.startsWith("#")) continue;
        const [weightText, mime, pattern, flags = ""] = raw.split(":");
        if (!weightText || !mime || !pattern) continue;
        globs.push({
          mime,
          weight: Number(weightText) || 50,
          pattern,
          regex: globRegex(pattern, flags.split(",").includes("cs")),
        });
      }
    } catch {
      try {
        for (const raw of fs.readFileSync(path.join(mimeRoot, "globs"), "utf8").split(/\r?\n/)) {
          if (!raw || raw.startsWith("#")) continue;
          const colon = raw.indexOf(":");
          if (colon <= 0) continue;
          const mime = raw.slice(0, colon);
          const pattern = raw.slice(colon + 1);
          globs.push({
            mime,
            weight: 50,
            pattern,
            regex: globRegex(pattern, false),
          });
        }
      } catch {
        // shared-mime-info is optional
      }
    }
  }
  return globs.sort(
    (a, b) => b.weight - a.weight || b.pattern.length - a.pattern.length,
  );
}

function loadSubclasses(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const root of xdgDataDirs()) {
    try {
      const text = fs.readFileSync(path.join(root, "mime", "subclasses"), "utf8");
      for (const raw of text.split(/\r?\n/)) {
        const [child, parent] = raw.trim().split(/\s+/, 2);
        if (!child || !parent) continue;
        addUnique(out, child, [parent]);
      }
    } catch {
      // optional
    }
  }
  return out;
}

function fallbackMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const known: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".zip": "application/zip",
  };
  return known[ext] ?? "application/octet-stream";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Expand freedesktop Exec field codes into a shell command. */
export function buildDesktopExec(app: DesktopEntry, paths: string[]): string {
  const template = app.execTemplate ?? app.exec;
  const local = paths.map((value) => shellQuote(value));
  const uris = paths.map((value) => shellQuote(pathToFileURL(value).href));
  let usedFileCode = false;
  const marker = "__MOIRE_PERCENT__";
  let command = template.replace(/%%/g, marker).replace(/%[fFuUick]/g, (code) => {
    if (code === "%f") {
      usedFileCode = true;
      return local[0] ?? "";
    }
    if (code === "%F") {
      usedFileCode = true;
      return local.join(" ");
    }
    if (code === "%u") {
      usedFileCode = true;
      return uris[0] ?? "";
    }
    if (code === "%U") {
      usedFileCode = true;
      return uris.join(" ");
    }
    if (code === "%c") return shellQuote(app.name);
    if (code === "%i") return app.icon ? `--icon ${shellQuote(app.icon)}` : "";
    return "";
  });
  command = command.replaceAll(marker, "%").replace(/\s+/g, " ").trim();
  if (!usedFileCode && local.length > 0) command += ` ${local.join(" ")}`;
  return app.terminal ? `foot -e ${command}` : command;
}

function writeDefault(mime: string, desktopId: string): void {
  const filePath = path.join(configHome(), "mimeapps.list");
  const sections = parseAssociationFile(filePath);
  const defaults = sections.get("Default Applications") ?? new Map();
  const added = sections.get("Added Associations") ?? new Map();
  defaults.set(mime, [desktopId]);
  addUnique(added, mime, [desktopId]);
  sections.set("Default Applications", defaults);
  sections.set("Added Associations", added);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const preferred = ["Default Applications", "Added Associations", "Removed Associations"];
  const names = [...preferred.filter((name) => sections.has(name)), ...[...sections.keys()].filter((name) => !preferred.includes(name))];
  const lines: string[] = [];
  for (const name of names) {
    lines.push(`[${name}]`);
    for (const [key, values] of sections.get(name) ?? []) {
      lines.push(`${key}=${values.join(";")}${values.length ? ";" : ""}`);
    }
    lines.push("");
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

export class MimeAssociationDatabase {
  private associations: Associations;
  private readonly globs: MimeGlob[];
  private readonly subclasses: Map<string, string[]>;

  constructor(
    readonly applications: DesktopEntry[],
    readonly desktop = process.env.XDG_CURRENT_DESKTOP ?? "Moire",
  ) {
    this.associations = loadAssociations(desktop);
    this.globs = loadMimeGlobs();
    this.subclasses = loadSubclasses();
  }

  snapshot(): MimeAssociationSnapshot {
    return this.associations;
  }

  refresh(): void {
    this.associations = loadAssociations(this.desktop);
  }

  mimeTypeForPath(filePath: string): string {
    try {
      if (fs.statSync(filePath).isDirectory()) return "inode/directory";
    } catch {
      // Match the name even when the file disappeared between listing and click.
    }
    const name = path.basename(filePath);
    for (const glob of this.globs) {
      if (glob.regex.test(name)) return glob.mime;
    }
    return fallbackMime(filePath);
  }

  private relatedMimeTypes(mime: string): string[] {
    const out = [mime];
    for (let i = 0; i < out.length; i++) {
      for (const parent of this.subclasses.get(out[i]!) ?? []) {
        if (!out.includes(parent)) out.push(parent);
      }
    }
    return out;
  }

  applicationsForMime(mime: string): DesktopEntry[] {
    const related = this.relatedMimeTypes(mime);
    const ids: string[] = [];
    const removed = new Set<string>();
    for (const type of related) {
      for (const id of this.associations.removed.get(type) ?? []) removed.add(id);
      for (const id of this.associations.defaults.get(type) ?? []) {
        if (!ids.includes(id)) ids.push(id);
      }
      for (const id of this.associations.added.get(type) ?? []) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    for (const app of this.applications) {
      if (app.mimeTypes?.some((type) => related.includes(type)) && !ids.includes(app.id)) {
        ids.push(app.id);
      }
    }
    const byId = new Map(this.applications.map((app) => [app.id, app]));
    return ids.filter((id) => !removed.has(id)).map((id) => byId.get(id)).filter((app): app is DesktopEntry => !!app);
  }

  applicationsForPath(filePath: string): DesktopEntry[] {
    return this.applicationsForMime(this.mimeTypeForPath(filePath));
  }

  defaultApplicationForMime(mime: string): DesktopEntry | null {
    return this.applicationsForMime(mime)[0] ?? null;
  }

  setDefaultApplication(mime: string, desktopId: string): void {
    writeDefault(mime, desktopId);
    this.refresh();
  }
}

export function loadMimeAssociationDatabase(
  applications = discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire"),
): MimeAssociationDatabase {
  return new MimeAssociationDatabase(applications);
}
