/**
 * Settings › Search as pure functions: what the index service's status means for people, which
 * folders are always skipped, the removable drives a person may opt in, and edits to the
 * exclude and include lists.
 */
import path from "node:path";
import {
  SKIPPED_FOLDER_NAMES,
  isInside,
  type IndexClientState,
} from "@moire/system-management/index-status";
import type { StorageClientState } from "@moire/system-management/storage-status";

/** The part of `settings.json` this page edits; the index service reads the same fields. */
export type IndexingPrefs = {
  enabled: boolean;
  excludes: readonly string[];
  includes: readonly string[];
};

export type IndexTone = "idle" | "busy" | "warning" | "error";

export type IndexSummary = {
  tone: IndexTone;
  title: string;
  detail: string;
  /** 0..1 while the first walk runs; null otherwise. */
  progress: number | null;
  counts: { files: number; folders: number; withText: number; pendingText: number } | null;
  lastUpdated: number | null;
  /** The service is running with an index it can rebuild or delete. */
  hasIndex: boolean;
};

const count = new Intl.NumberFormat("en");
export const formatCount = (value: number) => count.format(value);
const plural = (value: number, one: string, many: string) =>
  `${formatCount(value)} ${value === 1 ? one : many}`;

/** What the index is doing, in the words the status card uses. */
export function summarizeIndex(state: IndexClientState | null, enabled: boolean): IndexSummary {
  const none = { progress: null, counts: null, lastUpdated: null, hasIndex: false };
  if (!state || state.kind === "unavailable")
    return {
      ...none,
      tone: "warning",
      title: "The search service isn't running",
      detail: enabled
        ? "Your choices here are saved and apply when it starts"
        : "Indexing is off, so nothing is lost",
    };
  if (state.kind === "connecting")
    return { ...none, tone: "busy", title: "Connecting to the search service", detail: "" };
  const status = state.status;
  const indexed = {
    counts: {
      files: status.files,
      folders: status.folders,
      withText: status.withText,
      pendingText: status.pendingText,
    },
    lastUpdated: status.lastCrawlAt,
    hasIndex: true,
    progress: null,
  };
  switch (status.state) {
    case "disabled":
      return {
        ...none,
        tone: "idle",
        title: "Indexing is off",
        detail: "Files searches names only, folder by folder",
      };
    case "starting":
      return { ...none, tone: "busy", title: "Starting", detail: "Opening the index" };
    case "crawling": {
      const { directories, queued } = status.crawl;
      return {
        ...indexed,
        tone: "busy",
        title: "Indexing your files",
        detail: `${plural(directories, "folder", "folders")} read · ${formatCount(queued)} waiting`,
        progress: directories + queued > 0 ? directories / (directories + queued) : 0,
      };
    }
    case "paused":
      return { ...indexed, tone: "warning", title: "Paused", detail: status.message };
    case "ready":
      return {
        ...indexed,
        tone: "idle",
        title: "Up to date",
        detail:
          status.watching === "recursive"
            ? "Watching for changes"
            : "Checking for changes every few minutes",
      };
    case "error":
      return { ...indexed, tone: "error", title: "Indexing stopped", detail: status.message };
  }
}

export type SearchEnvironment = { home: string; cacheHome: string; dataHome: string };

export function searchEnvironment(env: NodeJS.ProcessEnv, home: string): SearchEnvironment {
  return {
    home,
    cacheHome: env.XDG_CACHE_HOME || path.join(home, ".cache"),
    dataHome: env.XDG_DATA_HOME || path.join(home, ".local", "share"),
  };
}

export type BuiltInExclude = { id: string; label: string; detail: string };

/** What the service skips whatever the settings say (see `exclusionRules` in the service). */
export function builtInExcludes(
  env: SearchEnvironment,
  tidy: (file: string) => string,
): BuiltInExclude[] {
  return [
    { id: "hidden", label: "Hidden folders", detail: "Any folder whose name starts with a dot" },
    { id: "caches", label: "Caches", detail: tidy(env.cacheHome) },
    { id: "trash", label: "Trash", detail: tidy(path.join(env.dataHome, "Trash")) },
    {
      id: "build",
      label: "Dependencies and build output",
      detail: [...SKIPPED_FOLDER_NAMES].join(", "),
    },
  ];
}

