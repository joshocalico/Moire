/**
 * Archive Manager's state: the open archive as a listing plus a pending change set (add, remove,
 * rename, new folder), the running extract/save task, and which dialog is up. Pure functions
 * only; the hook in use-archive.ts performs the I/O these states ask for.
 */
import path from "node:path";

/** Where an entry's content comes from when the archive is written. */
export type Origin =
  | { kind: "member"; member: string }
  | { kind: "source"; path: string }
  | { kind: "new" };

/** One file or folder in the (edited) archive. `path` is relative, "/"-separated, no trailing slash. */
export type Entry = { path: string; folder: boolean; origin: Origin };

export type Change =
  | { kind: "add"; parent: string; source: string; folder: boolean }
  | { kind: "remove"; path: string }
  | { kind: "rename"; path: string; name: string }
  | { kind: "create-folder"; parent: string; name: string };

export type WritableFormat = "tar.gz" | "tar" | "zip";

export type ArchiveDocument = {
  /** null until a new archive is first saved. */
  file: string | null;
  /** The format Save rewrites in place, or null when the open file's format is read-only. */
  format: WritableFormat | null;
  base: Entry[];
  changes: Change[];
  entries: Entry[];
  selected: string | null;
};

export type Job = "extract" | "save";
export type Task =
  | { kind: "idle" }
  | { kind: "running"; job: Job; done: number; total: number; target: string }
  | { kind: "finished"; job: Job; output: string }
  | { kind: "failed"; job: Job; message: string };

/** What to do once unsaved changes are saved or discarded. */
export type Pending =
  | { kind: "open"; file: string }
  | { kind: "browse" }
  | { kind: "new" }
  | { kind: "close" };

export type ChooserPurpose = "open" | "add-files" | "add-folder" | "save-as" | "extract-to";

export type Dialog =
  | null
  | { kind: "chooser"; purpose: ChooserPurpose }
  | { kind: "rename"; path: string }
  | { kind: "new-folder" }
  | { kind: "discard"; next: Pending };

export type Screen =
  | { kind: "start"; error?: string }
  | { kind: "loading"; file: string }
  | { kind: "document"; doc: ArchiveDocument };

export type State = {
  screen: Screen;
  task: Task;
  dialog: Dialog;
  notice: string;
};

export const initialState: State = {
  screen: { kind: "start" },
  task: { kind: "idle" },
  dialog: null,
  notice: "",
};

const WRITABLE: ReadonlyArray<[string, WritableFormat]> = [
  [".tar.gz", "tar.gz"],
  [".tgz", "tar.gz"],
  [".tar", "tar"],
  [".zip", "zip"],
];
const ARCHIVE_EXTENSIONS = [
  ".tar.gz",
  ".tar.xz",
  ".tar.bz2",
  ".tar.zst",
  ".tgz",
  ".txz",
  ".tbz2",
  ".tar",
  ".zip",
  ".7z",
  ".rar",
  ".gz",
  ".xz",
  ".bz2",
  ".zst",
  ".iso",
  ".cpio",
];

/** The format an archive name can be written in, from its extension. */
export function writableFormat(file: string): WritableFormat | null {
  const lower = file.toLowerCase();
  return WRITABLE.find(([extension]) => lower.endsWith(extension))?.[1] ?? null;
}

/** An archive's name without its archive extension: "photos.tar.gz" → "photos". */
export function archiveStem(file: string): string {
  const name = path.basename(file);
  const lower = name.toLowerCase();
  const extension = ARCHIVE_EXTENSIONS.find((ext) => lower.endsWith(ext) && lower !== ext);
  return extension ? name.slice(0, -extension.length) : name;
}

/** A Save as name that the backend can write: adds .tar.gz to names without a writable extension. */
export function withWritableExtension(file: string): string {
  return writableFormat(file) ? file : `${file}.tar.gz`;
}

/** Why the open archive can't be edited in place, for the note shown above its contents. */
export function readOnlyReason(doc: ArchiveDocument): string | null {
  if (doc.format || !doc.file) return null;
  const name = path.basename(doc.file);
  const extension = name.includes(".") ? name.slice(name.indexOf(".")) : "this";
  return `Editing isn't available for ${extension} archives. Use Save as… to make an editable .tar.gz copy, or extract it.`;
}

