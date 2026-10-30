/**
 * The settings journal behind "Recently changed" and Undo: the last changes made in Settings,
 * each with the value it replaced. Kept in `settings-history.json` beside `settings.json`.
 * Display trials are not journalled; they have their own keep-or-revert.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { configDir, type MoireSettings } from "@moire/prefs";
import type { SidebarPageId } from "./catalog";

/** Preferences Settings can put back by writing the old value again. */
export type JournalKey = keyof MoireSettings | "doNotDisturb";

export type JournalEntry = {
  id: string;
  key: JournalKey;
  from: unknown;
  to: unknown;
  /** Epoch milliseconds. */
  at: number;
  page: SidebarPageId;
  /** "Desktop style set to Moire". */
  label: string;
};

export const JOURNAL_LIMIT = 20;

export function historyPath(): string {
  return path.join(configDir(), "settings-history.json");
}

/**
 * Add a change, newest first. A change straight back to the previous value cancels that entry,
 * and changing the same thing again folds into one entry that remembers the oldest value.
 */
export function recordChange(
  journal: readonly JournalEntry[],
  change: Omit<JournalEntry, "id" | "at">,
  at: number,
  id: string,
): JournalEntry[] {
  if (JSON.stringify(change.from) === JSON.stringify(change.to)) return [...journal];
  const [latest, ...rest] = journal;
  if (latest && latest.key === change.key) {
    if (JSON.stringify(latest.from) === JSON.stringify(change.to)) return rest;
    return [{ ...change, from: latest.from, id, at }, ...rest];
  }
  return [{ ...change, id, at }, ...journal].slice(0, JOURNAL_LIMIT);
}

/** The journal without an entry, once it has been undone. */
export function withoutEntry(journal: readonly JournalEntry[], id: string): JournalEntry[] {
  return journal.filter((entry) => entry.id !== id);
}

const KEYS: ReadonlySet<string> = new Set([
  "dark",
  "themeFamily",
  "accent",
  "reducedMotion",
  "uiScale",
  "showDesktopIcons",
  "panelFullWidth",
  "panelIconsOnly",
  "wallpaper",
  "indexingEnabled",
  "indexExcludes",
  "indexIncludes",
  "region",
  "nightLight",
  "autoDark",
  "doNotDisturb",
]);

/** Parse the journal file; malformed entries are dropped, a missing file is empty. */
export function parseJournal(value: unknown): JournalEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is JournalEntry =>
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.key === "string" &&
        KEYS.has(item.key) &&
        typeof item.at === "number" &&
        typeof item.page === "string" &&
        typeof item.label === "string" &&
        "from" in item,
    )
    .slice(0, JOURNAL_LIMIT);
}

export function loadJournal(): JournalEntry[] {
  try {
    return parseJournal(JSON.parse(fs.readFileSync(historyPath(), "utf8")));
  } catch {
    return [];
  }
}

export type JournalWrite = { ok: true } | { ok: false; message: string };

export function saveJournal(journal: readonly JournalEntry[]): JournalWrite {
  const file = historyPath();
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    return { ok: true };
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    return {
      ok: false,
      message: `Couldn't save recent changes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const newEntryId = () => randomUUID();
