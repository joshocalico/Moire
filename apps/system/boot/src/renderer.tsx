import { fileURLToPath } from "node:url";
import path from "node:path";
import { openKmsOutput, closeKmsOutput, presentKmsPixels } from "@moire/sys";
import { installUiFonts, setUiScaleFactor } from "@moire/ui";
import { loadBootArtwork, packBootScanout, BOOT_MAX_WIDTH, BOOT_MAX_HEIGHT } from "./assets";
import { createBootRoot } from "./view";
import { createRendererLifetime } from "./renderer-lifetime";

/** Static native stage. Animated/hardware presentation has a separate gate. */
export async function runBootRenderer(): Promise<void> {
  if (process.platform !== "linux") throw new Error("Boot presentation requires Linux");
  if (!process.send) throw new Error("Boot renderer must be owned by its guardian");
  const artwork = process.env.MOIRE_BOOT_ARTWORK;
  const cardPath = process.env.MOIRE_BOOT_CARD;
  if (!artwork || !cardPath) throw new Error("Guardian must supply boot artwork and DRM card");
  const source = loadBootArtwork(artwork);
  const lifetime = createRendererLifetime();
  let output: ReturnType<typeof openKmsOutput> | null = null;
  let root: ReturnType<typeof createBootRoot> | null = null;
  try {
    if (lifetime.isStopped()) return;
    output = openKmsOutput(cardPath, undefined, {
      maxWidth: BOOT_MAX_WIDTH,
      maxHeight: BOOT_MAX_HEIGHT,
    });
    setUiScaleFactor(1);
    await installUiFonts();
    if (lifetime.isStopped()) return;
    root = createBootRoot(output.width, output.height, source);
    const frame = root.softwareFrame();
    const feedback = await presentKmsPixels(output, packBootScanout(frame, output.pitch));
    await lifetime.notifyScanoutAccepted(feedback);
    // No artificial duration or progress. The actual boot lifecycle ends it.
    if (!lifetime.isStopped()) await lifetime.waitForStop();
  } finally {
    try {
      root?.close();
    } finally {
      try {
        if (output) closeKmsOutput(output);
      } finally {
        lifetime.close();
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBootRenderer();
}
