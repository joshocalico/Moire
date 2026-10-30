/** Where the index lives and what it leaves out, resolved once from the session environment. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recentDirectory } from "@moire/file-operations";
import { SKIPPED_FOLDER_NAMES } from "@moire/system-management/index-status";

export type IndexEnvironment = {
  home: string;
  /** `$XDG_CACHE_HOME/moire/index.db`: the index is a cache and may be deleted at any time. */
  database: string;
  /** `~/.config/moire/index.json`: the user's own excludes and opted-in drives. */
  configFile: string;
  /** Files' tag catalog, read so `tag:` filters and tag matches work. */
  tagsFile: string;
  /** Per-app recent lists. */
  recentDirectory: string;
  cacheHome: string;
  dataHome: string;
};

export function indexEnvironment(env: NodeJS.ProcessEnv = process.env): IndexEnvironment {
  const home = env.HOME || os.homedir();
  const cacheHome = env.XDG_CACHE_HOME || path.join(home, ".cache");
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return {
    home,
    database: path.join(cacheHome, "moire", "index.db"),
    configFile: path.join(configHome, "moire", "index.json"),
    tagsFile: path.join(configHome, "moire", "files-tags.json"),
    recentDirectory: recentDirectory({ ...env, HOME: home }),
    cacheHome,
    dataHome,
  };
}

export type ExclusionRules = {
  /** Folder or file names skipped wherever they appear. */
  names: ReadonlySet<string>;
  /** Name patterns with `*` wildcards, from user entries such as `*.iso`. */
  patterns: readonly RegExp[];
  /** Absolute folders skipped with everything below them. */
  paths: readonly string[];
};

function expandHome(entry: string, home: string): string {
  return entry === "~" ? home : entry.startsWith("~/") ? path.join(home, entry.slice(2)) : entry;
}

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * User entries are folders (absolute or `~/…`) or names; a name containing `*` is a pattern.
 * Hidden folders are excluded by the walker itself, so `~/.cache` is listed for a
 * non-hidden `XDG_CACHE_HOME` and Trash for a non-hidden `XDG_DATA_HOME`.
 */
export function exclusionRules(env: IndexEnvironment, entries: readonly string[]): ExclusionRules {
  const names = new Set(SKIPPED_FOLDER_NAMES);
  const patterns: RegExp[] = [];
  const paths = [env.cacheHome, path.join(env.home, ".cache"), path.join(env.dataHome, "Trash")];
  for (const entry of entries) {
    const expanded = expandHome(entry.trim(), env.home);
    if (!expanded) continue;
    if (path.isAbsolute(expanded)) paths.push(path.resolve(expanded));
    else if (expanded.includes("*")) patterns.push(wildcard(expanded));
    else if (!expanded.includes("/")) names.add(expanded);
  }
  return { names, patterns, paths: [...new Set(paths)] };
}

export function isExcluded(
  rules: ExclusionRules,
  file: string,
  name: string,
  isDir: boolean,
): boolean {
  if (isDir && name.startsWith(".")) return true;
  if (rules.names.has(name)) return true;
  if (rules.patterns.some((pattern) => pattern.test(name))) return true;
  return rules.paths.some((folder) => file === folder || file.startsWith(folder + path.sep));
}

export type UserIndexConfig = {
  exclude: string[];
  /** Extra roots, such as a removable drive the user opted in. */
  include: string[];
};

/** A missing or malformed file means no extra rules; it is the user's file, so never rewritten. */
export async function readUserConfig(env: IndexEnvironment): Promise<UserIndexConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(env.configFile, "utf8"));
  } catch {
    return { exclude: [], include: [] };
  }
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    exclude: strings(record.exclude),
    include: strings(record.include)
      .map((entry) => expandHome(entry, env.home))
      .filter((entry) => path.isAbsolute(entry)),
  };
}

/** Files' tag catalog as path → tags. A broken catalog means no tags, not a failed index. */
export async function readTags(env: IndexEnvironment): Promise<Map<string, string[]>> {
  const tags = new Map<string, string[]>();
  try {
    const stored = JSON.parse(await fs.readFile(env.tagsFile, "utf8")) as {
      version?: unknown;
      records?: unknown;
    };
    if (stored.version !== 1 || !Array.isArray(stored.records)) return tags;
    for (const record of stored.records as { path?: unknown; tags?: unknown }[]) {
      if (typeof record.path !== "string" || !Array.isArray(record.tags)) continue;
      const names = record.tags.filter((tag): tag is string => typeof tag === "string");
      if (names.length) tags.set(record.path, names);
    }
  } catch {
    // No catalog yet, or one Files is mid-way through replacing.
  }
  return tags;
}
