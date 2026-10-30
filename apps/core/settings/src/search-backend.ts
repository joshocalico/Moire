/**
 * Settings › Search I/O: the indexing fields of `settings.json` (the service reads the same
 * file), the hand-edited `index.json` supplement, and clearing the index through the service.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configDir, loadSettings, updateSettings } from "@moire/prefs";
import { errorText } from "@moire/app-tools";
import type { IndexClient, IndexClientState } from "@moire/system-management/index-status";
import {
  searchEnvironment,
  type Edit,
  type IndexingPrefs,
  type SearchEnvironment,
} from "./search-model";

export function currentSearchEnvironment(): SearchEnvironment {
  return searchEnvironment(process.env, process.env.HOME || os.homedir());
}

export function readIndexingPrefs(): IndexingPrefs {
  const settings = loadSettings();
  return {
    enabled: settings.indexingEnabled,
    excludes: settings.indexExcludes,
    includes: settings.indexIncludes,
  };
}

/** Write only the indexing fields; the service notices the file change and applies it. */
export function writeIndexingPrefs(patch: Partial<IndexingPrefs>): Edit<IndexingPrefs> {
  try {
    const next = updateSettings({
      ...(patch.enabled != null ? { indexingEnabled: patch.enabled } : {}),
      ...(patch.excludes ? { indexExcludes: [...patch.excludes] } : {}),
      ...(patch.includes ? { indexIncludes: [...patch.includes] } : {}),
    });
    return {
      ok: true,
      value: {
        enabled: next.indexingEnabled,
        excludes: next.indexExcludes,
        includes: next.indexIncludes,
      },
    };
  } catch (error) {
    return { ok: false, message: `Could not save search settings: ${errorText(error)}` };
  }
}

export type HandEditedConfig = { file: string; exclude: string[]; include: string[] };

/** `index.json`, read the way the service reads it; a missing or broken file adds nothing. */
export function readHandEditedConfig(): HandEditedConfig {
  const file = path.join(configDir(), "index.json");
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> | null;
    return { file, exclude: strings(raw?.exclude), include: strings(raw?.include) };
  } catch {
    return { file, exclude: [], include: [] };
  }
}

/** When the service can't say, an index on disk is what turning indexing off would delete. */
export function indexOnDisk(env: SearchEnvironment): boolean {
  return fs.existsSync(path.join(env.cacheHome, "moire", "index.db"));
}

/** Long enough for the service's settings debounce and its coalesced status signal. */
const CLEAR_TIMEOUT_MS = 10_000;

function waitForState(
  client: IndexClient,
  done: (state: IndexClientState) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    unsubscribe = client.subscribe((state) => {
      if (done(state)) finish(true);
    });
    if (settled) unsubscribe();
  });
}

/**
 * The service deletes its database whenever indexing is turned off, so clearing is off, wait
 * until the service reports the index gone, then on again for a fresh walk. If it never
 * confirms, indexing is turned back on and the failure is returned.
 */
export async function clearIndex(
  client: IndexClient,
  timeoutMs = CLEAR_TIMEOUT_MS,
): Promise<Edit<IndexingPrefs>> {
  const off = writeIndexingPrefs({ enabled: false });
  if (!off.ok) return off;
  const cleared = await waitForState(
    client,
    (state) => state.kind === "ready" && state.status.state === "disabled",
    timeoutMs,
  );
  const on = writeIndexingPrefs({ enabled: true });
  if (!on.ok) return on;
  return cleared
    ? on
    : { ok: false, message: "The search service didn't confirm the index was cleared" };
}

export async function rebuildIndex(client: IndexClient, root: string): Promise<Edit<null>> {
  try {
    await client.reindex(root);
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: `Could not rebuild the index: ${errorText(error)}` };
  }
}
