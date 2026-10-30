/** Notes' browsing state and notebook edits as pure functions; storage lives in store.ts. */
import { LOCAL_NOTEBOOK_ID, type Note, type Notebook } from "./store";

export type NotesView = { kind: "all" } | { kind: "pinned" } | { kind: "notebook"; id: string };
export const ALL_NOTES: NotesView = { kind: "all" };

/** Sidebar row ids; notebooks are prefixed so a notebook id can never collide with a view. */
export const viewKey = (view: NotesView): string =>
  view.kind === "notebook" ? `notebook:${view.id}` : view.kind;
export function parseViewKey(key: string): NotesView {
  if (key === "pinned") return { kind: "pinned" };
  if (key.startsWith("notebook:")) return { kind: "notebook", id: key.slice("notebook:".length) };
  return ALL_NOTES;
}

/** Notes matching the query by title or text, most recently edited first. */
export function filterNotes(notes: readonly Note[], query: string): Note[] {
  const needle = query.trim().toLocaleLowerCase();
  return notes
    .filter((note) => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function notesInView(notes: readonly Note[], view: NotesView, query: string): Note[] {
  return filterNotes(
    notes.filter((note) =>
      view.kind === "all"
        ? true
        : view.kind === "pinned"
          ? note.pinned
          : note.notebookId === view.id,
    ),
    query,
  );
}

export const notebookTitle = (book: Notebook, id: string): string =>
  book.notebooks.find((notebook) => notebook.id === id)?.title ?? "Notes";
export function viewTitle(book: Notebook, view: NotesView): string {
  if (view.kind === "all") return "All notes";
  if (view.kind === "pinned") return "Pinned notes";
  return notebookTitle(book, view.id);
}
/** New notes go to the notebook being viewed, or the local notebook from All/Pinned. */
export const notebookForNewNote = (view: NotesView): string =>
  view.kind === "notebook" ? view.id : LOCAL_NOTEBOOK_ID;

export const noteCount = (count: number) => `${count} ${count === 1 ? "note" : "notes"}`;
export const matchCount = (count: number) => `${count} ${count === 1 ? "match" : "matches"}`;
export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/u).length : 0);

/** What the list shows and which note the editor holds. */
export type Browse = { view: NotesView; query: string; selected: string | null };
export const initialBrowse = (book: Notebook): Browse => ({
  view: ALL_NOTES,
  query: "",
  selected: filterNotes(book.notes, "")[0]?.id ?? null,
});
/** Keep the selection when it is still listed; otherwise select the first listed note, so the
 * editor never edits a note the list does not show. */
export function reselect(book: Notebook, browse: Browse): Browse {
  const listed = notesInView(book.notes, browse.view, browse.query);
  const selected = listed.some((note) => note.id === browse.selected)
    ? browse.selected
    : (listed[0]?.id ?? null);
  return { ...browse, selected };
}
export const showView = (book: Notebook, browse: Browse, view: NotesView): Browse =>
  reselect(book, { ...browse, view, query: "" });
export const search = (book: Notebook, browse: Browse, query: string): Browse =>
  reselect(book, { ...browse, query });

export type NotePatch = Partial<Pick<Note, "title" | "body" | "runs" | "notebookId" | "pinned">>;
export function editNote(book: Notebook, id: string, patch: NotePatch, now: number): Notebook {
  return {
    ...book,
    notes: book.notes.map((note) =>
      note.id === id ? { ...note, ...patch, updatedAt: now } : note,
    ),
  };
}
export const removeNote = (book: Notebook, id: string): Notebook => ({
  ...book,
  notes: book.notes.filter((note) => note.id !== id),
});

/** Plain-text export: the title as a heading line, then the note's text. */
export function exportText(note: Note, file: string): string {
  const title = note.title.trim() || "Untitled note";
  const heading = /\.(md|markdown)$/i.test(file) ? `# ${title}` : title;
  return `${heading}\n\n${note.body.replace(/\s+$/u, "")}\n`;
}
/** A file name from the note title, without characters that are awkward in paths. */
export function exportName(note: Note): string {
  const base = note.title
    .replace(/[/\\:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  return `${base || "Untitled note"}.txt`;
}

/** The one popup or dialog Notes shows at a time. */
export type Overlay =
  | { kind: "none" }
  | { kind: "menu"; menu: "actions" | "move"; x: number; y: number }
  | { kind: "confirm"; action: "delete" | "reload" }
  | { kind: "export" };
export const NO_OVERLAY: Overlay = { kind: "none" };

/** Order of the note actions menu; smokes drive the menu by keyboard through this list. */
export const NOTE_ACTIONS = ["rename", "pin", "move", "export", "reload", "delete"] as const;
export type NoteAction = (typeof NOTE_ACTIONS)[number];
