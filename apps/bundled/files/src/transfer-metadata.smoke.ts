import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileCatalog } from "./catalog";
import { FileOperations, type Progress } from "@moire/file-operations";
import { executeTransfer, transferSourceFolder } from "./transfer-outcome";
import {
  readTransferConflictMetadata,
  readTransferItemMetadata,
  transferDestinationFolder,
} from "./transfer-metadata";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "moire-transfer-receipts-"));
let cases = 0;
try {
  const source = path.join(root, "source"),
    destination = path.join(root, "destination");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  const first = path.join(source, "brand-guidelines.pdf"),
    second = path.join(source, "large.txt");
  const firstBytes = Buffer.from("Original PDF fixture bytes");
  await fs.writeFile(first, firstBytes);
  await fs.writeFile(second, Buffer.alloc(4 * 1024 * 1024, 91));
  await fs.writeFile(path.join(destination, "brand-guidelines.pdf"), "Protected existing bytes");
  await fs.writeFile(
    path.join(destination, "brand-guidelines (2).pdf"),
    "Protected numbered bytes",
  );
  const pair = await readTransferConflictMetadata(
    first,
    path.join(destination, "brand-guidelines.pdf"),
  );
  assert.equal(pair.incoming.state, "available");
  assert.equal(pair.existing.state, "available");
  if (pair.incoming.state === "available" && pair.existing.state === "available") {
    assert.equal(pair.incoming.bytes, firstBytes.length);
    assert.equal(pair.existing.bytes, Buffer.byteLength("Protected existing bytes"));
    assert.equal(pair.incoming.modified, (await fs.lstat(first)).mtimeMs);
  }
  const folder = await readTransferItemMetadata(source);
  assert.equal(folder.state, "available");
  if (folder.state === "available") {
    assert.equal(folder.kind, "folder");
    assert.equal(folder.bytes, undefined);
  }
  await fs.symlink(first, path.join(source, "link"));
  const link = await readTransferItemMetadata(path.join(source, "link"));
  assert.equal(link.state, "available");
  if (link.state === "available") {
    assert.equal(link.kind, "link");
    assert.equal(link.bytes, undefined);
  }
  assert.equal((await readTransferItemMetadata(path.join(source, "absent"))).state, "unavailable");
  cases += 4;

  const operations = new FileOperations(path.join(root, "Trash"));
  const reports: Progress[] = [];
  const sources = [first];
  const requestStart = performance.now();
  const outcome = await executeTransfer({
    operations,
    kind: "move",
    sources,
    directory: destination,
    signal: new AbortController().signal,
    report: (value) => reports.push(value),
    resolveConflict: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return "keep-both";
    },
  });
  assert.equal(outcome.state, "complete");
  assert.equal(outcome.progress.committedBytes, firstBytes.length);
  assert.equal(outcome.progress.validatedDirectory, await fs.realpath(destination));
  const committed = reports.filter((value) => value.done === 1 && value.phase !== "finished");
  assert.equal(committed.length, 1);
  assert.equal(committed[0]!.source, first, "published item identity is not the next source");
  assert.equal(committed[0]!.name, path.basename(first));
  assert.equal(committed[0]!.destination, path.join(destination, "brand-guidelines (3).pdf"));
  assert.deepEqual(
    await fs.readFile(path.join(destination, "brand-guidelines (3).pdf")),
    firstBytes,
  );
  assert.equal(
    await fs.readFile(path.join(destination, "brand-guidelines.pdf"), "utf8"),
    "Protected existing bytes",
  );
  assert.equal(
    await fs.readFile(path.join(destination, "brand-guidelines (2).pdf"), "utf8"),
    "Protected numbered bytes",
  );
  assert.ok(outcome.elapsedMs >= 20 && outcome.elapsedMs <= performance.now() - requestStart);
  const duration = outcome.elapsedMs;
  sources[0] = second;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(outcome.elapsedMs, duration, "settled duration never advances with an open receipt");
  assert.deepEqual(
    outcome.request.sources,
    [first],
    "the receipt retains its immutable request snapshot",
  );
  assert.equal(transferSourceFolder(outcome.request), source);
  assert.equal(
    await transferDestinationFolder(outcome.progress.validatedDirectory!),
    await fs.realpath(destination),
  );
  await operations.undo();
  assert.deepEqual(await fs.readFile(first), firstBytes);
  cases++;

  const copyDestination = path.join(root, "copy-destination");
  await fs.mkdir(copyDestination);
  const catalog = new FileCatalog(path.join(root, "private-config", "tags.json"));
  await catalog.update([first, second], ["Recovery"], "add");
  const copyOperations = new FileOperations(path.join(root, "copy-Trash"), catalog);
  const abort = new AbortController();
  const partial = await executeTransfer({
    operations: copyOperations,
    kind: "copy",
    sources: [first, second],
    directory: copyDestination,
    signal: abort.signal,
    report: (value) => {
      if (value.source === second && (value.bytes ?? 0) > (value.committedBytes ?? 0))
        abort.abort();
    },
    resolveConflict: async () => "skip",
  });
  assert.equal(partial.state, "cancelled");
  assert.equal(partial.progress.done, 1);
  assert.equal(partial.progress.committedBytes, firstBytes.length);
  assert.ok(partial.progress.bytes! > partial.progress.committedBytes!);
  assert.deepEqual(
    await fs.readdir(copyDestination),
    [path.basename(first)],
    "unfinished staging bytes are removed, not counted as committed",
  );
  assert.deepEqual(await fs.readFile(path.join(copyDestination, path.basename(first))), firstBytes);
  assert.equal((await fs.stat(second)).size, 4 * 1024 * 1024);
  assert.deepEqual(catalog.tags(path.join(copyDestination, path.basename(first))), ["Recovery"]);
  assert.deepEqual(catalog.tags(second), ["Recovery"]);
  assert.deepEqual(catalog.tags(path.join(copyDestination, path.basename(second))), []);
  cases++;

  await fs.rm(copyDestination, { recursive: true });
  await assert.rejects(transferDestinationFolder(copyDestination), /ENOENT/);
  await assert.rejects(transferDestinationFolder(first), /no longer a folder/);
  const missing = await executeTransfer({
    operations,
    kind: "move",
    sources: [first],
    directory: copyDestination,
    signal: new AbortController().signal,
    report: () => {},
    resolveConflict: async () => "skip",
  });
  assert.equal(missing.state, "failed");
  assert.equal(missing.progress.committedBytes, 0);
  assert.equal(missing.progress.validatedDirectory, undefined);
  assert.equal(missing.request.directory, copyDestination);
  assert.ok(missing.elapsedMs >= 0);
  cases += 2;
  console.log(
    JSON.stringify({
      kind: "transfer-metadata-receipts",
      cases,
      scope:
        "real private filesystem metadata, no-replace numbered publication, frozen duration, active item identity, cancelled staging versus committed logical bytes and real Undo; no native delivery claim",
    }),
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
