import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSilkBackdrop, readPrecomputedSilkBackdrop, silkBackdropCacheKey } from "@moire/ui";
import {
  generateNativeGreeterSilk,
  installedNativeGreeterSilkOptions,
  nativeGreeterSilkOptions,
} from "./silk";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-greeter-silk-"));
try {
  const options = installedNativeGreeterSilkOptions();
  assert.equal(options.variant, "greeter");
  const file = generateNativeGreeterSilk(directory);
  assert.equal(path.basename(file), `${silkBackdropCacheKey(options)}.rgba`);
  const loaded = readPrecomputedSilkBackdrop(options, directory);
  assert.ok(loaded, "generated greeter pixels must load for the installed palette");
  assert.deepEqual(loaded, createSilkBackdrop(options));

  // The view keys by the palette it actually resolves; a changed theme misses.
  const palette = options.palette!;
  const view = nativeGreeterSilkOptions({
    bg: palette.background,
    accent: palette.filament,
    muted: palette.highlight,
  });
  assert.deepEqual(view, options);
  assert.equal(
    readPrecomputedSilkBackdrop(
      nativeGreeterSilkOptions({
        bg: palette.background,
        accent: 0xff3584e4,
        muted: palette.highlight,
      }),
      directory,
    ),
    null,
  );
  console.log(JSON.stringify({ greeterSilk: "ok", file: path.basename(file) }));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
