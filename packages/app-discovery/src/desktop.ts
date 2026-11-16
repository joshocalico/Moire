import fs from "node:fs";

export type DesktopEntry = {
  id: string;
  name: string;
  genericName?: string;
  comment?: string;
  exec: string;
  /** Original Exec value, including freedesktop field codes. */
  execTemplate?: string;
  icon?: string;
  terminal: boolean;
  categories: string[];
  mimeTypes?: string[];
  /** The window class the app's windows carry, often its reverse-DNS app id. */
  startupWMClass?: string;
  /**
   * `SingleMainWindow=true`: the app has one main window, so launching it again activates that
   * window (and hands it any deep link) instead of opening another.
   */
  singleMainWindow?: boolean;
};

function parseLocaleKey(map: Map<string, string>, base: string): string | undefined {
  const lang = (process.env.LANG ?? "en_US").split(".")[0];
  const short = lang.split("_")[0];
  return map.get(`${base}[${lang}]`) ?? map.get(`${base}[${short}]`) ?? map.get(base);
}

/**
 * Minimal Desktop Entry parser for [Desktop Entry] Application type.
 */
export function parseDesktopFile(
  text: string,
  fileName: string,
  currentDesktop: string,
): DesktopEntry | null {
  const lines = text.split(/\r?\n/);
  let inEntry = false;
  const keys = new Map<string, string>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    keys.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }

  if ((keys.get("Type") ?? "Application") !== "Application") return null;
  if (keys.get("NoDisplay") === "true" || keys.get("Hidden") === "true") {
    return null;
  }

  const onlyShowIn = keys.get("OnlyShowIn");
  if (onlyShowIn) {
    const allowed = onlyShowIn.split(";").filter(Boolean);
    if (!allowed.includes(currentDesktop)) return null;
  }
  const notShowIn = keys.get("NotShowIn");
  if (notShowIn) {
    const blocked = notShowIn.split(";").filter(Boolean);
    if (blocked.includes(currentDesktop)) return null;
  }

  const name = parseLocaleKey(keys, "Name");
  const exec = keys.get("Exec");
  if (!name || !exec) return null;

  const tryExec = keys.get("TryExec");
  if (tryExec) {
    // Best-effort: if absolute and missing, skip; PATH checks come later.
    if (tryExec.startsWith("/") && !exists(tryExec)) return null;
  }

  // Strip field codes for bare launch.
  const cleanedExec = exec.replace(/%[fFuUdDnNickvm]/g, "").trim();

  return {
    id: fileName,
    name,
    genericName: parseLocaleKey(keys, "GenericName"),
    comment: parseLocaleKey(keys, "Comment"),
    exec: cleanedExec,
    execTemplate: exec,
    icon: keys.get("Icon"),
    terminal: keys.get("Terminal") === "true",
    categories: (keys.get("Categories") ?? "").split(";").filter(Boolean),
    mimeTypes: (keys.get("MimeType") ?? "").split(";").filter(Boolean),
    startupWMClass: keys.get("StartupWMClass") || undefined,
    singleMainWindow: keys.get("SingleMainWindow") === "true" || undefined,
  };
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
