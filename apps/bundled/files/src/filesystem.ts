import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  checkCancelled,
  planCopy,
  copyPlanned,
  TransferCancelledError,
  type PlannedFile,
} from "./transfer";
import type { FileCatalog } from "./catalog";

export type Entry = { name: string; path: string; isDir: boolean; size: number; modified: number };
export type SortField = "name" | "size" | "modified" | "type";
export type FilesPreferences = {
  view: "grid" | "list";
  sort: SortField;
  descending: boolean;
  hidden: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  inspectorOpen: boolean;
};
export const defaultPreferences: FilesPreferences = {
  view: "list",
  sort: "name",
  descending: false,
  hidden: false,
  sidebarWidth: 208,
  inspectorWidth: 300,
  inspectorOpen: true,
};
const preferencesPath = () =>
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "moire",
    "files-view.json",
  );
let pendingPreferences: Promise<void> = Promise.resolve();
export async function loadViewPreferences(): Promise<FilesPreferences> {
  try {
    const value = JSON.parse(await fs.readFile(preferencesPath(), "utf8"));
    return {
      view: value.view === "list" ? "list" : "grid",
      sort: ["size", "modified", "type"].includes(value.sort) ? value.sort : "name",
      descending: value.descending === true,
      hidden: value.hidden === true,
      sidebarWidth:
        typeof value.sidebarWidth === "number" && Number.isFinite(value.sidebarWidth)
          ? Math.max(160, Math.min(360, value.sidebarWidth))
          : defaultPreferences.sidebarWidth,
      inspectorWidth:
        typeof value.inspectorWidth === "number" && Number.isFinite(value.inspectorWidth)
          ? Math.max(220, Math.min(480, value.inspectorWidth))
          : defaultPreferences.inspectorWidth,
      inspectorOpen: value.inspectorOpen !== false,
    };
  } catch {
    return defaultPreferences;
  }
}
export function saveViewPreferences(value: FilesPreferences): Promise<void> {
  const file = preferencesPath();
  const write = pendingPreferences
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx" });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  pendingPreferences = write;
  return write;
}
export function fileType(entry: Entry): string {
  if (entry.isDir) return "Folder";
  const extension = path.extname(entry.name).slice(1).toUpperCase();
  return extension ? `${extension} file` : "File";
}
export async function readDirectory(directory: string, hidden: boolean): Promise<Entry[]> {
  const names = await fs.readdir(directory, { withFileTypes: true });
  const entries: Entry[] = [];
  for (const item of names) {
    if (!hidden && item.name.startsWith(".")) continue;
    const file = path.join(directory, item.name);
    try {
      const stat = await fs.stat(file);
      entries.push({
        name: item.name,
        path: file,
        isDir: stat.isDirectory(),
        size: stat.size,
        modified: stat.mtimeMs,
      });
    } catch (error) {
      // A disappearing directory entry is normal during a refresh. Other
      // failures belong in the visible error state, not an empty-folder lie.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return entries;
}
export function sortEntries(
  entries: readonly Entry[],
  field: SortField,
  descending: boolean,
): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    const value =
      field === "size"
        ? a.size - b.size
        : field === "modified"
          ? a.modified - b.modified
          : field === "type"
            ? fileType(a).localeCompare(fileType(b))
            : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return (value || a.name.localeCompare(b.name)) * (descending ? -1 : 1);
  });
}
export function operationError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM")
    return "Permission denied. Choose a folder you can write to.";
  if (code === "ENOENT") return "The file or folder no longer exists. Refresh and try again.";
  if (code === "ENOSPC") return "There is not enough space to finish this operation.";
  if (code === "EXDEV")
    return "Moving between filesystems is not supported yet. Copy the item instead.";
  return error instanceof Error ? error.message : String(error);
}
export function validateName(name: string): string {
  const value = name.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\0"))
    throw new Error("Enter a name without slashes.");
  return value;
}
async function requireAbsent(file: string): Promise<void> {
  try {
    await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `“${path.basename(file)}” already exists. Rename the item or choose another folder.`,
  );
}
async function safeRename(source: string, destination: string): Promise<void> {
  await requireAbsent(destination);
  if (process.platform === "linux") {
    // GNU coreutils supplies atomic no-replace rename on Linux. A preflight
    // check alone has a race and ordinary fs.rename can replace a file.
    try {
      await promisify(execFile)("mv", [
        "--no-copy",
        "--update=none-fail",
        "--no-target-directory",
        "--",
        source,
        destination,
      ]);
    } catch (error) {
      throw new Error(
        `Could not move “${path.basename(source)}”. ${String((error as { stderr?: string }).stderr || "The destination changed or is on another filesystem. Refresh and try again.").trim()}`,
      );
    }
  } else {
    // File hard links publish without replacing a concurrent destination.
    const stat = await fs.lstat(source);
    if (!stat.isDirectory()) {
      await fs.link(source, destination);
      await fs.unlink(source);
    } else await fs.rename(source, destination);
  }
}
export type Progress = {
  done: number;
  total: number;
  name: string;
  phase?: "preparing" | "copying" | "moving" | "waiting" | "finished";
  bytes?: number;
  /** Logical regular-file bytes belonging only to successfully published items. */
  committedBytes?: number;
  bytesTotal?: number;
  files?: number;
  filesTotal?: number;
  skipped?: number;
  source?: string;
  destination?: string;
  /** Validated folder, independent of an active or numbered destination item. */
  validatedDirectory?: string;
  startedAt?: number;
};
export type ConflictChoice = "skip" | "keep-both" | "cancel";
export type ResolveConflict = (source: string, destination: string) => Promise<ConflictChoice>;
export type TransferKind = "copy" | "move";
type UndoOperation =
  | { kind: "relocation"; run: () => Promise<void> }
  | { kind: "trash"; sources: string[] };

