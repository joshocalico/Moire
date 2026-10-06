import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseDocument, type DocumentRun } from "@moire/ui";
export type Note = {
  id: string;
  title: string;
  /** Canonical plain text remains available to search and v1 migration. */
  body: string;
  runs: readonly DocumentRun[];
  notebookId: string;
  pinned: boolean;
  updatedAt: number;
};
export type NoteNotebook = { id: string; title: string };
export type Notebook = { notes: Note[]; notebooks: NoteNotebook[]; revision: string | null };
export const LOCAL_NOTEBOOK_ID = "local";
export const emptyNotebook = (): Notebook => ({
  notes: [],
  notebooks: [{ id: LOCAL_NOTEBOOK_ID, title: "Notes" }],
  revision: null,
});
function parseNotebook(value: unknown): Omit<Notebook, "revision"> {
  const invalid = () =>
    new Error("Notes storage is invalid. The original file has been preserved.");
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    (value.version !== 1 && value.version !== 2) ||
    !("notes" in value) ||
    !Array.isArray(value.notes)
  )
    throw invalid();
  const notebooks: NoteNotebook[] = [];
  const notebookIds = new Set<string>();
  if (value.version === 1) notebooks.push({ id: LOCAL_NOTEBOOK_ID, title: "Notes" });
  else {
    if (!("notebooks" in value) || !Array.isArray(value.notebooks) || !value.notebooks.length)
      throw invalid();
    for (const entry of value.notebooks) {
      const item: unknown = entry;
      if (
        typeof item !== "object" ||
        item === null ||
        !("id" in item) ||
        typeof item.id !== "string" ||
        !item.id ||
        notebookIds.has(item.id) ||
        !("title" in item) ||
        typeof item.title !== "string" ||
        !item.title.trim()
      )
        throw invalid();
      notebookIds.add(item.id);
      notebooks.push({ id: item.id, title: item.title });
    }
    if (!notebookIds.has(LOCAL_NOTEBOOK_ID)) throw invalid();
  }
  const notes: Note[] = [],
    ids = new Set<string>();
  for (const entry of value.notes) {
    const note: unknown = entry;
    if (
      typeof note !== "object" ||
      note === null ||
      !("id" in note) ||
      typeof note.id !== "string" ||
      !note.id ||
      ids.has(note.id) ||
      !("title" in note) ||
      typeof note.title !== "string" ||
      !("body" in note) ||
      typeof note.body !== "string" ||
      !("updatedAt" in note) ||
      typeof note.updatedAt !== "number" ||
      !Number.isFinite(note.updatedAt)
    )
      throw invalid();
    let runs: readonly DocumentRun[] = [],
      notebookId = LOCAL_NOTEBOOK_ID,
      pinned = false;
    if (value.version === 2) {
      if (
        !("runs" in note) ||
        !("notebookId" in note) ||
        typeof note.notebookId !== "string" ||
        !notebookIds.has(note.notebookId) ||
        !("pinned" in note) ||
        typeof note.pinned !== "boolean"
      )
        throw invalid();
      runs = parseDocument({ text: note.body, runs: note.runs }).runs;
      notebookId = note.notebookId;
      pinned = note.pinned;
    }
    ids.add(note.id);
    notes.push({
      id: note.id,
      title: note.title,
      body: note.body,
      runs,
      notebookId,
      pinned,
      updatedAt: note.updatedAt,
    });
  }
  return { notes, notebooks };
}
const MAX_STORAGE_BYTES = 10 * 1024 * 1024;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function claimWriteLock(file: string): () => void {
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd: number;
    try {
      fd = fs.openSync(file, "wx", 0o600);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      const owner = fs.readFileSync(file, "utf8");
      const pid = Number(owner);
      let stale = false;
      if (/^\d+$/.test(owner) && Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (failure) {
          stale = failure instanceof Error && "code" in failure && failure.code === "ESRCH";
        }
      } else {
        stale = Date.now() - fs.statSync(file).mtimeMs > 30_000;
      }
      if (!stale) throw new Error("Another Notes window is saving. Try again shortly.");
      if (fs.readFileSync(file, "utf8") === owner) fs.unlinkSync(file);
      continue;
    }
    try {
      fs.writeFileSync(fd, String(process.pid), "utf8");
    } catch (error) {
      fs.unlinkSync(file);
      throw error;
    } finally {
      fs.closeSync(fd);
    }
    return () => fs.unlinkSync(file);
  }
  throw new Error("Notes storage is busy. Try again shortly.");
}

export class NotesStore {
  readonly file: string;
  constructor(
    directory = path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
      "moire",
      "notes",
    ),
  ) {
    this.file = path.join(directory, "notes.json");
  }
  load(): Notebook {
    if (!fs.existsSync(this.file)) return emptyNotebook();
    if (fs.statSync(this.file).size > MAX_STORAGE_BYTES)
      throw new Error("Notes storage is too large to open.");
    const content = fs.readFileSync(this.file, "utf8");
    const value: unknown = JSON.parse(content);
    return { ...parseNotebook(value), revision: hash(content) };
  }
  save(notebook: Notebook): Notebook {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const lock = path.join(path.dirname(this.file), ".write-lock");
    const release = claimWriteLock(lock);
    try {
      const actual = this.load();
      if (actual.revision !== notebook.revision)
        throw new Error(
          "Notes changed in another window. Reload before editing; your draft remains here.",
        );
      const parsed = parseNotebook({
        version: 2,
        notes: notebook.notes,
        notebooks: notebook.notebooks,
      });
      const content = JSON.stringify({ version: 2, ...parsed }, null, 2) + "\n";
      if (Buffer.byteLength(content, "utf8") > MAX_STORAGE_BYTES)
        throw new Error(
          "Notes storage exceeds 10 MiB. Shorten the draft or remove notes before saving; your draft remains here.",
        );
      const temporary = path.join(path.dirname(this.file), `.notes-${randomUUID()}.tmp`);
      let fd: number | null = null;
      try {
        fd = fs.openSync(temporary, "wx", 0o600);
        fs.writeFileSync(fd, content, "utf8");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(temporary, this.file);
      } finally {
        if (fd !== null) fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      return { ...parsed, revision: hash(content) };
    } finally {
      release();
    }
  }
}
export const createNote = (notebookId = LOCAL_NOTEBOOK_ID): Note => ({
  id: randomUUID(),
  title: "Untitled note",
  body: "",
  runs: [],
  notebookId,
  pinned: false,
  updatedAt: Date.now(),
});
export const createNotebook = (title: string): NoteNotebook => {
  const name = title.trim();
  if (!name) throw new Error("Give the notebook a name.");
  return { id: randomUUID(), title: name };
};
export function filterNotes(notes: readonly Note[], query: string): Note[] {
  const needle = query.trim().toLocaleLowerCase();
  return notes
    .filter((note) => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
