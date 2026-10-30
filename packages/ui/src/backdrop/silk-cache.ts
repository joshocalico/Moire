import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSilkBackdrop,
  SILK_PALETTES,
  silkBackdropFromPixels,
  silkBackdropSize,
  type SilkBackdropOptions,
  type SilkBackdropSource,
} from "./silk";

/**
 * Build-time silk pixels. Packages render known backdrops once (for example the
 * greeter's) and runtime loads them instead of stroking ~98k segments.
 *
 * A file name encodes every option that affects pixels plus a digest of the
 * renderer source, so a palette, seed, resolution or algorithm change can only
 * miss the cache and fall back to rendering, never load stale pixels.
 */
export function defaultSilkBackdropCacheDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../precomputed/silk");
}

let rendererDigest: string | null | undefined;
function silkRendererDigest(): string | null {
  if (rendererDigest !== undefined) return rendererDigest;
  try {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "silk.ts"),
    );
    rendererDigest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  } catch {
    // Without the renderer source there is nothing to bind cached pixels to.
    rendererDigest = null;
  }
  return rendererDigest;
}

const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

/** Null when cached pixels cannot be bound to the renderer source. */
export function silkBackdropCacheKey(options: SilkBackdropOptions): string | null {
  const digest = silkRendererDigest();
  if (!digest) return null;
  const palette = options.palette ?? SILK_PALETTES[options.variant];
  const { width, height } = silkBackdropSize(options);
  const seed = options.seed ?? 0;
  if (!Number.isFinite(seed)) return null;
  return [
    "silk",
    digest,
    options.variant,
    `${width}x${height}`,
    `seed${seed}`,
    hex(palette.background),
    hex(palette.filament),
    hex(palette.highlight),
  ].join("-");
}

/** Precomputed pixels for exactly these options, or null on any mismatch. */
export function readPrecomputedSilkBackdrop(
  options: SilkBackdropOptions,
  directory = defaultSilkBackdropCacheDirectory(),
): SilkBackdropSource | null {
  const key = silkBackdropCacheKey(options);
  if (!key) return null;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(directory, `${key}.rgba`));
  } catch {
    return null;
  }
  const { width, height } = silkBackdropSize(options);
  if (bytes.byteLength !== width * height * 4) return null;
  return silkBackdropFromPixels(
    options,
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
}

/** Precomputed pixels when present; otherwise renders exactly like createSilkBackdrop. */
export function loadSilkBackdrop(
  options: SilkBackdropOptions,
  directory = defaultSilkBackdropCacheDirectory(),
): SilkBackdropSource {
  return readPrecomputedSilkBackdrop(options, directory) ?? createSilkBackdrop(options);
}

/** Build time only: render and store the pixels for these options. Returns the file. */
export function writeSilkBackdropCache(options: SilkBackdropOptions, directory: string): string {
  const key = silkBackdropCacheKey(options);
  if (!key) throw new Error("Silk renderer source is unavailable; cannot key cached pixels");
  const source = createSilkBackdrop(options);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${key}.rgba`);
  const staging = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(staging, source.image.rgba);
  fs.renameSync(staging, file);
  return file;
}