/** Folders that hold entries but have no entry of their own (tar files may omit them). */
function withParents(entries: Entry[]): Entry[] {
  const known = new Set(entries.map((entry) => entry.path));
  const out = [...entries];
  for (const entry of entries)
    for (let parent = path.posix.dirname(entry.path); parent !== ".";) {
      if (!known.has(parent)) {
        known.add(parent);
        out.push({ path: parent, folder: true, origin: { kind: "new" } });
      }
      parent = path.posix.dirname(parent);
    }
  return sortEntries(out);
}

/** Folders before files at each level, then by name: the order a tree reads in. */
export function sortEntries(entries: Entry[]): Entry[] {
  const key = (entry: Entry) =>
    entry.path
      .split("/")
      .map((part, index, parts) => (index === parts.length - 1 && !entry.folder ? "1" : "0") + part)
      .join("/");
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return [...entries].sort((a, b) => collator.compare(key(a), key(b)));
}

/** The entries a bsdtar listing describes ("folder/", "folder/file", "./x"). */
export function entriesFromListing(listing: readonly string[]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const raw of listing) {
    const member = path.posix.normalize(raw.replace(/\/$/, "")).replace(/^\.\//, "");
    if (!member || member === ".") continue;
    entries.set(member, {
      path: member,
      folder: raw.endsWith("/"),
      origin: { kind: "member", member },
    });
  }
  return withParents([...entries.values()]);
}

export class EditError extends Error {}

function validName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new EditError("Enter a name.");
  if (trimmed === "." || trimmed === ".." || /[/\\\0]/.test(trimmed))
    throw new EditError("Names can't contain / or \\, or be . or ..");
  return trimmed;
}

function within(entry: string, folder: string): boolean {
  return entry === folder || entry.startsWith(`${folder}/`);
}

function free(entries: Entry[], target: string): void {
  if (entries.some((entry) => entry.path === target))
    throw new EditError(`There is already an item named "${path.posix.basename(target)}" there.`);
}

/** Apply one edit, or throw an EditError the window shows. */
export function applyChange(entries: Entry[], change: Change): Entry[] {
  const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);
  const folderExists = (parent: string) =>
    !parent || entries.some((entry) => entry.path === parent && entry.folder);
  switch (change.kind) {
    case "add": {
      if (!folderExists(change.parent)) throw new EditError("Add items to a folder.");
      const target = join(change.parent, validName(path.basename(change.source)));
      free(entries, target);
      return sortEntries([
        ...entries,
        {
          path: target,
          folder: change.folder,
          origin: { kind: "source", path: change.source },
        },
      ]);
    }
    case "create-folder": {
      if (!folderExists(change.parent)) throw new EditError("Create folders inside a folder.");
      const target = join(change.parent, validName(change.name));
      free(entries, target);
      return sortEntries([...entries, { path: target, folder: true, origin: { kind: "new" } }]);
    }
    case "remove":
      if (!entries.some((entry) => entry.path === change.path))
        throw new EditError("That item is no longer in the archive.");
      return entries.filter((entry) => !within(entry.path, change.path));
    case "rename": {
      const parent = path.posix.dirname(change.path);
      const target = join(parent === "." ? "" : parent, validName(change.name));
      if (target === change.path) return entries;
      free(entries, target);
      return sortEntries(
        entries.map((entry) =>
          within(entry.path, change.path)
            ? { ...entry, path: target + entry.path.slice(change.path.length) }
            : entry,
        ),
      );
    }
  }
}

export function openDocument(
  file: string | null,
  listing: readonly string[],
  kind: "archive" | "gzip" = "archive",
): ArchiveDocument {
  const base = entriesFromListing(listing);
  return {
    file,
    // A plain .gz file is one compressed file, not an archive that can hold others.
    format: file && kind === "archive" ? writableFormat(file) : null,
    base,
    changes: [],
    entries: base,
    selected: null,
  };
}

/** A new archive has unsaved changes once anything is in it. */
export function isDirty(doc: ArchiveDocument): boolean {
  return doc.changes.length > 0;
}

/** The folder new items go into: the selected folder, or the selected file's folder. */
export function targetFolder(doc: ArchiveDocument): string {
  const selected = doc.entries.find((entry) => entry.path === doc.selected);
  if (!selected) return "";
  if (selected.folder) return selected.path;
  const parent = path.posix.dirname(selected.path);
  return parent === "." ? "" : parent;
}

/** A short tag for entries the change set touched. */
export function entryTag(entry: Entry): string | undefined {
  if (entry.origin.kind === "source") return "Added";
  if (entry.origin.kind === "member" && entry.origin.member !== entry.path) return "Renamed";
  return undefined;
}

