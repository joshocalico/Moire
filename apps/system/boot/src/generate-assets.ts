import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSilkBackdrop } from "@moire/ui";
import { BOOT_SOURCE_BYTES } from "./assets";

/** Run at build time only; boot never generates the 98,304 Fold segments. */
export function generateBootArtwork(destination: string): void {
  const source = createSilkBackdrop({ variant: "fold-e" });
  if (source.image.rgba.byteLength !== BOOT_SOURCE_BYTES)
    throw new Error("Unexpected shared Fold source dimensions");
  fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
  fs.writeFileSync(destination, source.image.rgba);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Pass the build-time boot Fold RGBA destination");
  generateBootArtwork(destination);
}
