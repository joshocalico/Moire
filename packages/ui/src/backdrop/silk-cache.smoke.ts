import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSilkBackdrop, type SilkBackdropOptions } from "./silk";
import {
  loadSilkBackdrop,
  readPrecomputedSilkBackdrop,
  silkBackdropCacheKey,
  writeSilkBackdropCache,
} from "./silk-cache";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-silk-cache-"));
try {
  const options: SilkBackdropOptions = {
    variant: "greeter",
    palette: { background: 0xff101420, filament: 0xff8a7aff, highlight: 0xffa0a6b8 },
  };
  const key = silkBackdropCacheKey(options);
  assert.ok(key, "renderer source must be available to key cached pixels");

  // Every pixel-affecting option is part of the key.
  const variants: SilkBackdropOptions[] = [
    { ...options, palette: { ...options.palette!, background: 0xff101421 } },
    { ...options, palette: { ...options.palette!, filament: 0xff8a7afe } },
    { ...options, palette: { ...options.palette!, highlight: 0xffa0a6b9 } },
    { ...options, seed: 1 },
    { ...options, resolution: "high" },
    { ...options, variant: "fold-e" },
    { variant: "greeter" },
  ];
  const keys = new Set([key, ...variants.map(silkBackdropCacheKey)]);
  assert.equal(keys.size, variants.length + 1, "distinct options must never share cached pixels");
  assert.equal(silkBackdropCacheKey({ ...options, seed: 0, resolution: "standard" }), key);

  // A miss renders exactly like createSilkBackdrop.
  assert.equal(readPrecomputedSilkBackdrop(options, directory), null);
  let started = performance.now();
  const rendered = createSilkBackdrop(options);
  const renderMs = performance.now() - started;
  const fallback = loadSilkBackdrop(options, directory);
  assert.deepEqual(fallback, rendered);

  const file = writeSilkBackdropCache(options, directory);
  assert.equal(path.basename(file), `${key}.rgba`);
  assert.deepEqual(fs.readdirSync(directory), [path.basename(file)], "no staging files remain");
  started = performance.now();
  const loaded = loadSilkBackdrop(options, directory);
  const loadMs = performance.now() - started;
  assert.deepEqual(loaded, rendered, "cached source must match rendered metadata and pixels");
  assert.equal(Object.getPrototypeOf(loaded.image.rgba), Uint8Array.prototype);
  assert.ok(Object.isFrozen(loaded) && Object.isFrozen(loaded.image));
  assert.notEqual(loadSilkBackdrop(options, directory).image.rgba, loaded.image.rgba);

  // Nearby options never reuse these pixels.
  for (const other of variants) assert.equal(readPrecomputedSilkBackdrop(other, directory), null);

  // A truncated or resized file is ignored and rendered instead.
  fs.writeFileSync(file, Buffer.alloc(16));
  assert.equal(readPrecomputedSilkBackdrop(options, directory), null);
  assert.deepEqual(loadSilkBackdrop(options, directory), rendered);

  console.log(
    JSON.stringify({
      silkCache: "ok",
      key,
      renderMs: Math.round(renderMs),
      loadMs: Number(loadMs.toFixed(1)),
    }),
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
