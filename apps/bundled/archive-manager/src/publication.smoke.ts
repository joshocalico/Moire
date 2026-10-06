import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync, createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runTool } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import { createArchive, extractArchive, listArchive, MAX_GZIP_BYTES } from "./backend";

await withFixture(async (fixture) => {
  const source = path.join(fixture, "item.txt"),
    archive = path.join(fixture, "items.tar.gz");
  await fs.writeFile(source, "ARCHIVE CONTENT");
  await createArchive([source], archive);
  const originalLstat = fs.lstat;
  // Deterministically insert a real concurrent destination after the real absent check.
  for (const kind of ["empty-directory", "file", "directory"] as const) {
    const destination = path.join(fixture, `race-${kind}`);
    let inserted = false;
    Object.defineProperty(fs, "lstat", {
      value: async (
        target: Parameters<typeof fs.lstat>[0],
        options?: Parameters<typeof fs.lstat>[1],
      ) => {
        try {
          return await originalLstat(target, options);
        } catch (error) {
          if (
            target === destination &&
            !inserted &&
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            inserted = true;
            if (kind === "file") await fs.writeFile(destination, "CONCURRENT FILE");
            else {
              await fs.mkdir(destination);
              if (kind === "directory")
                await fs.writeFile(path.join(destination, "unrelated.txt"), "CONCURRENT CHILD");
            }
          }
          throw error;
        }
      },
    });
    try {
      await assert.rejects(extractArchive(archive, destination), { code: "EEXIST" });
    } finally {
      Object.defineProperty(fs, "lstat", { value: originalLstat });
    }
    assert.equal(inserted, true, "fixture reached actual publication boundary");
    if (kind === "file") assert.equal(await fs.readFile(destination, "utf8"), "CONCURRENT FILE");
    else {
      assert.deepEqual(
        await fs.readdir(destination),
        kind === "directory" ? ["unrelated.txt"] : [],
      );
      if (kind === "directory")
        assert.equal(
          await fs.readFile(path.join(destination, "unrelated.txt"), "utf8"),
          "CONCURRENT CHILD",
        );
    }
  }
  const destination = path.join(fixture, "published-before-error");
  let observedPublication = false;
  Object.defineProperty(fs, "lstat", {
    value: async (
      target: Parameters<typeof fs.lstat>[0],
      options?: Parameters<typeof fs.lstat>[1],
    ) => {
      const stat = await originalLstat(target, options);
      if (target === destination) {
        observedPublication = true;
        throw Object.assign(new Error("fixture EIO after actual publication"), { code: "EIO" });
      }
      return stat;
    },
  });
  try {
    await assert.rejects(extractArchive(archive, destination), /fixture EIO/);
  } finally {
    Object.defineProperty(fs, "lstat", { value: originalLstat });
  }
  assert.equal(observedPublication, true);
  assert.equal(
    await fs.readFile(path.join(destination, "item.txt"), "utf8"),
    "ARCHIVE CONTENT",
    "post-publication errors never remove visible data",
  );
  const cancelled = new AbortController(),
    cancelledDestination = path.join(fixture, "cancelled");
  Object.defineProperty(fs, "lstat", {
    value: async (
      target: Parameters<typeof fs.lstat>[0],
      options?: Parameters<typeof fs.lstat>[1],
    ) => {
      try {
        return await originalLstat(target, options);
      } catch (error) {
        if (target === cancelledDestination) cancelled.abort();
        throw error;
      }
    },
  });
  try {
    await assert.rejects(
      extractArchive(archive, cancelledDestination, cancelled.signal),
      /cancelled/,
    );
  } finally {
    Object.defineProperty(fs, "lstat", { value: originalLstat });
  }
  await assert.rejects(fs.lstat(cancelledDestination), { code: "ENOENT" });

  const plain = path.join(fixture, "note #1.txt.gz");
  const bytes = Buffer.from([0, 255, 1, 13, 10, 65]);
  await fs.writeFile(plain, gzipSync(bytes));
  const listing = await listArchive(plain);
  assert.equal(listing.kind, "gzip");
  assert.deepEqual(listing.entries, ["note #1.txt"]);
  const plainOutput = path.join(fixture, "plain-output");
  await extractArchive(plain, plainOutput);
  assert.deepEqual(await fs.readFile(path.join(plainOutput, "note #1.txt")), bytes);
  await assert.rejects(extractArchive(plain, plainOutput), { code: "EEXIST" });
  const disguised = path.join(fixture, "binary.data");
  await fs.writeFile(disguised, gzipSync("magic determines compression"));
  assert.equal((await listArchive(disguised)).kind, "gzip", "extension is not type authority");
  const fake = path.join(fixture, "not-gzip.gz");
  await fs.writeFile(fake, "ordinary text");
  await assert.rejects(listArchive(fake), /archive format/);
  const truncated = path.join(fixture, "truncated.gz");
  await fs.writeFile(truncated, gzipSync("truncated stream").subarray(0, 12));
  await assert.rejects(listArchive(truncated));
  const corruptTar = path.join(fixture, "damaged.tar.gz");
  await fs.writeFile(corruptTar, gzipSync("not a tar"));
  await assert.rejects(listArchive(corruptTar), /damaged or unsupported tar/);
  for (const size of [300, 512]) {
    const malformedTarHeader = Buffer.alloc(size);
    malformedTarHeader.write("bad checksum");
    malformedTarHeader.write("ustar", 257);
    const malformedTar = path.join(fixture, `malformed-${size}.data`);
    await fs.writeFile(malformedTar, gzipSync(malformedTarHeader));
    await assert.rejects(listArchive(malformedTar), /damaged or unsupported tar/);
  }
  const emptyMembers = path.join(fixture, "empty-members.txt"),
    emptyTar = path.join(fixture, "empty.tar.gz");
  await fs.writeFile(emptyMembers, "");
  await runTool("bsdtar", ["-czf", emptyTar, "-T", emptyMembers]);
  assert.equal((await listArchive(emptyTar)).kind, "archive");
  const emptyTarOutput = path.join(fixture, "empty-tar-output");
  await extractArchive(emptyTar, emptyTarOutput);
  assert.deepEqual(await fs.readdir(emptyTarOutput), []);
  const empty = path.join(fixture, "empty.gz");
  await fs.writeFile(empty, gzipSync(Buffer.alloc(0)));
  const emptyOutput = path.join(fixture, "empty-output");
  await extractArchive(empty, emptyOutput);
  assert.equal((await fs.stat(path.join(emptyOutput, "empty"))).size, 0);
  const oversized = path.join(fixture, "oversized.gz");
  const chunk = Buffer.alloc(1024 * 1024, 120);
  await pipeline(
    Readable.from(
      (function* () {
        for (let n = 0; n <= MAX_GZIP_BYTES / chunk.length; n++) yield chunk;
      })(),
    ),
    createGzip(),
    createWriteStream(oversized),
  );
  await assert.rejects(listArchive(oversized), /64 MiB/);
  assert.equal(
    (await fs.readdir(fixture)).some((name) => name.startsWith(".moire-")),
    false,
    "only owned staging cleaned after success/race/error/cancel",
  );
  console.log(
    "Archive actual no-replace publication/races, post-publication error retention, cancellation, gzip type/checksum/limit and exact binary roundtrip passed",
  );
});
