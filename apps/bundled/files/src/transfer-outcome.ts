import {
  operationError,
  type FileOperations,
  type Progress,
  type ResolveConflict,
  type TransferKind,
} from "./filesystem";
import { TransferCancelledError } from "./transfer";
import path from "node:path";

export type TransferRequest = {
  readonly sources: readonly string[];
  readonly directory: string;
};

export function transferRequest(sources: readonly string[], directory: string): TransferRequest {
  return {
    sources: sources.map((source) => path.resolve(source)),
    directory: path.resolve(directory),
  };
}

export function transferSourceFolder(request: TransferRequest): string {
  const parents = new Set(request.sources.map((source) => path.dirname(source)));
  return parents.size === 1
    ? [...parents][0]!
    : parents.size
      ? "Multiple folders"
      : "No source items";
}

type Receipt = {
  kind: TransferKind;
  progress: Progress;
  undoAvailable: boolean;
  request: TransferRequest;
  /** Total request duration, including preparation and decisions, fixed at settlement. */
  elapsedMs: number;
};
export type TransferOutcome = Receipt &
  (
    | { state: "complete" }
    | { state: "cancelled"; error: string }
    | { state: "failed"; error: string }
  );

/** Keep the actual operation receipt even when cancellation or metadata fails. */
export async function executeTransfer(options: {
  operations: FileOperations;
  kind: TransferKind;
  sources: readonly string[];
  directory: string;
  signal: AbortSignal;
  report: (progress: Progress) => void;
  resolveConflict: ResolveConflict;
}): Promise<TransferOutcome> {
  const request = transferRequest(options.sources, options.directory);
  const started = performance.now();
  let progress: Progress = {
    done: 0,
    skipped: 0,
    total: options.sources.length,
    name: "Preparing transfer…",
    phase: "preparing",
    committedBytes: 0,
  };
  const receipt = (): Receipt => ({
    kind: options.kind,
    progress,
    undoAvailable: options.kind === "move" && progress.done > 0 && options.operations.canUndo,
    request,
    elapsedMs: Math.max(0, performance.now() - started),
  });
  try {
    await options.operations.transfer(
      options.kind,
      request.sources,
      request.directory,
      options.signal,
      (next) => {
        progress = next;
        options.report(next);
      },
      options.resolveConflict,
    );
    return { ...receipt(), state: "complete" };
  } catch (error) {
    return {
      ...receipt(),
      state: error instanceof TransferCancelledError ? "cancelled" : "failed",
      error: operationError(error),
    };
  }
}

export function transferOutcomeHeading(outcome: TransferOutcome): string {
  const action = outcome.kind === "move" ? "Move" : "Copy";
  if (outcome.state === "cancelled") return `${action} cancelled`;
  if (outcome.state === "failed") return `${action} stopped`;
  return outcome.progress.done
    ? `${action} complete`
    : `No items ${outcome.kind === "move" ? "moved" : "copied"}`;
}

export function transferElapsedLabel(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  return seconds < 1
    ? "Elapsed less than a second"
    : `Elapsed ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

export function transferOutcomeNotice(outcome: TransferOutcome): string {
  const { done, total, skipped = 0 } = outcome.progress;
  const item = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
  const action = outcome.kind === "move" ? "moved" : "copied";
  const messages: string[] = [];
  if (outcome.state !== "complete")
    messages.push(
      `${outcome.kind === "move" ? "Move" : "Copy"} ${outcome.state === "cancelled" ? "cancelled" : "stopped"}.`,
    );
  messages.push(done ? `${item(done)} ${action}.` : `No items ${action}.`);
  if (skipped) messages.push(`${item(skipped)} skipped.`);
  const unfinished = total - done - skipped;
  if (outcome.state !== "complete" && unfinished > 0)
    messages.push(`${item(unfinished)} unfinished.`);
  if (outcome.state === "failed") messages.push(outcome.error);
  if (outcome.undoAvailable) messages.push("Undo is available for completed moves.");
  return messages.join(" ");
}

export function transferOutcomeDetail(outcome: TransferOutcome): string {
  if (outcome.undoAvailable) return "Undo is available for completed moves.";
  return outcome.progress.done > 0
    ? "Completed items are kept. Unfinished source items are unchanged."
    : "No items were completed. Source items are unchanged.";
}
