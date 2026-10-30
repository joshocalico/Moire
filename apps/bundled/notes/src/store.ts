import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseDocument, type DocumentRun } from "@moire/ui";
import { loadDocument, writeDocument, type StoreCleanup } from "@moire/app-tools/local-store";
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
type NotebookRecord = { version: 2; notes: Note[]; notebooks: NoteNotebook[] };
const parseRecord = (value: unknown): NotebookRecord => ({ version: 2, ...parseNotebook(value) });

/** Notes keeps every notebook in one JSON document under the user's data directory. */
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
    const { value, revision } = loadDocument(this.file, parseRecord);
    return value ? { notes: value.notes, notebooks: value.notebooks, revision } : emptyNotebook();
  }
  /** Throws when another window saved first; the caller keeps its draft. */
  save(notebook: Notebook): Notebook & { cleanup: StoreCleanup } {
    const record = parseRecord({
      version: 2,
      notes: notebook.notes,
      notebooks: notebook.notebooks,
    });
    const written = writeDocument(this.file, record, notebook.revision, parseRecord);
    return {
      notes: written.value.notes,
      notebooks: written.value.notebooks,
      revision: written.revision,
      cleanup: written.cleanup,
    };
  }
}
/**
 * Writes a note as text. The file chooser has already confirmed replacing an existing file; the
 * write goes through a temporary sibling so a failure never leaves a half-written file.
 */
export function exportNote(file: string, text: string): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o644 });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
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
