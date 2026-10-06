import os from "node:os";
import path from "node:path";
import {
  loadSnapshot,
  writeSnapshot,
  type StoreCleanup,
  type StoreSnapshot,
} from "@moire/app-tools/local-store";
import { parseTrack, type Track } from "./library";

export type QueueEntry = { id: string; track: Track };
export type QueueData = {
  entries: readonly QueueEntry[];
  currentEntryId: string | null;
  position: number;
};
export type QueueSnapshot = QueueData & { revision: string | null };
type QueueRecord = QueueData & { version: 1 };
const emptyQueue = (): QueueData => ({ entries: [], currentEntryId: null, position: 0 });
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const entryId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 1024 &&
  !value.includes("\0");
function invalid(): never {
  throw new Error("Saved Music queue is invalid. The original queue is preserved.");
}
function parseQueue(data: unknown): QueueRecord[] {
  if (!Array.isArray(data) || data.length > 1) invalid();
  if (data.length === 0) return [];
  const value: unknown = data[0];
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 5000 ||
    typeof value.position !== "number" ||
    !Number.isFinite(value.position) ||
    value.position < 0
  )
    invalid();
  const entries: QueueEntry[] = [];
  const ids = new Set<string>();
  for (const raw of value.entries) {
    const entry: unknown = raw;
    if (!object(entry) || !entryId(entry.id) || ids.has(entry.id)) invalid();
    ids.add(entry.id);
    entries.push({ id: entry.id, track: parseTrack(entry.track) });
  }
  const current = value.currentEntryId;
  if (entries.length === 0) {
    if (current !== null || value.position !== 0) invalid();
  } else if (!entryId(current) || !ids.has(current)) invalid();
  return [{ version: 1, entries, currentEntryId: current, position: value.position }];
}
function snapshot(data: StoreSnapshot<QueueRecord>): QueueSnapshot {
  const first = data.items[0];
  return {
    ...(first
      ? { entries: first.entries, currentEntryId: first.currentEntryId, position: first.position }
      : emptyQueue()),
    revision: data.revision,
  };
}

/** Queue identities describe occurrences, so the same track can appear repeatedly. */
export class MusicQueueStore {
  readonly directory: string;
  readonly file: string;
  constructor(
    directory = path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"),
      "moire/music",
    ),
  ) {
    this.directory = directory;
    this.file = path.join(directory, "queue.json");
  }
  load(): QueueSnapshot {
    return snapshot(loadSnapshot(this.file, parseQueue));
  }
  save(data: QueueSnapshot): QueueSnapshot & { cleanup: StoreCleanup } {
    const written = writeSnapshot<QueueRecord>(
      this.file,
      [
        {
          version: 1,
          entries: data.entries,
          currentEntryId: data.currentEntryId,
          position: data.position,
        },
      ],
      data.revision,
      parseQueue,
    );
    return { ...snapshot(written), cleanup: written.cleanup };
  }
}