export class FileOperations {
  readonly trashRoot: string;
  private undoActions: UndoOperation[] = [];
  constructor(
    trashRoot = path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
      "Trash",
    ),
    private readonly catalog?: FileCatalog,
  ) {
    this.trashRoot = trashRoot;
  }
  get trashDirectory() {
    return path.join(this.trashRoot, "files");
  }
  get canUndo() {
    return this.undoActions.length > 0;
  }
  async create(directory: string, name: string, kind: "folder" | "file"): Promise<void> {
    const destination = path.join(directory, validateName(name));
    if (kind === "folder") await fs.mkdir(destination);
    else await fs.writeFile(destination, "", { flag: "wx" });
  }
  async rename(source: string, name: string): Promise<void> {
    const destination = path.join(path.dirname(source), validateName(name));
    if (source === destination) return;
    await safeRename(source, destination);
    this.undoActions.push({
      kind: "relocation",
      run: async () => {
        await safeRename(destination, source);
        await this.catalog?.relocate(destination, source);
      },
    });
    await this.catalog?.relocate(source, destination);
  }
  async transfer(
    kind: TransferKind,
    sources: readonly string[],
    directory: string,
    signal: AbortSignal,
    report: (value: Progress) => void,
    conflict?: ResolveConflict,
  ): Promise<void> {
    const realDirectory = await fs.realpath(directory);
    const destinationDirectory = path.resolve(directory);
    if (!(await fs.stat(realDirectory)).isDirectory())
      throw new Error("Choose a folder as the destination.");
    let done = 0,
      skipped = 0,
      bytes = 0,
      filesDone = 0;
    const startedAt = Date.now();
    const plans: PlannedFile[][] = [];
    let bytesTotal = 0,
      filesTotal = 0,
      lastReport = 0;
    let activeSource: string | undefined;
    const publish = (
      phase: Progress["phase"],
      name: string,
      destination?: string,
      currentBytes = bytes,
      currentFiles = filesDone,
    ) =>
      report({
        done,
        skipped,
        total: sources.length,
        name,
        phase,
        bytes: currentBytes,
        committedBytes: bytes,
        bytesTotal,
        files: currentFiles,
        filesTotal,
        source: activeSource,
        destination,
        validatedDirectory: realDirectory,
        startedAt,
      });
    const committed = (source: string, destination: string, plan: readonly PlannedFile[]) => {
      done++;
      bytes += plan.reduce((sum, file) => sum + file.size, 0);
      filesDone += plan.length;
      publish(kind === "copy" ? "copying" : "moving", path.basename(source), destination);
    };
    publish("preparing", "Preparing transfer…", realDirectory);
    for (const source of sources) {
      activeSource = source;
      checkCancelled(signal);
      const realSource = await fs.realpath(source);
      if (realDirectory === realSource || realDirectory.startsWith(realSource + path.sep))
        throw new Error("A folder cannot be copied or moved inside itself.");
      if (path.resolve(source) === path.join(realDirectory, path.basename(source)))
        throw new Error("The item is already in this folder.");
      const plan = await planCopy(source, signal);
      plans.push(plan);
      bytesTotal += plan.reduce((sum, file) => sum + file.size, 0);
      filesTotal += plan.length;
      publish("preparing", path.basename(source), realDirectory);
    }
    for (const [index, source] of sources.entries()) {
      activeSource = source;
      checkCancelled(signal);
      let destination = path.join(destinationDirectory, path.basename(source));
      try {
        await requireAbsent(destination);
      } catch (error) {
        if (!conflict || !(error instanceof Error) || !error.message.includes("already exists"))
          throw error;
        publish("waiting", path.basename(source), destination);
        const choice = await conflict(source, destination);
        if (choice === "cancel")
          throw new TransferCancelledError(
            `Transfer cancelled. ${done} completed items are kept; unfinished source items are unchanged.`,
          );
        if (choice === "skip") {
          skipped++;
          publish(kind === "copy" ? "copying" : "moving", path.basename(source), destination);
          continue;
        }
        const extension = (await fs.lstat(source)).isDirectory() ? "" : path.extname(source);
        const base = path.basename(source, extension);
        for (let suffix = 2; ; suffix++) {
          destination = path.join(destinationDirectory, `${base} (${suffix})${extension}`);
          try {
            await requireAbsent(destination);
            break;
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
          }
        }
      }
      checkCancelled(signal);
      const plan = plans[index]!;
      const itemBytes = plan.reduce((sum, file) => sum + file.size, 0);
      publish(kind === "copy" ? "copying" : "moving", path.basename(source), destination);
      if (kind === "copy") {
        const staging = await fs.mkdtemp(path.join(realDirectory, ".moire-transfer-"));
        try {
          const stagedItem = path.join(staging, "item");
          await copyPlanned(plan, stagedItem, signal, (copied, files, current) => {
            // Bound UI updates independently of file size and storage speed.
            if (Date.now() - lastReport < 60 && copied < itemBytes) return;
            lastReport = Date.now();
            publish(
              "copying",
              path.basename(current),
              destination,
              bytes + copied,
              filesDone + files,
            );
          });
          checkCancelled(signal);
          // Updating a directory's parent link needs write permission on that
          // directory. This is our private copy, never the source folder.
          if (plan[0]?.kind === "directory") await fs.chmod(stagedItem, plan[0].mode | 0o700);
          await safeRename(stagedItem, destination);
          committed(source, destination, plan);
          if (plan[0]?.kind === "directory") await fs.chmod(destination, plan[0].mode);
        } finally {
          // Only this operation's private staging tree is removed. Published
          // items and pre-existing destinations are never part of cleanup.
          const writable = async (folder: string) => {
            await fs.chmod(folder, 0o700);
            for (const name of await fs.readdir(folder)) {
              const file = path.join(folder, name);
              if ((await fs.lstat(file)).isDirectory()) await writable(file);
            }
          };
          await writable(staging);
          await fs.rm(staging, { recursive: true, force: true });
        }
        await this.catalog?.relocate(source, destination, true);
      } else {
        await safeRename(source, destination);
        this.undoActions.push({
          kind: "relocation",
          run: async () => {
            await safeRename(destination, source);
            await this.catalog?.relocate(destination, source);
          },
        });
        committed(source, destination, plan);
        await this.catalog?.relocate(source, destination);
      }
    }
    activeSource = undefined;
    publish("finished", `${done} completed · ${skipped} skipped`, realDirectory);
  }
  async trash(
    sources: readonly string[],
    signal: AbortSignal,
    report: (value: Progress) => void,
  ): Promise<void> {
    await fs.mkdir(this.trashDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.trashRoot, "info"), { recursive: true, mode: 0o700 });
    const undo: UndoOperation = { kind: "trash", sources: [] };
    for (const [index, source] of sources.entries()) {
      if (signal.aborted) throw new Error(`Stopped after ${index} of ${sources.length} items.`);
      const resolved = path.resolve(source);
      if (resolved === this.trashRoot || resolved.startsWith(this.trashRoot + path.sep))
        throw new Error("This item is already in Trash. Use Restore instead.");
      const name = `${randomUUID()}-${path.basename(source)}`;
      const info = path.join(this.trashRoot, "info", `${name}.trashinfo`);
      await fs.writeFile(
        info,
        `[Trash Info]\nPath=${encodeURIComponent(resolved).replaceAll("%2F", "/")}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      try {
        await safeRename(source, path.join(this.trashDirectory, name));
      } catch (error) {
        await fs.unlink(info);
        throw error;
      }
      const trashed = path.join(this.trashDirectory, name);
      undo.sources.push(trashed);
      if (undo.sources.length === 1) this.undoActions.push(undo);
      await this.catalog?.relocate(source, trashed);
      report({ done: index + 1, total: sources.length, name: path.basename(source) });
    }
  }
  async restore(source: string): Promise<void> {
    const resolved = path.resolve(source);
    if (path.dirname(resolved) !== this.trashDirectory)
      throw new Error("Select an item in Trash to restore.");
    const info = path.join(this.trashRoot, "info", `${path.basename(resolved)}.trashinfo`);
    const text = await fs.readFile(info, "utf8");
    const encoded = /^Path=(.*)$/m.exec(text)?.[1];
    if (!encoded) throw new Error("This item's original location is missing.");
    const destination = decodeURIComponent(encoded);
    if (!path.isAbsolute(destination)) throw new Error("This item's original location is invalid.");
    await safeRename(resolved, destination);
    // A successful restore retires its recovery entry, including when the user
    // restores only part of a group before choosing Undo.
    for (const action of this.undoActions) {
      if (action.kind === "trash")
        action.sources = action.sources.filter((item) => item !== resolved);
    }
    this.undoActions = this.undoActions.filter(
      (action) => action.kind !== "trash" || action.sources.length > 0,
    );
    await fs.unlink(info);
    await this.catalog?.relocate(resolved, destination);
  }
  async undo(): Promise<void> {
    const action = this.undoActions[this.undoActions.length - 1];
    if (!action) return;
    if (action.kind === "trash") {
      // Restore removes completed members from the group. If one destination
      // conflicts, a retry handles only the items still in Trash.
      for (const source of [...action.sources].reverse()) await this.restore(source);
    } else await action.run();
    this.undoActions = this.undoActions.filter((candidate) => candidate !== action);
  }
}
