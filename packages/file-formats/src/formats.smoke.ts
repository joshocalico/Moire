/**
 * The small readers against real files: a sips JPEG carrying EXIF, a textutil OpenDocument, zip
 * and tar.gz archives made by bsdtar, and text in several encodings.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archiveSummary } from "./archive";
import { readExif } from "./exif";
import { readFontInfo } from "./font";
import { officeText } from "./office";
import { decodeText } from "./text";
import { listZip, readZipEntry } from "./zip";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name));

// EXIF: camera, capture time, exposure and the orientation tag.
const exif = readExif(fixture("photo.jpg"));
assert.ok(exif);
assert.equal(exif.make, "Moire");
assert.equal(exif.model, "Fixture Cam 1");
assert.equal(exif.orientation, 6);
assert.equal(exif.taken, new Date(2024, 5, 1, 14, 30, 5).getTime());
assert.equal(exif.exposureTime, 1 / 250);
assert.equal(exif.fNumber, 2.8);
assert.equal(exif.iso, 200);
assert.equal(exif.focalLength, 35);
assert.equal(readExif(Buffer.from("not a jpeg")), null);
// A JPEG without EXIF, and a truncated APP1, read as null rather than throwing.
assert.equal(readExif(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
assert.equal(readExif(fixture("photo.jpg").subarray(0, 40)), null);

// OpenDocument text from content.xml.
const odt = officeText(fixture("notes.odt"));
assert.ok(odt?.includes("Quarterly notes"), odt ?? "no text");
assert.ok(odt);
assert.ok(odt.includes("moiré pattern review"));
assert.ok(odt.includes("1200 €"));
assert.equal(officeText(Buffer.from("PK not really")), null);
// Word documents from word/document.xml.
const docx = officeText(fixture("notes.docx"));
assert.ok(docx?.includes("moiré pattern review"), docx ?? "no docx text");

// Font names and glyph counts from the name and maxp tables (the UI's bundled face).
const plex = readFontInfo(
  fs.readFileSync(path.resolve(fixtures, "../../../ui/fonts/IBMPlexSans-Regular.ttf")),
);
assert.equal(plex?.format, "TrueType");
assert.equal(plex?.family, "IBM Plex Sans");
assert.equal(plex?.style, "Regular");
assert.ok((plex?.glyphs ?? 0) > 500);
assert.equal(readFontInfo(Buffer.from("not a font at all")), null);
// A system collection, when this machine has one: its first face.
const collection = "/System/Library/Fonts/Helvetica.ttc";
if (fs.existsSync(collection)) {
  const helvetica = readFontInfo(fs.readFileSync(collection));
  assert.equal(helvetica?.format, "TrueType Collection");
  assert.equal(helvetica?.family, "Helvetica");
  assert.ok((helvetica?.faces ?? 0) > 1);
}

// Zip central directory and a member.
const zip = listZip(fixture("bundle.zip"));
assert.ok(zip);
assert.deepEqual(
  zip.filter((entry) => !entry.isDir).map((entry) => [entry.name, entry.size]),
  [
    ["readme.txt", 6],
    ["docs/blank.bin", 5000],
    ["docs/deep/a.txt", 5],
  ],
);
assert.equal(readZipEntry(fixture("bundle.zip"), "readme.txt")?.toString(), "hello\n");
assert.equal(readZipEntry(fixture("bundle.zip"), "missing"), null);

// Archive summaries: top-level entries with sizes and item counts, the same for zip and tar.gz.
for (const name of ["bundle.zip", "bundle.tar.gz"]) {
  const summary = await archiveSummary(path.join(fixtures, name));
  assert.equal(summary.files, 3, name);
  assert.equal(summary.folders, 2, name);
  assert.equal(summary.totalSize, 5011, name);
  assert.equal(summary.truncated, false);
  assert.deepEqual(
    summary.entries.map((entry) => [entry.name, entry.isDir, entry.size, entry.items]),
    [
      ["docs", true, 5005, name === "bundle.zip" ? 3 : 3],
      ["readme.txt", false, 6, 0],
    ],
    name,
  );
}
// Plain gzip is one member, sized from its trailer, even when bsdtar refuses it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "file-formats-"));
try {
  const { gzipSync } = await import("node:zlib");
  const gz = path.join(scratch, "report.txt.gz");
  fs.writeFileSync(gz, gzipSync(Buffer.alloc(1234, 65)));
  const plain = await archiveSummary(gz);
  assert.equal(plain.files, 1);
  assert.equal(plain.entries[0]?.name, "report.txt");
  assert.equal(plain.totalSize, 1234);
  const junk = path.join(scratch, "junk.zip");
  fs.writeFileSync(junk, "not an archive");
  await assert.rejects(archiveSummary(junk));
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(archiveSummary(path.join(fixtures, "bundle.zip"), aborted.signal));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

// Text encodings.
assert.deepEqual(decodeText(Buffer.from("plain ascii\n")), {
  text: "plain ascii\n",
  encoding: "ASCII",
});
assert.equal(decodeText(Buffer.from("café ☃"))?.encoding, "UTF-8");
assert.equal(decodeText(Buffer.from("café", "latin1"))?.encoding, "Latin-1");
assert.equal(decodeText(Buffer.from("café", "latin1"))?.text, "café");
const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("héllo", "utf16le")]);
assert.deepEqual(decodeText(utf16), { text: "héllo", encoding: "UTF-16LE" });
const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("hé", "utf16le").swap16()]);
assert.deepEqual(decodeText(utf16be), { text: "hé", encoding: "UTF-16BE" });
// A capped read that cuts "☃" (3 bytes) in half is still UTF-8.
assert.equal(decodeText(Buffer.from("ok ☃").subarray(0, 4), true)?.encoding, "UTF-8");
assert.equal(decodeText(Buffer.from([1, 2, 0, 4])), null);

console.log(
  "file-formats readers: exif, office (odt, docx), fonts, zip, archive summary, text encodings ok",
);
