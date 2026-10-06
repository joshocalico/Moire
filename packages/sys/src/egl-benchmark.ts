import { performance } from "node:perf_hooks";
import { EglOutputScaler, type EglCompositionScene } from "./egl-output";
import { closeFd, O_CLOEXEC, O_RDWR, openPath } from "./libc";

// Same retained composition and direct GBM output APIs as the compositor.
// Run while the desktop service is stopped to isolate renderer throughput.
const fd = openPath(process.env.MOIRE_RENDER_NODE ?? "/dev/dri/card0", O_RDWR | O_CLOEXEC);
const scaler = new EglOutputScaler(fd);
const width = 1280;
const height = 800;
const layers: EglCompositionScene["layers"] = Array.from({ length: 8 }, (_, index) => {
  const sourceWidth = 256;
  const sourceHeight = 192;
  const pixels = new Uint8Array(sourceWidth * sourceHeight * 4);
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      pixels.set([x, y, 80 + index * 20, 255], (y * sourceWidth + x) * 4);
    }
  }
  return {
    id: `window-${index}`,
    pixels,
    sourceWidth,
    sourceHeight,
    sourceStride: sourceWidth * 4,
    revision: 1,
    destination: {
      x: (index % 4) * 290 + 30,
      y: Math.floor(index / 4) * 330 + 40,
      width: 320,
      height: 240,
    },
    cornerRadius: 12,
    dropShadow: { offsetX: 0, offsetY: 6, blurRadius: 12, color: 0x80000000 },
    sampling: "linear" as const,
  };
});
const output = {
  id: "benchmark",
  x: 0,
  y: 0,
  width,
  height,
  targetWidth: width,
  targetHeight: height,
};
try {
  if (
    process.env.MOIRE_REQUIRE_HARDWARE === "1" &&
    /llvmpipe|softpipe|swrast/i.test(scaler.info.glRenderer)
  )
    throw new Error(`Hardware renderer required, got ${scaler.info.glRenderer}`);
  const render = (frame: number) => {
    scaler.beginComposition({
      width,
      height,
      clearColor: 0xff12141c,
      layers: layers.map((layer) => ({
        ...layer,
        destination: { ...layer.destination, x: layer.destination.x + (frame % 30) },
      })),
    });
    // Includes glFinish at publication; no asynchronous submission-only timing.
    scaler.renderOutputDirect(output);
  };
  for (let frame = 0; frame < 15; frame++) render(frame);
  for (let batch = 0; batch < 3; batch++) {
    const times: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      const start = performance.now();
      render(frame);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
    console.log(
      JSON.stringify({
        kind: "egl-direct-retained",
        batch,
        width,
        height,
        layers: layers.length,
        renderer: scaler.info.glRenderer,
        version: scaler.info.glVersion,
        frames: times.length,
        meanMs: Number(mean.toFixed(3)),
        medianMs: Number(times[30]!.toFixed(3)),
        p95Ms: Number(times[56]!.toFixed(3)),
        throughputFps: Number((1000 / mean).toFixed(2)),
      }),
    );
  }
} finally {
  scaler.destroy();
  closeFd(fd);
}
