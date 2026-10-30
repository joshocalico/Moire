/**
 * The index database. It is a cache: when `SCHEMA_VERSION` changes the file is deleted and
 * rebuilt by the next crawl, never migrated in place.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** 2: PDF text is extracted, so indexes built without it are rebuilt to pick it up. */
export const SCHEMA_VERSION = 2;

/** `content_state`: whether a file's text is waiting for extraction, stored, or not applicable. */
export const TEXT_PENDING = 0;
export const TEXT_STORED = 1;
export const TEXT_NONE = 2;

/** SQLite's page cache, in KiB (negative means KiB); small, to keep the service's RSS low. */
const PAGE_CACHE_KIB = 4096;

const SCHEMA = `
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  dir TEXT NOT NULL,
  kind TEXT NOT NULL,
  is_dir INTEGER NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  atime INTEGER NOT NULL,
  hidden INTEGER NOT NULL,
  content_state INTEGER NOT NULL,
  taken INTEGER
);
CREATE INDEX files_dir ON files(dir);
CREATE INDEX files_mtime ON files(mtime);
CREATE INDEX files_pending ON files(content_state) WHERE content_state = ${TEXT_PENDING};

-- Trigram names match any substring of three or more characters, as people type them.
CREATE VIRTUAL TABLE names USING fts5(name, tokenize = 'trigram remove_diacritics 1');
-- Words in extracted text, matched by prefix.
CREATE VIRTUAL TABLE content USING fts5(body, tokenize = 'unicode61 remove_diacritics 2');

CREATE TRIGGER files_insert AFTER INSERT ON files BEGIN
  INSERT INTO names(rowid, name) VALUES (new.id, new.name);
END;
CREATE TRIGGER files_rename AFTER UPDATE OF name ON files BEGIN
  UPDATE names SET name = new.name WHERE rowid = new.id;
END;
CREATE TRIGGER files_delete AFTER DELETE ON files BEGIN
  DELETE FROM names WHERE rowid = old.id;
  DELETE FROM content WHERE rowid = old.id;
END;

CREATE TABLE tags (
  path TEXT NOT NULL,
  tag TEXT NOT NULL,
  folded TEXT NOT NULL,
  PRIMARY KEY (path, tag)
) WITHOUT ROWID;
CREATE INDEX tags_folded ON tags(folded);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`;

function removeDatabaseFiles(file: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(file + suffix, { force: true });
}

function schemaVersion(db: DatabaseSync): number {
  return Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
}

/**
 * Open the index, rebuilding it when its schema version differs or it cannot be read.
 * `version` exists so a smoke can prove a bump rebuilds; the service always uses the default.
 */
export function openIndexDatabase(
  file: string,
  version = SCHEMA_VERSION,
): { db: DatabaseSync; rebuilt: boolean } {
  const memory = file === ":memory:";
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let rebuilt = false;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file);
    if (schemaVersion(db) !== version) {
      rebuilt = schemaVersion(db) !== 0;
      if (!memory) {
        db.close();
        removeDatabaseFiles(file);
        db = new DatabaseSync(file);
      }
      createSchema(db, version);
    }
  } catch (error) {
    // A corrupt cache is rebuilt, not reported: nothing in it is the user's data.
    db?.close();
    if (memory) throw error;
    removeDatabaseFiles(file);
    db = new DatabaseSync(file);
    createSchema(db, version);
    rebuilt = true;
  }
  configure(db, memory);
  return { db, rebuilt };
}

function createSchema(db: DatabaseSync, version: number): void {
  db.exec("BEGIN");
  try {
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${Math.trunc(version)}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function configure(db: DatabaseSync, memory: boolean): void {
  if (!memory) {
    // WAL lets searches read while a crawl batch commits.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  db.exec(`PRAGMA cache_size = -${PAGE_CACHE_KIB}`);
  db.exec("PRAGMA temp_store = MEMORY");
}

/** Delete the index and everything SQLite keeps beside it (indexing was turned off). */
export function deleteIndexDatabase(file: string): void {
  removeDatabaseFiles(file);
}

/**
 * Prove this Node's SQLite has what the index needs: FTS5 with both tokenizers. The nix build
 * runs it so an image whose Node lacks them fails to build instead of failing in a session.
 */
export function checkSqliteSupport(): string {
  const { db } = openIndexDatabase(":memory:");
  try {
    db.prepare(
      "INSERT INTO files (path, name, dir, kind, is_dir, size, mtime, atime, hidden, content_state) VALUES (?, ?, ?, 'document', 0, 1, 0, 0, 0, 0)",
    ).run("/check/Quarterly Report.txt", "Quarterly Report.txt", "/check");
    db.prepare("INSERT INTO content (rowid, body) VALUES (1, 'naïve budget figures')").run();
    const name = db.prepare("SELECT rowid FROM names WHERE names MATCH ?").get('"report"');
    const text = db.prepare("SELECT rowid FROM content WHERE content MATCH ?").get('"naive"*');
    if (name?.rowid !== 1 || text?.rowid !== 1) throw new Error("FTS5 queries returned no rows");
    return String(db.prepare("SELECT sqlite_version() AS version").get()?.version);
  } finally {
    db.close();
  }
}
