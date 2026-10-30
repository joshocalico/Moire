/**
 * Files' operations model: every file operation goes through one queue that
 * reports progress, can be cancelled and ends in an outcome the view shows
 * (with Undo where the operation can be reversed). Views dispatch intent only.
 */
import path from "node:path";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  FileOperations,
  OperationQueue,
  operationError,
  type ConflictChoice,
  type FileMetadataStore,
  type OperationRequest,
  type OperationResult,
  type PermissionChange,
  type Progress,
  type RenameRequest,
  type TransferKind,
} from "@moire/file-operations";
import type { FileCatalog } from "./catalog";
import { countLabel } from "./format";
import type { TransferConflict, TransferDisplay } from "./transfer-dialog";
import { executeTransfer, transferOutcomeNotice, transferRequest } from "./transfer-outcome";

const named = (paths: readonly string[]) =>
  paths.length === 1 ? `“${path.basename(paths[0]!)}”` : countLabel(paths.length);

/** Feedback for the last operation: what happened, and whether Undo applies. */
export type OperationNotice = {
  readonly message: string;
  readonly tone: "info" | "error";
  readonly undo: boolean;
};

export type FilesOperations = ReturnType<typeof useFilesOperations>;

export function useFilesOperations(options: {
  catalog: FileCatalog;
  catalogReady: boolean;
  /** Set while the current folder is on a drive that went away; operations are refused. */
  blocked: string | null;
  /** Called after every operation settles, so listings refresh. */
  onSettled: () => void;
  trashRoot?: string;
}) {
  const catalogReady = useRef(options.catalogReady);
  catalogReady.current = options.catalogReady;
  const settled = useRef(options.onSettled);
  settled.current = options.onSettled;
  // One instance for the window's lifetime keeps the undo history intact.
  const operations = useMemo(() => {
    const metadata: FileMetadataStore = {
      relocate: (from, to, copy) =>
        catalogReady.current ? options.catalog.relocate(from, to, copy) : Promise.resolve(),
    };
    return new FileOperations(options.trashRoot, metadata);
    // The catalog and trash root are fixed for a window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const queue = useMemo(() => new OperationQueue(operationError), []);
  const state = useSyncExternalStore(
    useCallback((listener) => queue.subscribe(listener), [queue]),
    () => queue.state,
  );
  const [notice, setNotice] = useState<OperationNotice | null>(null);
  const [transferDisplay, setTransferDisplay] = useState<TransferDisplay | null>(null);
  const [conflict, setConflict] = useState<TransferConflict | null>(null);

  // Publish each finished operation as feedback, then refresh listings.
  const lastOutcome = useRef(state.outcome);
  useEffect(() => {
    const outcome = state.outcome;
    if (!outcome || outcome === lastOutcome.current) return;
    lastOutcome.current = outcome;
    setNotice({
      message: outcome.message,
      tone: outcome.state === "failed" ? "error" : "info",
      undo: outcome.undoable && operations.canUndo,
    });
    settled.current();
  }, [state.outcome, operations]);

  const blocked = useRef(options.blocked);
  blocked.current = options.blocked;
  const run = useCallback(
    async <T>(request: OperationRequest<T>): Promise<OperationResult<T>> => {
      if (blocked.current) {
        setNotice({ message: blocked.current, tone: "error", undo: false });
        return { ok: false, cancelled: false, error: new Error(blocked.current) };
      }
      setNotice(null);
      return queue.enqueue(request);
    },
    [queue],
  );

  const resolveConflict = (signal: AbortSignal) => (source: string, destination: string) =>
    new Promise<ConflictChoice>((resolve) => {
      const choose = (choice: ConflictChoice) => {
        signal.removeEventListener("abort", abort);
        setConflict(null);
        resolve(choice);
      };
      const abort = () => choose("cancel");
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) choose("cancel");
      else setConflict({ source, destination, choose });
    });

  /** Copy or move with the transfer dialog: progress, conflicts and a receipt. */
  const transfer = (kind: TransferKind, paths: readonly string[], directory: string) =>
    run({
      label: `${kind === "copy" ? "Copying" : "Moving"} ${named(paths)}`,
      run: async ({ signal, report }) => {
        const request = transferRequest(paths, directory);
        const initial: Progress = {
          done: 0,
          total: paths.length,
          name: "Preparing transfer…",
          phase: "preparing",
        };
        setTransferDisplay({ kind, request, progress: initial, outcome: "running" });
        const outcome = await executeTransfer({
          operations,
          kind,
          sources: paths,
          directory,
          signal,
          report: (progress) => {
            report(progress);
            setTransferDisplay({ kind, request, progress, outcome: "running" });
          },
          resolveConflict: resolveConflict(signal),
        });
        setConflict(null);
        const message = transferOutcomeNotice(outcome);
        setTransferDisplay({
          kind,
          request: outcome.request,
          progress: outcome.progress,
          outcome: outcome.state === "complete" ? "complete" : "stopped",
          message,
          result: outcome,
        });
        if (outcome.state === "failed") throw new Error(message);
        return { message, undoable: outcome.undoAvailable };
      },
      done: (value) => value.message,
      undoable: (value) => value.undoable,
    });

  const progressReporter =
    (paths: readonly string[], report: (value: Progress) => void) => (value: Progress) =>
      report({ ...value, total: paths.length });

  return {
    operations,
    state,
    busy: state.running !== null,
    notice,
    setNotice,
    dismissNotice: () => setNotice(null),
    transferDisplay,
    setTransferDisplay,
    conflict,
    cancel: () => queue.cancel(),
    transfer,
    trash: (paths: readonly string[]) =>
      run({
        label: `Moving ${named(paths)} to Trash`,
        run: ({ signal, report }) =>
          operations.trash(paths, signal, progressReporter(paths, report)),
        done: () => `${named(paths)} moved to Trash`,
        undoable: true,
      }),
    deletePermanently: (paths: readonly string[]) =>
      run({
        label: `Deleting ${named(paths)}`,
        run: ({ signal, report }) =>
          operations.deletePermanently(paths, signal, progressReporter(paths, report)),
        done: () => `${named(paths)} deleted permanently`,
      }),
    restore: (paths: readonly string[]) =>
      run({
        label: `Restoring ${named(paths)}`,
        run: async ({ signal, report }) => {
          const restored: string[] = [];
          for (const [index, file] of paths.entries()) {
            if (signal.aborted) break;
            const result = await operations.restore(file);
            restored.push(result.restoredTo);
            report({
              done: index + 1,
              total: paths.length,
              name: path.basename(result.restoredTo),
            });
          }
          return restored;
        },
        done: (restored) => {
          const renamed = restored.filter(
            (file, index) => path.basename(file) !== path.basename(paths[index] ?? file),
          );
          return `${countLabel(restored.length)} restored${
            renamed.length
              ? `; ${renamed.map((file) => `“${path.basename(file)}”`).join(", ")} kept beside an existing item`
              : ""
          }`;
        },
      }),
    emptyTrash: () =>
      run({
        label: "Emptying Trash",
        run: ({ signal }) => operations.emptyTrash(signal),
        done: (removed) => `Trash emptied: ${countLabel(removed)} deleted permanently`,
      }),
    create: (kind: "folder" | "file", directory: string, name: string) =>
      run({
        label: kind === "folder" ? `Creating folder “${name}”` : `Creating “${name}”`,
        run: () => operations.create(directory, name, kind),
        done: (created) => `“${path.basename(created)}” created`,
        undoable: true,
      }),
    rename: (source: string, name: string) =>
      run({
        label: `Renaming “${path.basename(source)}”`,
        run: () => operations.rename(source, name),
        done: (renamed) => `Renamed to “${path.basename(renamed)}”`,
        undoable: true,
      }),
    duplicate: (paths: readonly string[]) =>
      run({
        label: `Duplicating ${named(paths)}`,
        run: ({ signal, report }) => operations.duplicate(paths, signal, report),
        done: (created) =>
          created.length === 1
            ? `Duplicated as “${path.basename(created[0]!)}”`
            : `${countLabel(created.length)} duplicated`,
        undoable: true,
      }),
    compress: (paths: readonly string[]) =>
      run({
        label: `Compressing ${named(paths)}`,
        run: ({ signal }) => operations.compress(paths, signal),
        done: (archive) => `Created “${path.basename(archive)}”`,
        undoable: true,
      }),
    /** Unpack an archive into a new folder beside it; the result's value is that folder. */
    extract: (archive: string) =>
      run({
        label: `Extracting “${path.basename(archive)}”`,
        run: ({ signal, report }) => operations.extract(archive, signal, report),
        done: (folder) => `Extracted to “${path.basename(folder)}”`,
        undoable: true,
      }),
    setPermissions: (changes: ReadonlyArray<PermissionChange>, label?: string) =>
      run({
        label: label ?? `Changing permissions of ${named(changes.map((change) => change.path))}`,
        run: () => operations.setPermissions(changes),
        done: () => "Permissions changed",
        undoable: true,
      }),
    renameMany: (renames: ReadonlyArray<RenameRequest>) =>
      run({
        label: `Renaming ${named(renames.map((rename) => rename.from))}`,
        run: () => operations.renameMany(renames),
        done: (renamed) => `${countLabel(renamed.length)} renamed`,
        undoable: true,
      }),
    tagged: (label: string, work: () => Promise<void>, done: string) =>
      run({ label, run: work, done: () => done }),
    undo: () => {
      const label = operations.undoLabel;
      return run({
        label: label ? `Undoing ${label}` : "Undoing",
        run: () => operations.undo(),
        done: () => (label ? `${label} undone` : "Undone"),
      });
    },
  };
}
