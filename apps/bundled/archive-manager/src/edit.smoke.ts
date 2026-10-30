/** Editing real archives: the change set is written, re-listed and its bytes compared. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runTool } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import { createArchive, extractArchive, listArchive, writeArchive } from "./backend";
import { applyChange, openDocument, type Change } from "./model";

await withFixture(async (directory) => {
  const source = path.join(directory, "source");
  await fs.mkdir(path.join(source, "docs"), { recursive: true });
  await fs.writeFile(path.join(source, "docs", "a.txt"), "A original");
  await fs.writeFile(path.join(source, "readme.md"), "Read me");
  const extra = path.join(directory, "extra");
  await fs.mkdir(path.join(extra, "photos"), { recursive: true });
  await fs.writeFile(path.join(extra, "photos", "p.bin"), Buffer.from([0, 1, 2, 255]));
  await fs.writeFile(path.join(extra, "plan.pdf"), "PDF bytes");

  // Sources from different folders are fine; two top-level items with one name are not.
  const archive = path.join(directory, "bundle.tar.gz");
  await createArchive(
    [path.join(source, "docs"), path.join(source, "readme.md"), path.join(extra, "plan.pdf")],
    archive,
  );
  await assert.rejects(
    createArchive(
      [path.join(source, "readme.md"), path.join(source, "readme.md")],
      path.join(directory, "dup.tar.gz"),
    ),
    /already an item named "readme.md"/,
  );

  const edit = async (file: string, changes: Change[], output: string, replace: boolean) => {
    const listing = await listArchive(file);
    let entries = openDocument(file, listing.entries, listing.kind).entries;
    for (const change of changes) entries = applyChange(entries, change);
    return writeArchive({ original: file, entries, output, replace });
  };
  const contents = async (file: string) =>
    (await listArchive(file)).entries.map((entry) => entry.replace(/\/$/, "")).sort();

  // Save in place: add a file and a folder, rename a folder, remove a file, create a folder.
  const progress: number[] = [];
  const listing = await listArchive(archive);
  let entries = openDocument(archive, listing.entries).entries;
  for (const change of [
    { kind: "add", parent: "docs", source: path.join(extra, "photos"), folder: true },
    { kind: "rename", path: "docs", name: "Papers" },
    { kind: "remove", path: "readme.md" },
    { kind: "create-folder", parent: "", name: "Empty" },
    { kind: "rename", path: "plan.pdf", name: "Plan.pdf" },
  ] satisfies Change[])
    entries = applyChange(entries, change);
  const before = await fs.stat(archive);
  await writeArchive({
    original: archive,
    entries,
    output: archive,
    replace: true,
    onProgress: (done) => progress.push(done),
  });
  assert.deepEqual(await contents(archive), [
    "Empty",
    "Papers",
    "Papers/a.txt",
    "Papers/photos",
    "Papers/photos/p.bin",
    "Plan.pdf",
  ]);
  assert.ok(progress.length >= 5, "writing reports progress per member");
  assert.notEqual(
    (await fs.stat(archive)).ino,
    before.ino,
    "the archive was replaced, not edited in place",
  );
  const out = path.join(directory, "check");
  await extractArchive(archive, out);
  assert.equal(await fs.readFile(path.join(out, "Papers", "a.txt"), "utf8"), "A original");
  assert.deepEqual(
    await fs.readFile(path.join(out, "Papers", "photos", "p.bin")),
    Buffer.from([0, 1, 2, 255]),
  );
  assert.equal(await fs.readFile(path.join(out, "Plan.pdf"), "utf8"), "PDF bytes");

  // Save as a .zip copy: the original stays as it was, and an existing name is never replaced.
  const zip = await edit(
    archive,
    [{ kind: "remove", path: "Empty" }],
    path.join(directory, "copy.zip"),
    false,
  );
  assert.ok(!(await contents(zip)).includes("Empty"));
  assert.ok((await contents(archive)).includes("Empty"));
  assert.match(await runTool("bsdtar", ["-tvf", zip]), /Plan\.pdf/);
  await assert.rejects(edit(archive, [], zip, false), { code: "EEXIST" });

  // Edit a zip in place too.
  await edit(zip, [{ kind: "rename", path: "Plan.pdf", name: "Final.pdf" }], zip, true);
  assert.ok((await contents(zip)).includes("Final.pdf"));

  // A read-only format can still be saved as an editable copy.
  const xz = path.join(directory, "packed.tar.xz");
  await runTool("bsdtar", ["-cJf", xz, "-C", source, "readme.md"]);
  const xzListing = await listArchive(xz);
  assert.equal(openDocument(xz, xzListing.entries).format, null);
  await assert.rejects(edit(xz, [], xz, true), /Save archives as/);
  const copy = await edit(
    xz,
    [{ kind: "create-folder", parent: "", name: "More" }],
    path.join(directory, "packed.tar.gz"),
    false,
  );
  assert.deepEqual(await contents(copy), ["More", "readme.md"]);

  // Cancelling a save leaves the archive exactly as it was.
  const bytes = await fs.readFile(archive);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    writeArchive({
      original: archive,
      entries: [],
      output: archive,
      replace: true,
      signal: cancelled.signal,
    }),
  );
  assert.deepEqual(await fs.readFile(archive), bytes);
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.startsWith(".")),
    [],
    "no staging or backup is left behind",
  );
});
console.log(
  "[archive-manager/edit] add/remove/rename/new-folder saved in place and as .zip, read-only copy, cancel passed",
);
