/**
 * The preview model against real files of every kind: what each loader reads, the facts and
 * summaries the surfaces show, failures as values, the cache (one load shared, versions keyed by
 * mtime and size), cancellation, and a folder's size counted with progress.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cachedPreview, requestPreview } from "./cache";
import { loadPreview } from "./loaders";
import {
  exposureSettings,
  hasPicture,
  previewFacts,
  previewKindFor,
  previewSummary,
  type Preview,
  type PreviewSubject,
} from "./model";

const here = path.dirname(fileURLToPath(import.meta.url));
const formats = path.resolve(here, "../../../../../packages/file-formats/src/fixtures");
const photos = path.resolve(here, "../fixtures");
const plex = path.resolve(here, "../../../../../packages/ui/fonts/IBMPlexSans-Regular.ttf");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "files-preview-"));

function subject(file: string): PreviewSubject {
  const stat = fs.statSync(file);
  return {
    path: file,
    name: path.basename(file),
    isDir: stat.isDirectory(),
    size: stat.size,
    modified: stat.mtimeMs,
  };
}

async function preview(file: string): Promise<Preview> {
  return loadPreview(subject(file), new AbortController().signal);
}

function facts(value: Preview): Record<string, string> {
  return Object.fromEntries(previewFacts(value));
}

try {
  // Kinds by name; pictures for the kinds that have one.
  assert.equal(previewKindFor({ name: "a.JPG", isDir: false }), "image");
  assert.equal(previewKindFor({ name: "main.rs", isDir: false }), "text");
  assert.equal(previewKindFor({ name: "Makefile", isDir: false }), "text");
  assert.equal(previewKindFor({ name: "notes.docx", isDir: false }), "document");
  assert.equal(previewKindFor({ name: "x.bin", isDir: false }), "none");
  assert.equal(previewKindFor({ name: "Photos", isDir: true }), "folder");
  assert.ok(hasPicture({ name: "clip.mp4", isDir: false }));
  assert.ok(hasPicture({ name: "Plex.ttf", isDir: false }));
  assert.ok(!hasPicture({ name: "notes.txt", isDir: false }));
  assert.equal(
    exposureSettings({ exposureTime: 1 / 250, fNumber: 2.8, iso: 200, focalLength: 35 }),
    "1/250 s · f/2.8 · ISO 200 · 35 mm",
  );
  assert.equal(
    exposureSettings({ exposureTime: 2, fNumber: null, iso: null, focalLength: null }),
    "2 s",
  );

  // Images: upright dimensions and the camera's EXIF.
  const portrait = await preview(path.join(photos, "tower-portrait.jpg"));
  assert.equal(portrait.kind, "image");
  assert.deepEqual(facts(portrait), {
    Dimensions: "400 × 600 pixels",
    Camera: "Apple iPhone 15 Pro",
    Taken: new Date(2024, 6, 4, 21, 15, 30).toLocaleString(),
    Exposure: "1/60 s · f/1.8 · ISO 640 · 7 mm",
  });
  assert.equal(previewSummary(portrait), "400 × 600 · Apple iPhone 15 Pro");
  const tram = await preview(path.join(photos, "lisbon-tram.jpg"));
  assert.equal(facts(tram).Camera, "Fujifilm X-T4", "the maker is added when the model lacks it");
  const gate = await preview(path.join(photos, "garden-gate.jpg"));
  assert.equal(facts(gate).Camera, "Canon EOS R6", "and not repeated when the model has it");
  const gif = await preview(
    path.resolve(here, "../../../../../packages/ui/src/image/fixtures/sips.gif"),
  );
  assert.equal(gif.kind === "image" && gif.format, "GIF");

  // Text and code: lines, encoding, language; Markdown is marked for rendering.
  const code = path.join(scratch, "main.rs");
  fs.writeFileSync(code, 'fn main() {\n    println!("héllo");\n}\n');
  const rust = await preview(code);
  assert.ok(rust.kind === "text");
  assert.equal(rust.language, "rust");
  assert.equal(rust.markdown, false);
  assert.deepEqual(facts(rust), { Lines: "3", Encoding: "UTF-8" });
  const big = path.join(scratch, "huge.log");
  fs.writeFileSync(big, "line of a long log\n".repeat(40_000));
  const log = await preview(big);
  assert.ok(log.kind === "text" && log.truncated, "only the start of a large file is read");
  assert.match(facts(log).Lines!, /\+$/);
  assert.ok(log.text.split("\n").length <= 400, "the shown text is capped");
  const markdown = path.join(scratch, "readme.md");
  fs.writeFileSync(markdown, "# Title\n\nSome *words*.\n");
  const md = await preview(markdown);
  assert.ok(md.kind === "text" && md.markdown);
  const binary = path.join(scratch, "data.txt");
  fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]));
  assert.equal((await preview(binary)).kind, "none", "binary 'text' has no text preview");

  // PDF: pages, title and its opening words.
  const pdf = await preview(path.join(formats, "pdf-quartz-two-pages.pdf"));
  assert.ok(pdf.kind === "pdf");
  assert.equal(pdf.pages, 2);
  assert.match(pdf.excerpt, /Line 1 of the longer document/);
  assert.equal(facts(pdf).Pages, "2");

  // Office documents: their words.
  const odt = await preview(path.join(formats, "notes.odt"));
  assert.ok(odt.kind === "document" && odt.excerpt.includes("Quarterly notes"));
  const docx = await preview(path.join(formats, "notes.docx"));
  assert.ok(docx.kind === "document" && docx.excerpt.includes("moiré pattern review"));

  // Audio: tags, duration and format; whether it carries art.
  const song = await preview(path.join(formats, "media-cbr.mp3"));
  assert.ok(song.kind === "audio");
  assert.ok(song.hasArt);
  const songFacts = facts(song);
  assert.ok(songFacts.Title && songFacts.Artist && songFacts.Duration, JSON.stringify(songFacts));
  assert.match(songFacts.Format!, /kHz/);
  assert.ok(previewSummary(song)?.includes(songFacts.Artist!));

  // Video: duration and size from the container.
  const clip = await preview(path.join(formats, "media.mp4"));
  assert.ok(clip.kind === "video");
  assert.ok(clip.width && clip.height && clip.duration);
  assert.equal(facts(clip).Dimensions, `${clip.width} × ${clip.height} pixels`);

  // Archives: top entries with sizes, and the totals.
  const zip = await preview(path.join(formats, "bundle.zip"));
  assert.ok(zip.kind === "archive");
  assert.deepEqual(
    zip.summary.entries.map((entry) => entry.name),
    ["docs", "readme.txt"],
  );
  assert.deepEqual(facts(zip), { Contents: "3 files · 2 folders", Uncompressed: "4.9 KB" });

  // Fonts: family, style, glyphs.
  const font = await preview(plex);
  assert.ok(font.kind === "font");
  assert.equal(facts(font).Family, "IBM Plex Sans");
  assert.equal(previewSummary(font), "IBM Plex Sans · Regular");

  // Folders: counts and first children at once, then the size as it is counted.
  const folder = path.join(scratch, "Trip");
  fs.mkdirSync(path.join(folder, "Day 1"), { recursive: true });
  fs.writeFileSync(path.join(folder, "plan.txt"), "x".repeat(1000));
  fs.writeFileSync(path.join(folder, "Day 1", "photo.jpg"), "y".repeat(3000));
  fs.writeFileSync(path.join(folder, ".hidden"), "z");
  const progress: Preview[] = [];
  const trip = await loadPreview(subject(folder), new AbortController().signal, (partial) =>
    progress.push(partial),
  );
  assert.ok(trip.kind === "folder");
  assert.equal(progress[0]?.kind === "folder" && progress[0].size.state, "measuring");
  assert.deepEqual(trip.children, [
    { name: "Day 1", isDir: true },
    { name: "plan.txt", isDir: false },
  ]);
  assert.equal(trip.hidden, 1);
  assert.deepEqual(trip.size, {
    bytes: 4001,
    files: 3,
    byKind: { document: 1000, image: 3000, other: 1 },
    state: "complete",
  });
  assert.equal(facts(trip).Size, "3.9 KB in 3 files");
  assert.deepEqual(trip.pictures, [], "pictures are direct children only");
  assert.ok(
    progress.every((partial) => partial.kind === "folder" && partial.size.byKind),
    "progress carries the tally by kind",
  );

  // A folder's mosaic: the first four direct children with pictures, images first.
  const album = path.join(scratch, "Album");
  fs.mkdirSync(path.join(album, "Inside"), { recursive: true });
  for (const name of ["a.pdf", "b.png", "c.jpg", "d.mp4", "e.mp3", "notes.txt", ".hidden.jpg"])
    fs.writeFileSync(path.join(album, name), name);
  fs.writeFileSync(path.join(album, "Inside", "deep.jpg"), "deep");
  const albumPreview = await preview(album);
  assert.ok(albumPreview.kind === "folder");
  assert.deepEqual(
    albumPreview.pictures.map((picture) => picture.name),
    ["b.png", "c.jpg", "d.mp4", "a.pdf"],
  );
  const png = albumPreview.pictures[0]!;
  const pngStat = fs.lstatSync(path.join(album, "b.png"));
  assert.deepEqual(png, {
    path: path.join(album, "b.png"),
    name: "b.png",
    isDir: false,
    size: pngStat.size,
    modified: pngStat.mtimeMs,
  });

  // Failures are values; cancellation rejects.
  const missing = await loadPreview(
    { path: path.join(scratch, "gone.pdf"), name: "gone.pdf", isDir: false, size: 1, modified: 1 },
    new AbortController().signal,
  );
  assert.equal(missing.kind, "error");
  assert.ok(previewFacts(missing)[0]?.[0] === "Preview");
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(loadPreview(subject(folder), aborted.signal));

  // The cache: one load shared, kept by version, a new version read again.
  const notes = path.join(scratch, "notes.txt");
  fs.writeFileSync(notes, "first");
  const first = subject(notes);
  const [a, b] = await Promise.all([
    requestPreview(first, new AbortController().signal),
    requestPreview(first, new AbortController().signal),
  ]);
  assert.equal(a, b, "concurrent asks share one load");
  assert.equal(cachedPreview(first), a);
  fs.writeFileSync(notes, "second version");
  const second = subject(notes);
  assert.equal(cachedPreview(second), null, "a changed file is a new version");
  const updated = await requestPreview(second, new AbortController().signal);
  assert.ok(updated.kind === "text" && updated.text === "second version");
  // An abandoned request rejects; another asker still gets the preview.
  const leaving = new AbortController();
  const third = { ...second, modified: second.modified + 1 };
  const left = requestPreview(third, leaving.signal);
  const stays = requestPreview(third, new AbortController().signal);
  leaving.abort();
  await assert.rejects(left);
  assert.equal((await stays).kind, "text");

  console.log(
    "[files/preview] image (EXIF, upright), text/code/markdown, pdf, office, audio, video, archive, font, folder size, errors, cache and cancel passed",
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
