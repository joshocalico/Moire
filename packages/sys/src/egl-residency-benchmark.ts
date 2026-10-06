import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { EglOutputScaler, EglResidentImage, type EglCompositionScene } from "./egl-output";
import { GbmDevice } from "./gbm";
import { closeFd, O_CLOEXEC, O_RDWR, openPath } from "./libc";

type Metrics = ReturnType<EglOutputScaler["getTransferMetrics"]>;
type Counter = NonNullable<Metrics["textureUpload"]>;
type Operation = "textureUpload" | "gpuReadback" | "dmabufImport" | "gpuCopy" | "cpuCopy";
type Path = "gbm-cpu-snapshot" | "gpu-owned-snapshot";
type Updates = "idle" | "one" | "all";
type Stage = { wallMs: number; processCpuMs: number; counters: Metrics };
type Window = {
  channel: string;
  revision: number;
  producerPixels: Uint8Array;
  pixels: Uint8Array | EglResidentImage;
  stride: number;
};

export function benchmarkConfig(env: NodeJS.ProcessEnv) {
  const iterations = Number(env.MOIRE_BENCH_ITERATIONS ?? "20");
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 40) {
    throw new Error("MOIRE_BENCH_ITERATIONS must be an integer from 1 to 40");
  }
  const size = env.MOIRE_BENCH_WINDOW ?? "320x200";
  if (size !== "320x200" && size !== "640x400") {
    throw new Error("MOIRE_BENCH_WINDOW must be 320x200 or 640x400");
  }
  return {
    iterations,
    width: size === "320x200" ? 320 : 640,
    height: size === "320x200" ? 200 : 400,
    blur: env.MOIRE_BENCH_BLUR === "1",
    overlap: env.MOIRE_BENCH_OVERLAP !== "0",
    renderNode: env.MOIRE_RENDER_NODE ?? "/dev/dri/card0",
  };
}

function counterDelta(before: Counter | null, after: Counter | null): Counter {
  if (!before || !after) throw new Error("Benchmark requires enabled native transfer counters");
  return { count: after.count - before.count, bytes: after.bytes - before.bytes };
}

function delta(before: Metrics, after: Metrics): Metrics {
  if (!before.completionWait || !after.completionWait) {
    throw new Error("Benchmark requires enabled completion counters");
  }
  return {
    enabled: true,
    textureUpload: counterDelta(before.textureUpload, after.textureUpload),
    gpuReadback: counterDelta(before.gpuReadback, after.gpuReadback),
    dmabufImport: counterDelta(before.dmabufImport, after.dmabufImport),
    gpuCopy: counterDelta(before.gpuCopy, after.gpuCopy),
    cpuCopy: counterDelta(before.cpuCopy, after.cpuCopy),
    completionWait: {
      count: after.completionWait.count - before.completionWait.count,
      cpuElapsedMs: after.completionWait.cpuElapsedMs - before.completionWait.cpuElapsedMs,
    },
    gpuExecutionMs: null,
  };
}

function emptyStage(scaler: EglOutputScaler): Stage {
  const current = scaler.getTransferMetrics();
  return { wallMs: 0, processCpuMs: 0, counters: delta(current, current) };
}

function requireCount(metrics: Metrics, operation: Operation, expected: number): void {
  const observed = metrics[operation];
  if (!observed || observed.count !== expected) {
    throw new Error(`Unexpected ${operation}: expected ${expected}, observed ${observed?.count}`);
  }
}

function measure<T>(scaler: EglOutputScaler, stage: Stage, action: () => T): T {
  const before = scaler.getTransferMetrics();
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  const result = action();
  const cpu = process.cpuUsage(cpuStarted);
  const observed = delta(before, scaler.getTransferMetrics());
  stage.wallMs += performance.now() - started;
  stage.processCpuMs += (cpu.user + cpu.system) / 1000;
  const operations: Operation[] = [
    "textureUpload",
    "gpuReadback",
    "dmabufImport",
    "gpuCopy",
    "cpuCopy",
  ];
  for (const operation of operations) {
    const total = stage.counters[operation];
    const value = observed[operation];
    if (!total || !value) throw new Error("Transfer counter disappeared");
    total.count += value.count;
    total.bytes += value.bytes;
  }
  if (!stage.counters.completionWait || !observed.completionWait) {
    throw new Error("Completion counter disappeared");
  }
  stage.counters.completionWait.count += observed.completionWait.count;
  stage.counters.completionWait.cpuElapsedMs += observed.completionWait.cpuElapsedMs;
  return result;
}

