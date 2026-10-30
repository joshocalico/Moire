/**
 * Desktop file work: one shared FileOperations and queue, so operations run
 * off the input path, in order, and end in a toast with Undo where it makes sense.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  FileOperations,
  OperationQueue,
  operationError,
  readFileClipboard,
  writeFileClipboard,
  type OperationRequest,
} from "@moire/file-operations";
import type { DesktopCell } from "./layout";
import type { DesktopToast } from "./overlay";

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export type DesktopWorkContext = {
  directory(): string;
  /** Names currently listed on the desktop. */
  names(): string[];
  /** Re-read the Desktop folder. */
  refresh(): Promise<void>;
  /** Give newly arrived icons cells near `near`. */
  placeArrivals(names: readonly string[], near: DesktopCell | null): void;
  showToast(toast: Omit<DesktopToast, "id">, sticky?: boolean): void;
  dismissToast(): void;
};

/** Whether a finished operation can be reversed from its toast (it is the latest undo step). */
type Reversal = { label: string } | null;

export function createDesktopWork(context: DesktopWorkContext) {
  const operations = new FileOperations();
  const queue = new OperationQueue(operationError);
  let idle: Promise<unknown> = Promise.resolve();

  queue.subscribe(() => {
    const running = queue.state.running;
    if (running)
      context.showToast(
        {
          message: running.cancelling
            ? `Stopping ${running.label.toLowerCase()}…`
            : `${running.label}…`,
          tone: "progress",
          actionLabel: "Stop",
          onAction: () => queue.cancel(running.id),
        },
        true,
      );
  });

  /** Run file work; refresh and report when it ends. `after` sees the names that appeared. */
  const run = <T>(
    request: OperationRequest<T>,
    after?: (value: T, arrived: string[]) => void,
    undo?: (value: T) => Reversal,
  ) => {
    const before = new Set(context.names());
    const work = queue.enqueue(request).then(async (result) => {
      await context.refresh();
      if (!result.ok) {
        context.showToast({
          message: result.cancelled ? `${request.label} stopped` : operationError(result.error),
          tone: result.cancelled ? "info" : "error",
        });
        return;
      }
      after?.(
        result.value,
        context.names().filter((name) => !before.has(name)),
      );
      const reversal = undo?.(result.value);
      context.showToast({
        message: request.done?.(result.value) ?? `${request.label} finished`,
        tone: "info",
        ...(reversal
          ? {
              actionLabel: "Undo",
              onAction: () => {
                context.dismissToast();
                undoLast();
              },
            }
          : {}),
      });
    });
    idle = idle.then(() => work);
    return work;
  };

  /** Undo the latest step on the shared undo stack. */
  const undoLast = () => {
    const label = operations.undoLabel;
    if (!label) {
      context.showToast({ message: "Nothing to undo", tone: "info" });
      return;
    }
    void run({
      label: `Undo ${label}`,
      run: async () => {
        await operations.undo();
      },
      done: () => `${label} undone`,
    });
  };

  /** Move or copy into a folder. Across drives a move becomes a copy; nothing is ever replaced. */
  const transferInto = (
    kind: "copy" | "move",
    sources: readonly string[],
    destination: string,
    near: DesktopCell | null,
  ) => {
    const intoDesktop = path.resolve(destination) === path.resolve(context.directory());
    return run(
      {
        label: `${kind === "copy" ? "Copying" : "Moving"} ${plural(sources.length, "item")}`,
        run: async ({ signal, report }) => {
          const destinationDevice = (await fsp.stat(destination)).dev;
          const moves: string[] = [];
          const copies: string[] = [];
          for (const source of sources) {
            const sameDevice = (await fsp.lstat(source)).dev === destinationDevice;
            (kind === "move" && sameDevice ? moves : copies).push(source);
          }
          // The move is one undo step for all its items; copies record none.
          let moved = 0;
          let copied = 0;
          const keepBoth = async () => "keep-both" as const;
          await operations.transfer(
            "move",
            moves,
            destination,
            signal,
            (progress) => {
              moved = progress.done;
              report(progress);
            },
            keepBoth,
          );
          if (copies.length)
            await operations.transfer(
              "copy",
              copies,
              destination,
              signal,
              (progress) => {
                copied = progress.done;
                report({ ...progress, done: moved + progress.done });
              },
              keepBoth,
            );
          return { moved, copied };
        },
        done: ({ moved, copied }) => {
          const where = intoDesktop ? "to the Desktop" : `into ${path.basename(destination)}`;
          return moved && copied
            ? `${plural(moved, "item")} moved and ${plural(copied, "item")} copied ${where}`
            : moved
              ? `${plural(moved, "item")} moved ${where}`
              : `${plural(copied, "item")} copied ${where}`;
        },
      },
      (_value, arrived) => {
        if (!intoDesktop) return;
        // Arrivals keep the order they were dropped in; a renamed copy follows its source.
        const rank = (name: string) => {
          const index = sources.findIndex((source) => {
            const base = path.basename(source);
            const stem = base.slice(0, base.length - path.extname(base).length);
            return name === base || name.startsWith(`${stem} (`);
          });
          return index < 0 ? sources.length : index;
        };
        context.placeArrivals(
          [...arrived].sort((a, b) => rank(a) - rank(b)),
          near,
        );
      },
      ({ moved }) => (moved ? { label: "Move" } : null),
    );
  };

  /** Paste the session file clipboard (shared with Files) into a folder. */
  const paste = (destination: string, near: DesktopCell | null) => {
    const clipboard = readFileClipboard();
    if (!clipboard) {
      context.showToast({ message: "Nothing to paste. Cut or copy items first.", tone: "info" });
      return;
    }
    void transferInto(
      clipboard.kind === "cut" ? "move" : "copy",
      clipboard.paths,
      destination,
      near,
    ).then(() => {
      // A finished cut empties the clipboard, unless something newer replaced it.
      if (clipboard.kind !== "cut") return;
      const current = readFileClipboard();
      if (current?.at === clipboard.at && clipboard.paths.every((item) => !fs.existsSync(item)))
        writeFileClipboard(null);
    });
  };

  return {
    operations,
    get busy() {
      return queue.busy;
    },
    run,
    undoLast,
    transferInto,
    paste,
    /** Wait for something outside the queue (a layout save) as part of idleness. */
    track(promise: Promise<unknown>) {
      idle = idle.then(() => promise);
    },
    /** Resolves when every queued operation has finished and been reported. */
    whenIdle: async () => {
      let current: Promise<unknown>;
      do {
        current = idle;
        await current;
      } while (current !== idle);
    },
  };
}

export type DesktopWork = ReturnType<typeof createDesktopWork>;
