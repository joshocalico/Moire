/**
 * Thumbnails end to end, through the worker pool: real files of every kind with a picture, the
 * freedesktop disk cache (named by URI hash, invalidated by mtime), cancellation, and that the
 * render thread keeps ticking while a 12 MP photo decodes.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCachedThumbnail, thumbnailFile, thumbnailIdentity } from "./thumbnail-cache";
import {
  cachedThumbnail,
  requestFontSample,
  requestThumbnail,
  type ThumbnailRequest,
} from "./thumbnails";
import type { ImageData } from "./load";

const here = path.dirname(fileURLToPath(import.meta.url));
const formats = path.resolve(here, "../../../file-formats/src/fixtures");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "moire-thumbnails-"));
process.env.XDG_CACHE_HOME = path.join(scratch, "cache");

const has = (tool: string) => {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

function request(file: string, width = 96, height = 96, fit: "contain" | "cover" = "contain") {
  const stat = fs.statSync(file);
  return {
    file,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    width,
    height,
    fit,
  } satisfies ThumbnailRequest;
}

async function picture(
  file: string,
  width = 96,
  height = 96,
  fit: "contain" | "cover" = "contain",
) {
  const result = await requestThumbnail(request(file, width, height, fit));
  assert.equal(result.kind, "image", `${path.basename(file)}: ${JSON.stringify(result)}`);
  return result.kind === "image" ? result : null!;
}

function pixel(image: ImageData, x: number, y: number): [number, number, number, number] {
  const at = (y * image.width + x) * 4;
  return [image.rgba[at]!, image.rgba[at + 1]!, image.rgba[at + 2]!, image.rgba[at + 3]!];
}

const near = (actual: number[], expected: number[], tolerance = 40) =>
  expected.every((value, index) => Math.abs(actual[index]! - value) <= tolerance);

try {
  // EXIF orientation 6: stored 96×64 with a green top strip, red left and blue right half; upright
  // it is 64×96 with red on top, blue below and the green strip down the right edge.
  const photo = path.join(scratch, "photo.jpg");
  fs.copyFileSync(path.join(formats, "photo.jpg"), photo);
  const upright = await picture(photo, 64, 96);
  assert.deepEqual([upright.image.width, upright.image.height], [64, 96]);
  assert.deepEqual(upright.source, { width: 64, height: 96 });
  assert.ok(near(pixel(upright.image, 10, 10), [220, 40, 40, 255]), "red on top");
  assert.ok(near(pixel(upright.image, 10, 85), [40, 70, 220, 255]), "blue below");
  assert.ok(near(pixel(upright.image, 60, 48), [40, 200, 60, 255]), "green strip on the right");

  // The bucket thumbnail is on disk under the freedesktop name, with its identity in tEXt.
  const stat = fs.statSync(photo);
  const identity = thumbnailIdentity(photo, stat.mtimeMs, stat.size);
  assert.ok(
    fs.existsSync(thumbnailFile(identity, ["normal", 128])),
    "normal-size thumbnail written",
  );
  assert.ok((await readCachedThumbnail(identity, ["normal", 128]))?.width === 64);
  assert.equal(fs.statSync(thumbnailFile(identity, ["normal", 128])).mode & 0o777, 0o600);
  // A different mtime is a different file: the cached picture no longer counts.
  assert.equal(
    await readCachedThumbnail({ ...identity, mtime: identity.mtime + 1 }, ["normal", 128]),
    null,
  );

  // Cover fills the box exactly; contain keeps the aspect.
  const cover = await picture(photo, 40, 40, "cover");
  assert.deepEqual([cover.image.width, cover.image.height], [40, 40]);

  // PNG and GIF decode here, too.
  const png = await picture(path.join(here, "fixtures/source-64x48.png"), 32, 32);
  assert.deepEqual([png.image.width, png.image.height], [32, 24]);
  const gif = await picture(path.join(here, "fixtures/sips.gif"), 200, 200);
  assert.ok(gif.image.width > 0 && gif.image.height > 0);

  // Album art embedded in an MP3.
  const art = await picture(path.join(formats, "media-cbr.mp3"));
  assert.ok(art.image.width > 0);

  // A font's "Aa", drawn in the face itself, has ink in it.
  const font = path.resolve(here, "../../fonts/IBMPlexSans-Regular.ttf");
  const glyphs = await picture(font, 128, 128);
  assert.ok(glyphs.image.rgba.some((value, index) => index % 4 === 3 && value > 200));
  const sample = await requestFontSample(
    font,
    [{ text: "Sphinx of black quartz", size: 24 }],
    0xff000000,
    300,
  );
  assert.equal(sample.kind, "image");

  // External tools are optional; with them, video posters and PDF pages appear.
  if (has("ffmpeg")) await picture(path.join(formats, "media.mp4"));
  if (has("pdftoppm")) await picture(path.join(formats, "pdf-quartz-text.pdf"), 128, 128);

  // Any page of a PDF: pages 1 and 2 differ, a page past the end is a value, not a crash, and a
  // page asked twice comes from memory.
  if (has("pdftoppm")) {
    const pages = path.join(formats, "pdf-quartz-two-pages.pdf");
    const page = (number: number) =>
      requestThumbnail({ ...request(pages, 128, 128), page: number });
    const [first, second] = await Promise.all([page(1), page(2)]);
    assert.ok(first.kind === "image" && second.kind === "image", "pages 1 and 2 render");
    assert.notDeepEqual(first.image.rgba, second.image.rgba, "page 2 is not page 1");
    assert.ok(["none", "error"].includes((await page(3)).kind), "page 3 does not exist");
    assert.equal(cachedThumbnail({ ...request(pages, 128, 128), page: 2 }), second);
    assert.equal(await page(2), second, "the same page again is a memory hit");
  }

  // Files without a picture say so as a value.
  const text = path.join(scratch, "notes.txt");
  fs.writeFileSync(text, "plain words");
  assert.equal((await requestThumbnail(request(text))).kind, "none");
  const broken = path.join(scratch, "broken.jpg");
  fs.writeFileSync(
    broken,
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4]), Buffer.alloc(32)]),
  );
  assert.equal((await requestThumbnail(request(broken))).kind, "error");

  // A cancelled request rejects and never resolves later.
  const big = path.join(scratch, "big.jpg");
  execFileSync(
    "sips",
    [
      "-s",
      "format",
      "jpeg",
      "-z",
      "3000",
      "4000",
      path.join(here, "fixtures/source-64x48.png"),
      "--out",
      big,
    ],
    {
      stdio: "ignore",
    },
  );
  const controller = new AbortController();
  const cancelled = requestThumbnail(request(big, 300, 300), controller.signal);
  controller.abort();
  await assert.rejects(cancelled);

  // The render thread stays free while a 12 MP photo decodes in the worker.
  let lag = 0;
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    lag = Math.max(lag, now - last - 5);
    last = now;
  }, 5);
  const started = performance.now();
  const large = await picture(big, 512, 512);
  clearInterval(ticker);
  assert.equal(large.image.width, 512);
  assert.ok(lag < 60, `main thread stalled ${lag.toFixed(0)} ms`);
  console.log(
    `thumbnails: 12 MP photo in ${(performance.now() - started).toFixed(0)} ms, worst frame delay ${lag.toFixed(0)} ms`,
  );
  console.log(
    "thumbnails: jpeg (EXIF-upright), png, gif, mp3 art, font, video, pdf pages, disk cache, cancel ok",
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