export type Edit<T> = { ok: true; value: T } | { ok: false; message: string };

/** `~/…` and absolute entries as absolute paths; names and patterns stay as they are. */
function entryPath(entry: string, home: string): string | null {
  if (entry === "~") return home;
  if (entry.startsWith("~/")) return path.join(home, entry.slice(2));
  return path.isAbsolute(entry) ? path.resolve(entry) : null;
}

/** Add a chosen folder to the excludes, refusing ones that would change nothing or everything. */
export function addExclude(
  excludes: readonly string[],
  folder: string,
  env: SearchEnvironment,
): Edit<string[]> {
  const chosen = path.resolve(folder);
  if (chosen === env.home || isInside(env.home, chosen))
    return { ok: false, message: "Your home folder can't be excluded; turn indexing off instead" };
  const relative = path.relative(env.home, chosen);
  if (
    relative &&
    !relative.startsWith("..") &&
    relative.split(path.sep).some((part) => part.startsWith("."))
  )
    return { ok: false, message: "Hidden folders are already skipped" };
  for (const entry of excludes) {
    const existing = entryPath(entry, env.home);
    if (existing && (existing === chosen || isInside(chosen, existing)))
      return { ok: false, message: `${path.basename(chosen)} is already excluded` };
  }
  // A new folder above existing ones replaces them.
  const kept = excludes.filter((entry) => {
    const existing = entryPath(entry, env.home);
    return !existing || !isInside(existing, chosen);
  });
  return { ok: true, value: [...kept, chosen] };
}

export function removeEntry(list: readonly string[], entry: string): string[] {
  return list.filter((item) => item !== entry);
}

export type Drive = {
  /** The mount point the include list stores. */
  path: string;
  label: string;
  detail: string;
  connected: boolean;
  included: boolean;
};

export type DriveList =
  | { kind: "loading" | "unavailable"; message: string }
  | { kind: "ready"; drives: Drive[] };

/**
 * Mounted drives from the storage service, each with its opt-in, followed by drives that are
 * opted in but not connected now, so they can still be turned off.
 */
export function removableDrives(
  storage: StorageClientState | null,
  includes: readonly string[],
  formatSize: (bytes: number) => string,
): DriveList {
  const offline = (connected: ReadonlySet<string>): Drive[] =>
    includes
      .filter((entry) => !connected.has(entry))
      .map((entry) => ({
        path: entry,
        label: path.basename(entry) || entry,
        detail: `${entry} · Not connected`,
        connected: false,
        included: true,
      }));
  if (!storage || storage.kind === "unavailable" || storage.kind === "error") {
    const drives = offline(new Set());
    return drives.length
      ? { kind: "ready", drives }
      : { kind: "unavailable", message: "The drive service isn't running" };
  }
  if (storage.kind !== "ready") return { kind: "loading", message: "Looking for drives" };
  const status = storage.snapshot.status;
  if (status.kind !== "ready")
    return { kind: status.kind === "loading" ? "loading" : "unavailable", message: status.message };
  const mounted: Drive[] = [];
  for (const volume of status.volumes) {
    if (volume.mount.kind !== "mounted") continue;
    const mountPath = volume.mount.paths[0];
    mounted.push({
      path: mountPath,
      label: volume.label || path.basename(mountPath) || volume.device,
      detail: [mountPath, volume.sizeBytes != null ? formatSize(volume.sizeBytes) : null]
        .filter(Boolean)
        .join(" · "),
      connected: true,
      included: includes.includes(mountPath),
    });
  }
  return { kind: "ready", drives: [...mounted, ...offline(new Set(mounted.map((d) => d.path)))] };
}

export function withInclude(includes: readonly string[], drive: string, on: boolean): string[] {
  const rest = includes.filter((entry) => entry !== drive);
  return on ? [...rest, drive] : rest;
}