export function runResidencyBenchmark(env: NodeJS.ProcessEnv = process.env): void {
  const config = benchmarkConfig(env);
  const fd = openPath(config.renderNode, O_RDWR | O_CLOEXEC);
  try {
    // Producer and compositor share one current context. No independent scalers.
    const scaler = new EglOutputScaler(fd, { measureTransfers: true });
    try {
      // Independent open-file-description on the exact selected device.
      const importFd = openPath(config.renderNode, O_RDWR | O_CLOEXEC);
      let importer: GbmDevice;
      try {
        importer = new GbmDevice(importFd, importFd);
      } catch (error) {
        closeFd(importFd);
        throw error;
      }
      try {
        if (
          env.MOIRE_REQUIRE_HARDWARE === "1" &&
          /llvmpipe|softpipe|swrast/i.test(scaler.info.glRenderer)
        ) {
          throw new Error(`Hardware renderer required, got ${scaler.info.glRenderer}`);
        }
        console.log(
          JSON.stringify({
            kind: "egl-residency-identity",
            config,
            renderer: scaler.info,
            gpuExecutionMs: null,
            completionWaitCpuElapsedMsMeaning:
              "CPU-side wall elapsed in glFinish, not GPU execution or process CPU time",
          }),
        );
        const counts = [1, 4, 12];
        const updateModes: Updates[] = ["idle", "one", "all"];
        const paths: Path[] = ["gbm-cpu-snapshot", "gpu-owned-snapshot"];
        for (const windowCount of counts) {
          for (const updates of updateModes) {
            for (const path of paths) {
              const windows: Window[] = Array.from({ length: windowCount }, (_, index) => ({
                channel: `residency-${path}-${updates}-${windowCount}-${index}`,
                revision: 0,
                producerPixels: new Uint8Array(config.width * config.height * 4),
                pixels: new Uint8Array(0),
                stride: config.width * 4,
              }));
              const importedFds = new Set<number>();
              const producer = emptyStage(scaler);
              const snapshot = emptyStage(scaler);
              const composition = emptyStage(scaler);
              let nativeMapCount = 0;
              let nativeMapCopyBytes = 0;
              const gridColumns = Math.floor(1280 / config.width);
              const gridRows = Math.floor(800 / config.height);
              const overlap = config.overlap || windowCount > gridColumns * gridRows;
              const update = (window: Window, index: number, measured: boolean) => {
                window.revision++;
                for (let pixel = 0; pixel < config.width * config.height; pixel++) {
                  const x = pixel % config.width;
                  const y = Math.floor(pixel / config.width);
                  window.producerPixels.set(
                    [
                      (x + window.revision * 11) % 256,
                      (y + index * 29) % 256,
                      (index * 17 + window.revision * 23) % 256,
                      255,
                    ],
                    pixel * 4,
                  );
                }
                const produce = () => {
                  const frame = scaler.renderClientComposition(window.channel, {
                    width: config.width,
                    height: config.height,
                    clearColor: 0,
                    layers: [
                      {
                        id: `${window.channel}-producer`,
                        pixels: window.producerPixels,
                        sourceWidth: config.width,
                        sourceHeight: config.height,
                        sourceStride: config.width * 4,
                        revision: window.revision,
                        destination: { x: 0, y: 0, width: config.width, height: config.height },
                        sampling: "nearest",
                      },
                    ],
                  });
                  if (!frame) throw new Error("Producer GBM frame allocation failed");
                  return frame;
                };
                const frame = measured ? measure(scaler, producer, produce) : produce();
                try {
                  const takeSnapshot = () => {
                    const previous = window.pixels;
                    if (path === "gbm-cpu-snapshot") {
                      importedFds.add(frame.fd);
                      const mapped = importer.mapImport(
                        { ...frame, offset: 0 },
                        previous instanceof Uint8Array ? previous : undefined,
                      );
                      if (!mapped)
                        throw new Error(
                          `Actual GBM import/map failed on ${scaler.info.glRenderer}; no synthetic fallback`,
                        );
                      window.pixels = mapped.pixels;
                      window.stride = mapped.stride;
                      assert.ok(frame.format === 0x34325241 || frame.format === 0x34325258);
                      if (frame.format === 0x34325258) {
                        // Match the production CPU source's XRGB-to-BGRA interpretation.
                        for (let pixel = 3; pixel < mapped.pixels.length; pixel += 4)
                          mapped.pixels[pixel] = 255;
                      }
                      if (measured) {
                        nativeMapCount++;
                        nativeMapCopyBytes += mapped.stride * frame.height;
                      }
                    } else {
                      window.pixels = scaler.snapshotDmabuf({
                        width: frame.width,
                        height: frame.height,
                        format: frame.format,
                        plane: {
                          fd: frame.fd,
                          offset: 0,
                          stride: frame.stride,
                          modifier: frame.modifier,
                        },
                      });
                      window.stride = frame.width * 4;
                    }
                    if (previous instanceof EglResidentImage) previous.destroy();
                  };
                  if (measured) measure(scaler, snapshot, takeSnapshot);
                  else takeSnapshot();
                } finally {
                  // CPU snapshot copied, or GPU snapshot glFinish completed its owned copy.
                  scaler.releaseClientFrame(frame.id);
                }
              };
              const compose = () => {
                const scene: EglCompositionScene = {
                  width: 1280,
                  height: 800,
                  clearColor: 0xff202430,
                  layers: windows.map((window, index) => ({
                    id: window.channel,
                    pixels: window.pixels,
                    sourceWidth: config.width,
                    sourceHeight: config.height,
                    sourceStride: window.stride,
                    revision: window.revision,
                    destination: {
                      x: overlap ? 20 + (index % 4) * 190 : (index % gridColumns) * config.width,
                      y: overlap
                        ? 20 + Math.floor(index / 4) * 140
                        : Math.floor(index / gridColumns) * config.height,
                      width: config.width,
                      height: config.height,
                    },
                    cornerRadius: 10,
                    sampling: "linear",
                    ...(config.blur && index > 0
                      ? { backdropBlur: { radius: 8, saturation: 1, tint: 0x18102030 } }
                      : {}),
                  })),
                };
                // GPU publication on a render node. No KMS registration or modeset.
                const output = scaler.renderClientComposition("__benchmark-output", scene);
                if (!output) throw new Error("Composition output BO allocation failed");
                scaler.releaseClientFrame(output.id);
              };
              try {
                const setupBefore = scaler.getTransferMetrics();
                for (const [index, window] of windows.entries()) update(window, index, false);
                compose();
                const setup = delta(setupBefore, scaler.getTransferMetrics());
                // Independent correctness oracle before the measured workload.
                // Readbacks here are reported separately and cannot hide its costs.
                const validationBefore = scaler.getTransferMetrics();
                for (const window of windows) {
                  const pixels =
                    window.pixels instanceof EglResidentImage
                      ? window.pixels.readbackPixels()
                      : window.pixels;
                  assert.ok(pixels.length >= window.stride * config.height);
                  for (let y = 0; y < config.height; y++)
                    assert.deepEqual(
                      pixels.subarray(y * window.stride, y * window.stride + config.width * 4),
                      window.producerPixels.subarray(
                        y * config.width * 4,
                        (y + 1) * config.width * 4,
                      ),
                      "native snapshot color/opaque alpha matches independent producer bytes",
                    );
                }
                const validation = delta(validationBefore, scaler.getTransferMetrics());
                const workBefore = scaler.getTransferMetrics();
                const wallStarted = performance.now();
                const cpuStarted = process.cpuUsage();
                for (let iteration = 0; iteration < config.iterations; iteration++) {
                  for (const [index, window] of windows.entries()) {
                    if (updates === "all" || (updates === "one" && index === 0))
                      update(window, index, true);
                  }
                  measure(scaler, composition, compose);
                }
                const cpu = process.cpuUsage(cpuStarted);
                const updatedWindowsPerIteration =
                  updates === "idle" ? 0 : updates === "one" ? 1 : windowCount;
                const updatedSnapshots = updatedWindowsPerIteration * config.iterations;
                requireCount(composition.counters, "gpuReadback", 0);
                requireCount(snapshot.counters, "gpuReadback", 0);
                if (path === "gpu-owned-snapshot") {
                  requireCount(snapshot.counters, "dmabufImport", updatedSnapshots);
                  requireCount(snapshot.counters, "gpuCopy", updatedSnapshots);
                  requireCount(snapshot.counters, "textureUpload", 0);
                  requireCount(snapshot.counters, "cpuCopy", 0);
                  requireCount(composition.counters, "textureUpload", 0);
                } else {
                  requireCount(composition.counters, "textureUpload", updatedSnapshots);
                }
                console.log(
                  JSON.stringify({
                    kind: "egl-residency-workload",
                    path,
                    updates,
                    windowCount,
                    windowWidth: config.width,
                    windowHeight: config.height,
                    sourceAreaPixels: windowCount * config.width * config.height,
                    updatedAreaPixels:
                      updatedWindowsPerIteration * config.width * config.height * config.iterations,
                    outputAreaPixels: 1280 * 800,
                    requestedOverlap: config.overlap,
                    overlap,
                    layoutReason:
                      !config.overlap && overlap
                        ? "window area exceeds available tiled output"
                        : null,
                    visibleOcclusionAreaPixels: null,
                    outputPath: "exported GPU composition BO, no KMS scanout",
                    backdropBlur: config.blur,
                    iterations: config.iterations,
                    wallSubmitAndCompletionMs: performance.now() - wallStarted,
                    processCpuMs: (cpu.user + cpu.system) / 1000,
                    gpuExecutionMs: null,
                    setup,
                    diagnosticValidation: validation,
                    counters: delta(workBefore, scaler.getTransferMetrics()),
                    stages: { producer, snapshot, composition },
                    nativeGbmCpuSnapshot: {
                      successfulMapImportCalls: nativeMapCount,
                      copiedBytes: nativeMapCopyBytes,
                      nativeMapAttempts: null,
                      importedAllocationCount: null,
                    },
                  }),
                );
              } finally {
                for (const importedFd of importedFds) importer.releaseImport(importedFd);
                for (const window of windows) {
                  if (window.pixels instanceof EglResidentImage) window.pixels.destroy();
                  scaler.dropClientChannel(window.channel);
                }
                scaler.dropClientChannel("__benchmark-output");
              }
            }
          }
        }
      } finally {
        importer.destroy();
      }
    } finally {
      scaler.destroy();
    }
  } finally {
    closeFd(fd);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runResidencyBenchmark();
}
