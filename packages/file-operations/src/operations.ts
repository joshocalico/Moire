import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  checkCancelled,
  planCopy,
  copyPlanned,
  TransferCancelledError,
  type PlannedFile,
} from "./transfer";
import { DestinationExistsError, moveWithoutReplacing, requireAbsent, validateName } from "./paths";
import { duplicateName, newItemName, uniqueName } from "./names";
import {
  deleteTrashItem,
  emptyTrash,
  homeTrash,
  isInTrash,
  restoreTrashItem,
  trashAt,
  trashItem,
  trashItemAt,
  type RestoreResult,
  type TrashItem,
  type TrashLocation,
} from "./trash";

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
/** A permission change: `mode` holds the permission bits (0o7777). */
export type PermissionChange = { path: string; mode: number };
/** One item of a batch rename: `name` is the new name inside the item's own folder. */
export type RenameRequest = { from: string; name: string };

/** Metadata that follows a file when it is renamed, moved or copied (Files' tags). */
export type FileMetadataStore = {
  relocate(from: string, to: string, copy?: boolean): Promise<void>;
};

type UndoOperation =
  /**
   * Items that moved from `from` to `to`; undo moves them back, latest first.
   * A `batch` (renameMany) is undone all at once, so swapped names work.
   */
  | {
      kind: "relocation";
      label: string;
      moves: Array<{ from: string; to: string }>;
      batch?: boolean;
    }
  | { kind: "trash"; label: string; items: TrashItem[] }
  | { kind: "created"; label: string; paths: string[] }
  | { kind: "permissions"; label: string; previous: PermissionChange[] };

/** Archive suffixes removed to name the folder an archive extracts into, longest first. */
const ARCHIVE_SUFFIXES = [
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
  ".tar.zst",
  ".tar.lz",
  ".tar.lzma",
  ".tar.z",
  ".tgz",
  ".tbz",
  ".tbz2",
  ".txz",
  ".tzst",
  ".zip",
  ".tar",
  ".7z",
  ".rar",
  ".xar",
  ".cpio",
  ".iso",
  ".jar",
  ".gz",
  ".bz2",
  ".xz",
  ".zst",
];

/** `photos.tar.gz` → `photos`; a name that is only a suffix keeps it. */
function archiveBaseName(archive: string): string {
  const name = path.basename(archive);
  const lower = name.toLowerCase();
  const suffix = ARCHIVE_SUFFIXES.find((candidate) => lower.endsWith(candidate));
  const base = suffix ? name.slice(0, name.length - suffix.length) : name;
  return base.trim() || `${name} contents`;
}

/** Entry names that would land outside the destination folder (zip-slip). */
function unsafeEntry(entry: string): boolean {
  if (entry.startsWith("/") || entry.startsWith("\\") || /^[a-zA-Z]:/.test(entry)) return true;
  return entry.split(/[/\\]/).includes("..");
}

const operationMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Give the owner write and search permission throughout, so a tree can be removed. */
async function makeRemovable(folder: string): Promise<void> {
  await fs.chmod(folder, 0o700);
  for (const name of await fs.readdir(folder)) {
    const file = path.join(folder, name);
    if ((await fs.lstat(file)).isDirectory()) await makeRemovable(file);
  }
}

async function removeTree(folder: string): Promise<void> {
  await makeRemovable(folder).catch(() => {});
  await fs.rm(folder, { recursive: true, force: true });
}

