/** Row-level reads and writes over the index database; callers batch them in transactions. */
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { foldText } from "@moire/system-management/index-status";
import type { FileKind } from "@moire/file-operations";
import { TEXT_NONE, TEXT_PENDING, TEXT_STORED } from "./schema";

/** What the walker learned about one directory entry. */
export type EntryFacts = {
  path: string;
  name: string;
  dir: string;
  kind: FileKind;
  isDir: boolean;
  size: number;
  mtime: number;
  atime: number;
  hidden: boolean;
  /** Whether its text should be extracted (a supported type within the size cap). */
  textual: boolean;
};
export type ChildRow = { id: number; isDir: boolean; size: number; mtime: number };
export type PendingText = { id: number; path: string; name: string; size: number; mtime: number };

/**
 * Bounds for "strictly below `folder`" as a range on the unique path index: every descendant
 * sorts between `folder/` and `folder0`, because `0` is the character after `/`.
 */
export function descendantRange(folder: string): [lower: string, upper: string] {
  const base = folder.endsWith(path.sep) ? folder : folder + path.sep;
  return [base, base.slice(0, -1) + String.fromCharCode(path.sep.charCodeAt(0) + 1)];
}

export class IndexStore {
  private readonly statements = new Map<string, StatementSync>();

  constructor(readonly db: DatabaseSync) {}

  /** Statements are prepared once; the walker runs the same few thousands of times. */
  prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  transaction<T>(run: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  children(dir: string): Map<string, ChildRow> {
    const rows = this.prepare("SELECT id, name, is_dir, size, mtime FROM files WHERE dir = ?").all(
      dir,
    );
    return new Map(
      rows.map((row) => [
        String(row.name),
        {
          id: Number(row.id),
          isDir: row.is_dir === 1,
          size: Number(row.size),
          mtime: Number(row.mtime),
        },
      ]),
    );
  }

  has(file: string): boolean {
    return this.prepare("SELECT 1 FROM files WHERE path = ?").get(file) !== undefined;
  }

  insert(entry: EntryFacts): void {
    this.prepare(
      `INSERT INTO files (path, name, dir, kind, is_dir, size, mtime, atime, hidden, content_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.path,
      entry.name,
      entry.dir,
      entry.kind,
      entry.isDir ? 1 : 0,
      entry.size,
      Math.trunc(entry.mtime),
      Math.trunc(entry.atime),
      entry.hidden ? 1 : 0,
      entry.textual ? TEXT_PENDING : TEXT_NONE,
    );
  }

  /** A changed file's old text is dropped now so searches never show stale excerpts. */
  update(id: number, entry: EntryFacts): void {
    this.prepare(
      `UPDATE files SET kind = ?, size = ?, mtime = ?, atime = ?, content_state = ?, taken = NULL
       WHERE id = ?`,
    ).run(
      entry.kind,
      entry.size,
      Math.trunc(entry.mtime),
      Math.trunc(entry.atime),
      entry.textual ? TEXT_PENDING : TEXT_NONE,
      id,
    );
    this.prepare("DELETE FROM content WHERE rowid = ?").run(id);
  }

  /** Remove one entry and, for a folder, everything indexed below it. */
  remove(file: string, isDir: boolean): number {
    let removed = Number(this.prepare("DELETE FROM files WHERE path = ?").run(file).changes);
    if (isDir) removed += this.removeBelow(file);
    return removed;
  }

  removeBelow(folder: string): number {
    const [lower, upper] = descendantRange(folder);
    return Number(
      this.prepare("DELETE FROM files WHERE path >= ? AND path < ?").run(lower, upper).changes,
    );
  }

  pendingText(limit: number): PendingText[] {
    return this.prepare(
      `SELECT id, path, name, size, mtime FROM files WHERE content_state = ${TEXT_PENDING} LIMIT ?`,
    )
      .all(limit)
      .map((row) => ({
        id: Number(row.id),
        path: String(row.path),
        name: String(row.name),
        size: Number(row.size),
        mtime: Number(row.mtime),
      }));
  }

  /**
   * Store extracted text unless the file changed while it was being read; the walker has then
   * queued it again. `body` null means there was nothing to store.
   */
  storeText(item: PendingText, body: string | null, taken: number | null): void {
    const updated = this.prepare(
      `UPDATE files SET content_state = ?, taken = ? WHERE id = ? AND mtime = ? AND content_state = ${TEXT_PENDING}`,
    ).run(body ? TEXT_STORED : TEXT_NONE, taken, item.id, Math.trunc(item.mtime));
    if (!updated.changes) return;
    this.prepare("DELETE FROM content WHERE rowid = ?").run(item.id);
    if (body) this.prepare("INSERT INTO content (rowid, body) VALUES (?, ?)").run(item.id, body);
  }

  /** Queue every textual file below `folder` (or everywhere) for extraction again. */
  requeueText(folder: string | null): void {
    const set = `UPDATE files SET content_state = ${TEXT_PENDING} WHERE content_state = ${TEXT_STORED}`;
    if (!folder) {
      this.prepare(set).run();
      return;
    }
    const [lower, upper] = descendantRange(folder);
    this.prepare(`${set} AND path >= ? AND path < ?`).run(lower, upper);
  }

  replaceTags(tags: ReadonlyMap<string, readonly string[]>): void {
    this.transaction(() => {
      this.prepare("DELETE FROM tags").run();
      const insert = this.prepare(
        "INSERT OR IGNORE INTO tags (path, tag, folded) VALUES (?, ?, ?)",
      );
      for (const [file, names] of tags)
        for (const tag of names) insert.run(file, tag, foldText(tag));
    });
  }

  counts(): { files: number; folders: number; withText: number; pendingText: number } {
    const row = this.prepare(
      `SELECT
         COALESCE(SUM(is_dir = 0), 0) AS files,
         COALESCE(SUM(is_dir = 1), 0) AS folders,
         COALESCE(SUM(content_state = ${TEXT_STORED}), 0) AS with_text,
         COALESCE(SUM(content_state = ${TEXT_PENDING}), 0) AS pending
       FROM files`,
    ).get();
    return {
      files: Number(row?.files ?? 0),
      folders: Number(row?.folders ?? 0),
      withText: Number(row?.with_text ?? 0),
      pendingText: Number(row?.pending ?? 0),
    };
  }

  meta(key: string): string | null {
    const row = this.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }
}