/** Where Extract puts an archive by default: a folder named after it, beside it. */
export function extractionName(file: string): string {
  return archiveStem(file);
}

/** Save as's suggested name: the open archive's name, or one taken from what's in a new one. */
export function suggestedName(doc: ArchiveDocument): string {
  if (doc.file) return `${archiveStem(doc.file)}.${doc.format ?? "tar.gz"}`;
  const top = doc.entries.filter((entry) => !entry.path.includes("/"));
  return `${top.length === 1 ? top[0]!.path.replace(/\.[^.]+$/, "") : "Archive"}.tar.gz`;
}

export type Action =
  | { type: "loading"; file: string }
  | { type: "opened"; doc: ArchiveDocument }
  | { type: "open-failed"; message: string }
  | { type: "new" }
  | { type: "select"; path: string | null }
  | { type: "edit"; change: Change }
  | { type: "dialog"; dialog: Dialog }
  | { type: "notice"; notice: string }
  | { type: "task-started"; job: Job; target: string; total: number }
  | { type: "task-progress"; done: number; total?: number }
  | { type: "task-finished"; output: string }
  | { type: "task-failed"; message: string }
  | { type: "task-dismissed" };

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "loading":
      return {
        ...state,
        screen: { kind: "loading", file: action.file },
        dialog: null,
        notice: "",
      };
    case "opened":
      return {
        ...state,
        screen: { kind: "document", doc: action.doc },
        dialog: null,
      };
    case "open-failed":
      return { ...state, screen: { kind: "start", error: action.message } };
    case "new":
      return {
        ...state,
        screen: { kind: "document", doc: openDocument(null, []) },
        task: { kind: "idle" },
        dialog: null,
        notice: "",
      };
    case "select":
      return state.screen.kind === "document"
        ? {
            ...state,
            screen: {
              kind: "document",
              doc: { ...state.screen.doc, selected: action.path },
            },
          }
        : state;
    case "edit": {
      if (state.screen.kind !== "document") return state;
      const doc = state.screen.doc;
      try {
        const entries = applyChange(doc.entries, action.change);
        const selected =
          action.change.kind === "remove"
            ? null
            : action.change.kind === "rename"
              ? (entries.find((entry) => !doc.entries.some((old) => old.path === entry.path))
                  ?.path ?? doc.selected)
              : doc.selected;
        return {
          ...state,
          screen: {
            kind: "document",
            doc: {
              ...doc,
              entries,
              selected,
              changes: [...doc.changes, action.change],
            },
          },
          dialog: null,
          notice: "",
        };
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        return { ...state, notice: error.message };
      }
    }
    case "dialog":
      return { ...state, dialog: action.dialog };
    case "notice":
      return { ...state, notice: action.notice };
    case "task-started":
      return {
        ...state,
        task: {
          kind: "running",
          job: action.job,
          target: action.target,
          done: 0,
          total: action.total,
        },
      };
    case "task-progress":
      return state.task.kind === "running"
        ? {
            ...state,
            task: {
              ...state.task,
              done: action.done,
              total: action.total ?? state.task.total,
            },
          }
        : state;
    case "task-finished":
      return state.task.kind === "running"
        ? {
            ...state,
            task: {
              kind: "finished",
              job: state.task.job,
              output: action.output,
            },
          }
        : state;
    case "task-failed":
      return state.task.kind === "running"
        ? {
            ...state,
            task: {
              kind: "failed",
              job: state.task.job,
              message: action.message,
            },
          }
        : state;
    case "task-dismissed":
      return { ...state, task: { kind: "idle" } };
  }
}

/** The status line: what the window is doing, or what was last done. */
export function statusText(state: State): string {
  if (state.notice) return state.notice;
  const task = state.task;
  if (task.kind === "running")
    return `${task.job === "extract" ? "Extracting" : "Saving"} · ${task.done} of ${task.total || "?"} items`;
  if (task.kind === "failed") return task.message;
  if (task.kind === "finished")
    return task.job === "extract" ? `Extracted to ${task.output}` : `Saved ${task.output}`;
  const screen = state.screen;
  if (screen.kind === "loading") return "Reading archive…";
  if (screen.kind === "start") return "Open an archive, or start a new one.";
  if (!screen.doc.file) return "Add files and folders, then Save to create the archive.";
  return isDirty(screen.doc)
    ? "Unsaved changes. Save rewrites the archive; the original is kept until the new one is ready."
    : "Extract creates a new folder; nothing is overwritten.";
}