/** Run a command; resolve with stdout, or reject with its stderr as the message. */
function runTool(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  onStderrLine?: (line: string) => boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let stderr = "";
    let partial = "";
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      partial += chunk;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      // Lines the caller consumes (progress) are not part of the error text.
      for (const line of lines) if (!onStderrLine?.(line)) stderr += `${line}\n`;
    });
    child.on("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (partial) stderr += partial;
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

const plannedBytes = (plan: readonly PlannedFile[]) =>
  plan.reduce((sum, file) => sum + file.size, 0);

/**
 * Every file operation Files and the desktop perform. Operations never
 * replace an existing item, and each reversible one records how to undo it.
 */
export class FileOperations {
  readonly trashLocation: TrashLocation;
  private undoActions: UndoOperation[] = [];
  constructor(
    trashRoot?: string,
    private readonly metadata?: FileMetadataStore,
  ) {
    this.trashLocation = trashRoot ? trashAt(trashRoot) : homeTrash();
  }
  get trashRoot(): string {
    return this.trashLocation.root;
  }
  get trashDirectory(): string {
    return this.trashLocation.files;
  }
  get canUndo(): boolean {
    return this.undoActions.length > 0;
  }
  /** What Undo would reverse, e.g. "Move to Trash"; null when there is nothing to undo. */
  get undoLabel(): string | null {
    return this.undoActions.at(-1)?.label ?? null;
  }

  async create(directory: string, name: string, kind: "folder" | "file"): Promise<string> {
    const destination = path.join(directory, validateName(name));
    if (kind === "folder") await fs.mkdir(destination);
    else await fs.writeFile(destination, "", { flag: "wx" });
    this.undoActions.push({
      kind: "created",
      label: kind === "folder" ? "New Folder" : "New Document",
      paths: [destination],
    });
    return destination;
  }

  /** Create `New Folder`, `New Folder 2`… without asking for a name first. */
  async createUnique(
    directory: string,
    base: string,
    kind: "folder" | "file",
    extension = "",
  ): Promise<string> {
    for (;;) {
      const name = await newItemName(directory, base, extension);
      try {
        return await this.create(directory, name, kind);
      } catch (error) {
        // Another writer took the name between the check and the create.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }

  async rename(source: string, name: string): Promise<string> {
    const destination = path.join(path.dirname(source), validateName(name));
    if (source === destination) return destination;
    await moveWithoutReplacing(source, destination);
    this.undoActions.push({
      kind: "relocation",
      label: "Rename",
      moves: [{ from: source, to: destination }],
    });
    await this.metadata?.relocate(source, destination);
    return destination;
  }

  /**
   * Rename several items, each within its own folder, never replacing an
   * existing item. Names may trade places (a ↔ b). One Undo reverses the batch.
   * Returns the new paths in the order given.
   */
  async renameMany(renames: ReadonlyArray<RenameRequest>): Promise<string[]> {
    const targets = renames.map(({ from, name }) =>
      path.join(path.dirname(from), validateName(name)),
    );
    const moves = renames
      .map(({ from }, index) => ({ from, to: targets[index]! }))
      .filter((move) => move.from !== move.to);
    await this.renameBatch(moves);
    if (renames.length)
      this.undoActions.push({ kind: "relocation", label: "Rename", moves, batch: true });
    return targets;
  }

  /**
   * Rename a batch all-or-nothing. When a name is taken by another item of the
   * batch (a swap or a chain), or only its case changes, every item first moves
   * to a private temporary name. On failure the renamed items go back.
   */
  private async renameBatch(moves: ReadonlyArray<{ from: string; to: string }>): Promise<void> {
    const sources = new Set(moves.map((move) => move.from));
    if (sources.size !== moves.length) throw new Error("An item appears twice in the rename.");
    const targets = new Set<string>();
    let staged = false;
    for (const move of moves) {
      if (targets.has(move.to))
        throw new Error(`Two items would both be named “${path.basename(move.to)}”.`);
      targets.add(move.to);
      if (sources.has(move.to)) {
        staged = true;
        continue;
      }
      const existing = await fs.lstat(move.to).catch(() => null);
      if (!existing) continue;
      // On a case-insensitive filesystem a case-only rename finds the item itself.
      const source = await fs.lstat(move.from);
      if (existing.ino !== source.ino || existing.dev !== source.dev)
        throw new DestinationExistsError(move.to);
      staged = true;
    }
    const steps = staged
      ? moves.flatMap((move) => {
          const temporary = path.join(path.dirname(move.from), `.moire-rename-${randomUUID()}`);
          return [
            { from: move.from, to: temporary, phase: 0 },
            { from: temporary, to: move.to, phase: 1 },
          ];
        })
      : moves.map((move) => ({ ...move, phase: 0 }));
    // All items reach their temporary names before any takes its new one.
    steps.sort((a, b) => a.phase - b.phase);
    const done: typeof steps = [];
    try {
      for (const step of steps) {
        await moveWithoutReplacing(step.from, step.to);
        done.push(step);
      }
    } catch (error) {
      for (const step of done.reverse())
        await moveWithoutReplacing(step.to, step.from).catch(() => {});
      throw error;
    }
    for (const step of steps) await this.metadata?.relocate(step.from, step.to);
  }

  /**
   * Move one item without replacing anything. Within a filesystem this is a
   * rename; across drives the item is copied completely, then the original removed.
   */
  private async moveItem(
    source: string,
    target: string,
    signal: AbortSignal,
    plan?: readonly PlannedFile[],
  ): Promise<void> {
    try {
      await moveWithoutReplacing(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await this.publishCopy(plan ?? (await planCopy(source, signal)), target, signal, () => {});
      await fs.rm(source, { recursive: true, force: true });
    }
  }

  /** Copy one planned item through a private staging folder; only complete copies appear. */
  private async publishCopy(
    plan: readonly PlannedFile[],
    destination: string,
    signal: AbortSignal,
    onBytes: (copied: number, files: number, current: string) => void,
  ): Promise<void> {
    const directory = path.dirname(destination);
    const staging = await fs.mkdtemp(path.join(directory, ".moire-transfer-"));
    try {
      const stagedItem = path.join(staging, "item");
      await copyPlanned(plan, stagedItem, signal, onBytes);
      checkCancelled(signal);
      // Updating a directory's parent link needs write permission on that
      // directory. This is our private copy, never the source folder.
      if (plan[0]?.kind === "directory") await fs.chmod(stagedItem, plan[0].mode | 0o700);
      await moveWithoutReplacing(stagedItem, destination);
      if (plan[0]?.kind === "directory") await fs.chmod(destination, plan[0].mode);
    } finally {
      // Only this operation's private staging tree is removed. Published
      // items and pre-existing destinations are never part of cleanup.
      await removeTree(staging);
    }
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
    const moved: UndoOperation & { kind: "relocation" } = {
      kind: "relocation",
      label: "Move",
      moves: [],
    };
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
      bytes += plannedBytes(plan);
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
      const plan = await planCopy(source, signal);
      plans.push(plan);
      bytesTotal += plannedBytes(plan);
      filesTotal += plan.length;
      publish("preparing", path.basename(source), realDirectory);
    }
    for (const [index, source] of sources.entries()) {
      activeSource = source;
      checkCancelled(signal);
      const plan = plans[index]!;
      const sameFolder = (await fs.realpath(path.dirname(source))) === realDirectory;
      if (sameFolder && kind === "move") {
        // Moving an item into the folder it is already in changes nothing.
        skipped++;
        publish("moving", path.basename(source), source);
        continue;
      }
      let destination = path.join(destinationDirectory, path.basename(source));
      if (sameFolder) {
        // Pasting a copy beside its original makes a duplicate, as other desktops do.
        destination = path.join(
          destinationDirectory,
          await duplicateName(destinationDirectory, path.basename(source), {
            directory: plan[0]?.kind === "directory",
          }),
        );
      } else {
        try {
          await requireAbsent(destination);
        } catch (error) {
          if (!conflict || !(error instanceof DestinationExistsError)) throw error;
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
          destination = path.join(
            destinationDirectory,
            await uniqueName(destinationDirectory, path.basename(source), {
              directory: plan[0]?.kind === "directory",
            }),
          );
        }
      }
      checkCancelled(signal);
      const itemBytes = plannedBytes(plan);
      publish(kind === "copy" ? "copying" : "moving", path.basename(source), destination);
      if (kind === "copy") {
        await this.publishCopy(plan, destination, signal, (copied, files, current) => {
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
        committed(source, destination, plan);
        await this.metadata?.relocate(source, destination, true);
      } else {
        await this.moveItem(source, destination, signal, plan);
        // One transfer is one undo step, however many items it moved.
        moved.moves.push({ from: source, to: destination });
        if (moved.moves.length === 1) this.undoActions.push(moved);
        committed(source, destination, plan);
        await this.metadata?.relocate(source, destination);
      }
    }
    activeSource = undefined;
    publish("finished", `${done} completed · ${skipped} skipped`, realDirectory);
  }

  /** Copy each item beside itself as `name (copy)`. Returns the new paths. */
  async duplicate(
    sources: readonly string[],
    signal: AbortSignal,
    report: (value: Progress) => void,
  ): Promise<string[]> {
    const created: string[] = [];
    for (const [index, source] of sources.entries()) {
      checkCancelled(signal);
      const plan = await planCopy(source, signal);
      const directory = path.dirname(source);
      const destination = path.join(
        directory,
        await duplicateName(directory, path.basename(source), {
          directory: plan[0]?.kind === "directory",
        }),
      );
      await this.publishCopy(plan, destination, signal, () => {});
      await this.metadata?.relocate(source, destination, true);
      created.push(destination);
      report({
        done: index + 1,
        total: sources.length,
        name: path.basename(source),
      });
    }
    if (created.length)
      this.undoActions.push({
        kind: "created",
        label: "Duplicate",
        paths: created,
      });
    return created;
  }

  /** Pack items into one archive beside them. Returns the archive path. */
  async compress(sources: readonly string[], signal: AbortSignal): Promise<string> {
    if (!sources.length) throw new Error("Select items to compress.");
    const directory = path.dirname(sources[0]!);
    if (sources.some((source) => path.dirname(source) !== directory))
      throw new Error("Compress items from one folder at a time.");
    const base = sources.length === 1 ? path.basename(sources[0]!) : "Archive";
    const name = await uniqueName(directory, `${base}.tar.gz`);
    const archive = path.join(directory, name);
    try {
      await promisify(execFile)(
        "tar",
        ["-czf", archive, "-C", directory, "--", ...sources.map((source) => path.basename(source))],
        { signal },
      );
    } catch (error) {
      await fs.rm(archive, { force: true });
      if (signal.aborted) throw new TransferCancelledError("Compression cancelled.");
      throw new Error(
        `Could not compress the selection. ${String((error as { stderr?: string }).stderr ?? "").trim()}`.trim(),
      );
    }
    this.undoActions.push({
      kind: "created",
      label: "Compress",
      paths: [archive],
    });
    return archive;
  }

  /**
   * Unpack an archive into a new folder beside it, named after the archive
   * without its suffixes ("photos.tar.gz" → "photos", then "photos (2)").
   * Entries that would land outside the folder are refused before anything is
   * written. Cancelling or failing removes the partial folder. Returns the folder.
   */
  async extract(
    archive: string,
    signal: AbortSignal,
    report: (value: Progress) => void,
  ): Promise<string> {
    const name = path.basename(archive);
    const cancelled = () =>
      new TransferCancelledError(`Extracting “${name}” was cancelled. Nothing was kept.`);
    if (signal.aborted) throw cancelled();
    report({ done: 0, total: 0, name, phase: "preparing", source: archive });
    let listing: string;
    try {
      listing = await runTool("bsdtar", ["-tf", archive], signal);
    } catch (error) {
      if (signal.aborted) throw cancelled();
      throw new Error(`Could not read “${name}”. ${operationMessage(error)}`.trim());
    }
    const entries = listing.split("\n").filter(Boolean);
    const unsafe = entries.find(unsafeEntry);
    if (unsafe)
      throw new Error(
        `“${name}” was not extracted: its entry “${unsafe}” would be written outside the folder.`,
      );
    const directory = path.dirname(archive);
    let folder: string;
    for (;;) {
      folder = path.join(
        directory,
        await uniqueName(directory, archiveBaseName(archive), { directory: true }),
      );
      try {
        await fs.mkdir(folder);
        break;
      } catch (error) {
        // Another writer took the name between the check and the create.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const total = entries.length;
    let done = 0,
      lastReport = 0;
    const startedAt = Date.now();
    try {
      // -v names each entry on stderr as "x <entry>" once it is written.
      await runTool(
        "bsdtar",
        ["-xvf", archive, "-C", folder, "--no-same-owner"],
        signal,
        (line) => {
          if (!line.startsWith("x ")) return false;
          done = Math.min(total, done + 1);
          if (Date.now() - lastReport >= 60 || done === total) {
            lastReport = Date.now();
            report({
              done,
              total,
              name: path.basename(line.slice(2)) || name,
              phase: "copying",
              source: archive,
              destination: folder,
              startedAt,
            });
          }
          return true;
        },
      );
      // A cancel that arrives as bsdtar finishes still means "keep nothing".
      if (signal.aborted) throw cancelled();
    } catch (error) {
      await removeTree(folder);
      if (signal.aborted) throw cancelled();
      throw new Error(`Could not extract “${name}”. ${operationMessage(error)}`.trim());
    }
    report({ done: total, total, name, phase: "finished", source: archive, destination: folder });
    this.undoActions.push({ kind: "created", label: "Extract", paths: [folder] });
    return folder;
  }

  /** Change permission bits; Undo restores each item's previous mode. */
  async setPermissions(changes: ReadonlyArray<PermissionChange>): Promise<void> {
    const previous: PermissionChange[] = [];
    try {
      for (const change of changes) {
        const mode = (await fs.stat(change.path)).mode & 0o7777;
        const next = change.mode & 0o7777;
        if (mode === next) continue;
        await fs.chmod(change.path, next);
        previous.push({ path: change.path, mode });
      }
    } catch (error) {
      // All or nothing: put back the items already changed.
      for (const item of [...previous].reverse())
        await fs.chmod(item.path, item.mode).catch(() => {});
      throw error;
    }
    if (changes.length)
      this.undoActions.push({ kind: "permissions", label: "Change Permissions", previous });
  }

  async trash(
    sources: readonly string[],
    signal: AbortSignal,
    report: (value: Progress) => void,
  ): Promise<TrashItem[]> {
    const undo: UndoOperation & { kind: "trash" } = {
      kind: "trash",
      label: "Move to Trash",
      items: [],
    };
    for (const [index, source] of sources.entries()) {
      if (signal.aborted) throw new Error(`Stopped after ${index} of ${sources.length} items.`);
      if (isInTrash(source, this.trashLocation))
        throw new Error("This item is already in Trash. Use Restore instead.");
      const item = await trashItem(source, this.trashLocation);
      undo.items.push(item);
      if (undo.items.length === 1) this.undoActions.push(undo);
      await this.metadata?.relocate(source, item.path);
      report({
        done: index + 1,
        total: sources.length,
        name: path.basename(source),
      });
    }
    return undo.items;
  }

  /** Restore an item in `Trash/files` to where it came from. */
  async restore(source: string): Promise<RestoreResult> {
    const item = await trashItemAt(source, this.trashLocation);
    const result = await restoreTrashItem(item, this.trashLocation);
    // A successful restore retires its recovery entry, including when the user
    // restores only part of a group before choosing Undo.
    for (const action of this.undoActions)
      if (action.kind === "trash")
        action.items = action.items.filter((candidate) => candidate.path !== item.path);
    this.undoActions = this.undoActions.filter(
      (action) => action.kind !== "trash" || action.items.length > 0,
    );
    await this.metadata?.relocate(item.path, result.restoredTo);
    return result;
  }

  /** Delete items for good: Trash entries lose their metadata too. Not undoable. */
  async deletePermanently(
    sources: readonly string[],
    signal: AbortSignal,
    report: (value: Progress) => void,
  ): Promise<void> {
    for (const [index, source] of sources.entries()) {
      if (signal.aborted) throw new Error(`Stopped after ${index} of ${sources.length} items.`);
      if (path.dirname(path.resolve(source)) === this.trashLocation.files)
        await deleteTrashItem(await trashItemAt(source, this.trashLocation), this.trashLocation);
      else await fs.rm(source, { recursive: true, force: true });
      report({
        done: index + 1,
        total: sources.length,
        name: path.basename(source),
      });
    }
  }

  async emptyTrash(signal?: AbortSignal): Promise<number> {
    const removed = await emptyTrash(this.trashLocation, signal);
    this.undoActions = this.undoActions.filter((action) => action.kind !== "trash");
    return removed;
  }

  async undo(): Promise<void> {
    const action = this.undoActions.at(-1);
    if (!action) return;
    if (action.kind === "trash") {
      // Restore removes completed members from the group. If one destination
      // conflicts, a retry handles only the items still in Trash.
      for (const item of [...action.items].reverse()) {
        if (item.originalPath) await requireAbsent(item.originalPath);
        await this.restore(item.path);
      }
    } else if (action.kind === "created") {
      for (const created of [...action.paths].reverse()) {
        await trashItem(created, this.trashLocation);
        action.paths = action.paths.filter((candidate) => candidate !== created);
      }
    } else if (action.kind === "permissions") {
      for (const item of [...action.previous].reverse()) {
        await fs.chmod(item.path, item.mode);
        action.previous = action.previous.filter((candidate) => candidate !== item);
      }
    } else if (action.batch) {
      await this.renameBatch(action.moves.map((move) => ({ from: move.to, to: move.from })));
    } else {
      // Completed members leave the group, so a retry after a conflict handles only the rest.
      for (const move of [...action.moves].reverse()) {
        await this.moveItem(move.to, move.from, new AbortController().signal);
        action.moves = action.moves.filter((candidate) => candidate !== move);
        await this.metadata?.relocate(move.to, move.from);
      }
    }
    this.undoActions = this.undoActions.filter((candidate) => candidate !== action);
  }
}
