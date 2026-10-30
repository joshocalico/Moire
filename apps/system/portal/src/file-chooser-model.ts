/**
 * org.freedesktop.impl.portal.FileChooser, without the window: what a request asks Moire's file
 * chooser to show, and the results a choice turns into.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { variant, type DbusVariant } from "@moire/dbus";
import { option, plainText, type PortalOptions } from "./common";

export type ChooserKind = "open" | "save" | "save-files";
/** The portal's filter: a name and (0 glob | 1 MIME type, pattern) pairs. */
export type PortalFilter = [name: string, patterns: [kind: number, pattern: string][]];
type PortalChoice = [id: string, label: string, options: [string, string][], initial: string];

export type ChooserRequest = {
  kind: ChooserKind;
  mode: "open" | "save" | "folder";
  /** Keeps each calling app's last folder and recents apart from other apps'. */
  chooserId: string;
  title: string;
  multiple: boolean;
  /** Extensions offered (no dots); undefined shows every file. */
  accept?: string[];
  directory?: string;
  name?: string;
  /** SaveFiles: the names to place in the chosen folder. */
  files: string[];
  filters: PortalFilter[];
  currentFilter: PortalFilter | null;
  choices: PortalChoice[];
};

/** A NUL-terminated byte-string path option; only absolute paths are honoured. */
function bytePath(options: PortalOptions, key: string): string | undefined {
  const raw = option<unknown>(options, key, "ay", null);
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 4096) return undefined;
  const end = raw.indexOf(0);
  const text = raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
  return path.isAbsolute(text) ? path.normalize(text) : undefined;
}

/** A file name with no directory part, so a caller cannot steer a save outside the folder. */
function fileName(value: unknown): string {
  const text = Buffer.isBuffer(value)
    ? value.subarray(0, value.indexOf(0) < 0 ? value.length : value.indexOf(0)).toString("utf8")
    : plainText(value, 255);
  const base = path.basename(text.replace(/[\0\n]/g, ""));
  return base === "." || base === ".." ? "" : base.slice(0, 255);
}

function parseFilter(value: unknown): PortalFilter | null {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !Array.isArray(value[1]))
    return null;
  const patterns = (value[1] as unknown[]).flatMap((entry): [number, string][] =>
    Array.isArray(entry) && typeof entry[0] === "number" && typeof entry[1] === "string"
      ? [[entry[0], entry[1].slice(0, 256)]]
      : [],
  );
  return [plainText(value[0], 128), patterns.slice(0, 64)];
}

/** The extensions one filter admits, or null when it cannot be narrowed to extensions. */
export function filterExtensions(
  filter: PortalFilter,
  extensionsForMime: (mime: string) => string[],
): string[] | null {
  const extensions = new Set<string>();
  for (const [kind, pattern] of filter[1]) {
    if (kind === 1) {
      const known = pattern === "*/*" ? [] : extensionsForMime(pattern);
      if (known.length === 0) return null;
      for (const extension of known) extensions.add(extension);
      continue;
    }
    // GTK spells case-insensitive globs as *.[pP][nN][gG].
    const plain = pattern.replace(/\[(.)[^\]]*\]/g, "$1").toLowerCase();
    const match = /^\*(?:\.[a-z0-9_+-]+)*\.([a-z0-9_+-]+)$/.exec(plain);
    if (!match) return null;
    extensions.add(match[1]!);
  }
  return extensions.size ? [...extensions] : null;
}

export function chooserRequest(
  kind: ChooserKind,
  appId: unknown,
  title: unknown,
  options: PortalOptions,
  extensionsForMime: (mime: string) => string[],
): ChooserRequest {
  const filters = option<unknown[]>(options, "filters", "a(sa(us))", [])
    .slice(0, 64)
    .flatMap((entry) => {
      const filter = parseFilter(entry);
      return filter ? [filter] : [];
    });
  const currentFilter = parseFilter(option<unknown>(options, "current_filter", "(sa(us))", null));
  // The chooser has no filter menu, so it shows what any offered filter admits.
  let accept: string[] | undefined;
  if (kind !== "save-files" && filters.length > 0) {
    const union = new Set<string>();
    let open = false;
    for (const filter of filters) {
      const extensions = filterExtensions(filter, extensionsForMime);
      if (!extensions) open = true;
      else for (const extension of extensions) union.add(extension);
    }
    accept = open || union.size === 0 ? undefined : [...union];
  }
  const currentFile = kind === "save" ? bytePath(options, "current_file") : undefined;
  const directory =
    bytePath(options, "current_folder") ?? (currentFile ? path.dirname(currentFile) : undefined);
  const name =
    kind === "save"
      ? fileName(option(options, "current_name", "s", "")) ||
        (currentFile ? path.basename(currentFile) : "")
      : "";
  const folder = kind === "save-files" || option(options, "directory", "b", false);
  const id = plainText(appId, 128).replace(/[^\w.-]/g, "_");
  return {
    kind,
    mode: kind === "save" ? "save" : folder ? "folder" : "open",
    chooserId: id ? `portal.${id}` : "org.moire.Portal",
    title:
      plainText(title, 128) ||
      (kind === "open" ? "Open" : kind === "save" ? "Save as" : "Choose a folder"),
    multiple: kind === "open" && !folder && option(options, "multiple", "b", false),
    ...(accept ? { accept } : {}),
    ...(directory ? { directory } : {}),
    ...(name ? { name } : {}),
    files:
      kind === "save-files"
        ? option<unknown[]>(options, "files", "aay", [])
            .slice(0, 1024)
            .map(fileName)
            .filter(Boolean)
        : [],
    filters,
    currentFilter,
    choices: option<unknown[]>(options, "choices", "a(ssa(ss)s)", [])
      .slice(0, 32)
      .filter((choice): choice is PortalChoice => Array.isArray(choice) && choice.length === 4),
  };
}

/** The `a{sv}` results for the chosen paths (for SaveFiles, the one chosen folder). */
export function chooserResults(
  request: ChooserRequest,
  chosen: readonly string[],
  extensionsForMime: (mime: string) => string[],
): Record<string, DbusVariant> {
  const paths =
    request.kind === "save-files"
      ? request.files.map((name) => path.join(chosen[0] ?? "/", name))
      : [...chosen];
  const results: Record<string, DbusVariant> = {
    uris: variant(
      "as",
      paths.map((file) => pathToFileURL(file).href),
    ),
  };
  // Choices are not shown; each reports the value the app proposed.
  if (request.choices.length)
    results.choices = variant(
      "a(ss)",
      request.choices.map(([id, , , initial]) => [id, initial]),
    );
  const extension = paths.length === 1 ? path.extname(paths[0]!).slice(1).toLowerCase() : "";
  const matched =
    request.filters.find((filter) =>
      filterExtensions(filter, extensionsForMime)?.includes(extension),
    ) ?? request.currentFilter;
  if (matched && request.kind !== "save-files")
    results.current_filter = variant("(sa(us))", matched);
  if (request.kind !== "open") results.writable = variant("b", true);
  return results;
}
