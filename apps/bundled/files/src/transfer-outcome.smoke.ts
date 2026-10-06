import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { unlinkSync, readdirSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileCatalog } from "./catalog";
import { FileOperations, type Progress, type TransferKind } from "./filesystem";
import { executeTransfer, transferOutcomeNotice } from "./transfer-outcome";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-transfer-outcomes-"));
let cases = 0;
try {
  const setup = async (name: string) => {
    const source = path.join(fixture, name, "source");
    const destination = path.join(fixture, name, "destination");
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(destination);
    const first = path.join(source, "a.txt"),
      second = path.join(source, "b.txt");
    await fs.writeFile(first, "First original bytes");
    await fs.writeFile(second, "Second original bytes");
    const operations = new FileOperations(path.join(fixture, name, "Trash"));
    const run = (
      options: {
        kind?: TransferKind;
        sources?: string[];
        signal?: AbortSignal;
        report?: (value: Progress) => void;
        choice?: "skip" | "cancel" | "keep-both";
      } = {},
    ) =>
      executeTransfer({
        operations,
        kind: options.kind ?? "move",
        sources: options.sources ?? [first, second],
        directory: destination,
        signal: options.signal ?? new AbortController().signal,
        report: options.report ?? (() => {}),
        resolveConflict: async () => options.choice ?? "skip",
      });
    return { source, destination, first, second, operations, run };
  };
  {
    const f = await setup("all-skipped");
    await fs.writeFile(path.join(f.destination, "a.txt"), "Existing destination");
    const outcome = await f.run({ sources: [f.first] });
    assert.equal(outcome.state, "complete");
    assert.equal(transferOutcomeNotice(outcome), "No items moved. 1 item skipped.");
    assert.equal(outcome.undoAvailable, false);
    assert.equal(f.operations.canUndo, false);
    assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
    assert.equal(
      await fs.readFile(path.join(f.destination, "a.txt"), "utf8"),
      "Existing destination",
    );
    cases++;
  }
  {
    const f = await setup("empty-with-earlier-history");
    await f.operations.rename(f.first, "renamed.txt");
    const outcome = await f.run({ sources: [] });
    assert.equal(transferOutcomeNotice(outcome), "No items moved.");
    assert.equal(
      outcome.undoAvailable,
      false,
      "an earlier rename cannot certify Undo for an empty transfer",
    );
    assert.equal(f.operations.canUndo, true);
    await f.operations.undo();
    assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
    cases++;
  }
  for (const kind of ["copy", "move"] satisfies TransferKind[]) {
    const f = await setup(`success-${kind}`);
    const outcome = await f.run({ kind });
    assert.equal(outcome.state, "complete");
    assert.equal(outcome.progress.done, 2);
    assert.equal(outcome.progress.skipped, 0);
    assert.equal(outcome.undoAvailable, kind === "move");
    assert.equal(
      await fs.readFile(path.join(f.destination, "b.txt"), "utf8"),
      "Second original bytes",
    );
    if (kind === "move") {
      await f.operations.undo();
      await f.operations.undo();
      assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
      assert.equal(await fs.readFile(f.second, "utf8"), "Second original bytes");
      assert.equal(f.operations.canUndo, false);
    } else assert.doesNotMatch(transferOutcomeNotice(outcome), /Undo/);
    cases++;
  }
  {
    const f = await setup("mixed-skipped");
    await fs.writeFile(path.join(f.destination, "b.txt"), "Existing second");
    const outcome = await f.run();
    assert.equal(
      transferOutcomeNotice(outcome),
      "1 item moved. 1 item skipped. Undo is available for completed moves.",
    );
    await f.operations.undo();
    assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
    assert.equal(await fs.readFile(f.second, "utf8"), "Second original bytes");
    assert.equal(await fs.readFile(path.join(f.destination, "b.txt"), "utf8"), "Existing second");
    cases++;
  }
  for (const method of ["abort", "conflict"] as const) {
    const f = await setup(`partial-cancel-${method}`);
    const controller = new AbortController();
    if (method === "conflict")
      await fs.writeFile(path.join(f.destination, "b.txt"), "Existing second");
    const outcome = await f.run({
      signal: controller.signal,
      choice: "cancel",
      report: (value) => {
        if (method === "abort" && value.done === 1) controller.abort();
      },
    });
    assert.equal(outcome.state, "cancelled");
    assert.equal(outcome.progress.done, 1);
    assert.match(
      transferOutcomeNotice(outcome),
      /Move cancelled\. 1 item moved\. 1 item unfinished\./,
    );
    assert.equal(outcome.undoAvailable, true);
    assert.equal(await fs.readFile(f.second, "utf8"), "Second original bytes");
    await f.operations.undo();
    assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
    cases++;
  }
  {
    const f = await setup("skip-then-cancel");
    await fs.writeFile(path.join(f.destination, "a.txt"), "Existing first");
    const controller = new AbortController();
    const outcome = await executeTransfer({
      operations: f.operations,
      kind: "move",
      sources: [f.first, f.second],
      directory: f.destination,
      signal: controller.signal,
      report: () => {},
      resolveConflict: async () => {
        controller.abort();
        return "skip";
      },
    });
    assert.equal(outcome.state, "cancelled");
    assert.equal(
      outcome.progress.skipped,
      1,
      "the last real Skip must survive cancellation before the next item",
    );
    assert.equal(
      transferOutcomeNotice(outcome),
      "Move cancelled. No items moved. 1 item skipped. 1 item unfinished.",
    );
    assert.equal(outcome.undoAvailable, false);
    cases++;
  }
  {
    const f = await setup("missing-destination");
    const outcome = await executeTransfer({
      operations: f.operations,
      kind: "move",
      sources: [f.first],
      directory: path.join(f.destination, "absent"),
      signal: new AbortController().signal,
      report: () => {},
      resolveConflict: async () => "skip",
    });
    assert.equal(outcome.state, "failed");
    assert.match(
      transferOutcomeNotice(outcome),
      /Move stopped\. No items moved\. 1 item unfinished\./,
    );
    assert.equal(outcome.undoAvailable, false);
    assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
    cases++;
  }
  {
    const f = await setup("partial-failure");
    let removed = false;
    const outcome = await f.run({
      report: (value) => {
        if (value.done === 1 && !removed) {
          unlinkSync(f.second);
          removed = true;
        }
      },
    });
    assert.equal(outcome.state, "failed");
    assert.equal(outcome.progress.done, 1);
    assert.equal(outcome.undoAvailable, true);
    assert.match(
      transferOutcomeNotice(outcome),
      /Move stopped\. 1 item moved\. 1 item unfinished\./,
    );
    await f.operations.undo();
    assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
    cases++;
  }
  for (const { kind, abort } of [
    { kind: "copy", abort: false },
    { kind: "move", abort: false },
    { kind: "copy", abort: true },
    { kind: "move", abort: true },
  ] satisfies { kind: TransferKind; abort: boolean }[]) {
    const f = await setup(`metadata-failure-${kind}-${abort}`);
    const catalogDirectory = path.join(f.source, "metadata");
    const catalog = new FileCatalog(path.join(catalogDirectory, "tags.json"));
    await catalog.update([f.first], ["Recovery"], "add");
    await fs.rm(catalogDirectory, { recursive: true });
    await fs.writeFile(catalogDirectory, "A regular file blocks metadata storage");
    const operations = new FileOperations(path.join(fixture, `metadata-${kind}-Trash`), catalog);
    const controller = new AbortController();
    const outcome = await executeTransfer({
      operations,
      kind,
      sources: [f.first],
      directory: f.destination,
      signal: controller.signal,
      report: (value) => {
        if (abort && value.done === 1) controller.abort();
      },
      resolveConflict: async () => "skip",
    });
    assert.equal(outcome.state, "failed");
    assert.equal(outcome.progress.done, 1, "publication precedes the actual catalog write failure");
    assert.equal(outcome.progress.bytes, Buffer.byteLength("First original bytes"));
    assert.equal(outcome.progress.committedBytes, Buffer.byteLength("First original bytes"));
    assert.equal(outcome.undoAvailable, kind === "move");
    assert.match(transferOutcomeNotice(outcome), /tags could not be saved/);
    assert.equal(
      controller.signal.aborted,
      abort,
      "a simultaneous abort must not hide the observed metadata failure",
    );
    assert.doesNotMatch(transferOutcomeNotice(outcome), /1 item unfinished/);
    assert.equal(
      await fs.readFile(path.join(f.destination, "a.txt"), "utf8"),
      "First original bytes",
    );
    await fs.unlink(catalogDirectory);
    if (kind === "move") {
      await operations.undo();
      assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
      assert.equal(operations.canUndo, false);
    }
    assert.deepEqual(
      catalog.tags(f.first),
      ["Recovery"],
      "failed metadata writes preserve original tag records",
    );
    cases++;
  }
  {
    const f = await setup("copy-cleanup-failure");
    let renamed = false;
    const outcome = await f.run({
      kind: "copy",
      sources: [f.first],
      report: (value) => {
        if (value.done !== 1 || renamed) return;
        const staging = readdirSync(f.destination).find((name) =>
          name.startsWith(".moire-transfer-"),
        );
        assert.ok(staging);
        renameSync(
          path.join(f.destination, staging),
          path.join(fixture, "externally-renamed-staging"),
        );
        renamed = true;
      },
    });
    assert.equal(
      outcome.state,
      "failed",
      "actual staging cleanup error must still stop the transfer",
    );
    assert.equal(
      outcome.progress.done,
      1,
      "already published copy is counted despite subsequent cleanup failure",
    );
    assert.equal(outcome.undoAvailable, false);
    assert.equal(
      await fs.readFile(path.join(f.destination, "a.txt"), "utf8"),
      "First original bytes",
    );
    assert.equal(await fs.readFile(f.first, "utf8"), "First original bytes");
    cases++;
  }
  console.log(
    JSON.stringify({
      kind: "transfer-outcomes",
      cases,
      scope:
        "actual disposable filesystem transfers, cancellation, conflict choices, receipts and executed Undo; no native delivery claim",
    }),
  );
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
