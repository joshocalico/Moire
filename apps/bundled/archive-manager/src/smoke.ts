import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runTool } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import { createArchive, extractArchive, listArchive, safeMember } from "./backend";
await withFixture(async (directory) => {
  const source = path.join(directory, "source"),
    folder = path.join(source, "folder");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "note #1.txt"), "Original content");
  await fs.chmod(folder, 0o555);
  const archive = path.join(directory, "bundle.tar.gz");
  await createArchive([folder], archive);
  await fs.chmod(folder, 0o755);
  const info = await listArchive(archive);
  assert.ok(info.entries.some((value) => value.endsWith("note #1.txt")));
  const output = path.join(directory, "extracted");
  await extractArchive(archive, output);
  assert.equal(
    await fs.readFile(path.join(output, "folder", "note #1.txt"), "utf8"),
    "Original content",
  );
  const zip = path.join(directory, "bundle.zip");
  await runTool("bsdtar", ["-cf", zip, "--format", "zip", "-C", source, "folder"]);
  const zipOutput = path.join(directory, "zip-extracted");
  await extractArchive(zip, zipOutput);
  assert.equal(
    await fs.readFile(path.join(zipOutput, "folder", "note #1.txt"), "utf8"),
    "Original content",
    "ordinary ZIP archives extract their real contents",
  );
  await assert.rejects(extractArchive(archive, output), { code: "EEXIST" });
  assert.equal(
    await fs.readFile(path.join(output, "folder", "note #1.txt"), "utf8"),
    "Original content",
  );
  await assert.rejects(createArchive([folder], archive), { code: "EEXIST" });
  for (const member of [
    "../outside",
    "/absolute",
    "/",
    "folder/../../outside",
    "C:/outside",
    "folder\\outside",
  ]) {
    assert.throws(() => safeMember(member), /Unsafe/);
  }
  assert.equal(safeMember("folder/note.txt"), "folder/note.txt");
  await fs.symlink("../../outside", path.join(source, "link"));
  const linked = path.join(directory, "linked.tar");
  await runTool("bsdtar", ["-cf", linked, "-C", source, "link"]);
  await assert.rejects(
    extractArchive(linked, path.join(directory, "bad-extract")),
    /links or special files/,
  );
  const hardSource = path.join(source, "hard-source.txt");
  await fs.writeFile(hardSource, "Linked content");
  await fs.link(hardSource, path.join(source, "hard-link.txt"));
  const hardArchive = path.join(directory, "hardlinks.tar");
  await runTool("bsdtar", ["-cf", hardArchive, "-C", source, "hard-source.txt", "hard-link.txt"]);
  await assert.rejects(
    extractArchive(hardArchive, path.join(directory, "hard-extract")),
    /links or special files/,
  );
  const escape = path.join(directory, "traversal.tar");
  // Construct a real USTAR entry with a traversal name to test the backend
  // boundary, rather than relying on a utility that may sanitize the fixture.
  const header = Buffer.alloc(512);
  header.write("../outside");
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write("00000000004\0", 124);
  header.write("00000000000\0", 136);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
  const data = Buffer.alloc(512);
  data.write("evil");
  await fs.writeFile(escape, Buffer.concat([header, data, Buffer.alloc(1024)]));
  const disguisedUnsafeGzip = path.join(directory, "unsafe.txt.gz");
  const { gzipSync } = await import("node:zlib");
  await fs.writeFile(disguisedUnsafeGzip, gzipSync(await fs.readFile(escape)));
  await assert.rejects(
    listArchive(disguisedUnsafeGzip),
    /Unsafe archive path/,
    "unsafe tar does not fall back to plain gzip",
  );
  await assert.rejects(
    extractArchive(escape, path.join(directory, "escaped")),
    /Unsafe archive path/,
  );
  await assert.rejects(fs.stat(path.join(directory, "outside")), {
    code: "ENOENT",
  });
  const previousLocale = process.env.LC_ALL;
  process.env.LC_ALL = "C";
  try {
    const unicodeFolder = path.join(directory, "données ü and spaces"),
      unicodeArchive = path.join(directory, "资料 ü.tar.gz"),
      unicodeOutput = path.join(directory, "unicode-extracted");
    await fs.mkdir(unicodeFolder);
    for (const name of ["ü note #1.txt", "计划 with spaces.txt"])
      await fs.writeFile(path.join(unicodeFolder, name), `Exact Unicode payload: ${name}`);
    await createArchive([unicodeFolder], unicodeArchive);
    const unicodeListing = await listArchive(unicodeArchive);
    // Darwin libarchive decomposes member names. Linux retains literal UTF-8.
    const comparable = (name: string) =>
      process.platform === "darwin" ? name.normalize("NFC") : name;
    const sourceFolderName = (await fs.readdir(directory)).find(
      (name) => comparable(name) === comparable(path.basename(unicodeFolder)),
    );
    assert.ok(sourceFolderName);
    const sourceNames = await fs.readdir(unicodeFolder);
    for (const name of sourceNames)
      assert.ok(
        unicodeListing.entries.some(
          (entry) => comparable(entry) === comparable(`${sourceFolderName}/${name}`),
        ),
        JSON.stringify(unicodeListing.entries),
      );
    await extractArchive(unicodeArchive, unicodeOutput);
    const outputFolders = await fs.readdir(unicodeOutput);
    assert.deepEqual(outputFolders.map(comparable), [comparable(sourceFolderName)]);
    const outputFolderName = outputFolders[0];
    assert.ok(outputFolderName);
    const outputNames = await fs.readdir(path.join(unicodeOutput, outputFolderName));
    assert.deepEqual(outputNames.map(comparable).sort(), sourceNames.map(comparable).sort());
    for (const name of outputNames) {
      const sourceName = sourceNames.find((original) => comparable(original) === comparable(name));
      assert.ok(sourceName);
      assert.deepEqual(
        await fs.readFile(path.join(unicodeOutput, outputFolderName, name)),
        await fs.readFile(path.join(unicodeFolder, sourceName)),
        "actual member names retain exact original file bytes",
      );
    }
    assert.equal(
      process.env.LC_ALL,
      "C",
      "backend locale is child-only, never the parent environment",
    );
  } finally {
    if (previousLocale === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = previousLocale;
  }
  assert.equal(
    (await fs.readdir(directory)).some((name) => name.startsWith(".moire-")),
    false,
    "private staging is cleaned on success and failure",
  );
  console.log(
    "[archive-manager] real create/list/extract, no overwrite, traversal/link rejection and staging cleanup passed",
  );
});
