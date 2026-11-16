import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  openKmsOutput,
  closeKmsOutput,
  dropKmsMaster,
  presentKmsPixels,
  presentKmsFramebuffer,
  markBootPresenting,
  findConnectedCard,
  notifySystemdReady,
  monotonicMs,
  publishBootActive,
  watchBootReleaseRequest,
  watchBootPresented,
  bootReleaseWantsFrame,
  completeBootRelease,
  EglOutputScaler,
  type EglCompositionLayer,
  type EglProducerTarget,
  type KmsPresentationFeedback,
} from "@moire/sys";
import type { RetainedLayer } from "@moire/react-host";
import { installUiFonts, setUiScaleFactor } from "@moire/ui";
import { loadBootArtwork, packBootScanout, BOOT_MAX_WIDTH, BOOT_MAX_HEIGHT } from "./assets";
import { createBootRoot, type BootRoot } from "./view";
import { createRendererLifetime, createStandaloneLifetime } from "./renderer-lifetime";
import {
  loadBootScene,
  watchBootScene,
  DEFAULT_BOOT_SCENE,
  type BootScene,
  type BootSurface,
} from "./scene";

type KmsOutput = ReturnType<typeof openKmsOutput>;

/** GPU surfaces of the mounted scene, each drawing into a compositor-owned target. */
class SurfaceSet {
  private readonly live = new Map<string, { surface: BootSurface; target: EglProducerTarget }>();

  constructor(
    private readonly scaler: EglOutputScaler,
    private readonly width: number,
    private readonly height: number,
  ) {}

  mount(scene: BootScene): void {
    this.destroy();
    for (const [name, create] of Object.entries(scene.surfaces)) {
      const target = this.scaler.createProducerTarget(this.width, this.height);
      try {
        const surface = this.scaler.produce((gl) =>
          create(gl, { width: this.width, height: this.height, bgra: true }),
        );
        this.live.set(name, { surface, target });
      } catch (error) {
        target.image.destroy();
        throw error;
      }
    }
  }

  draw(t: number): void {
    for (const { surface, target } of this.live.values()) {
      this.scaler.produce(() => surface.render(t, target.framebuffer));
    }
  }

  /** Substitute each surface placeholder with its resident texture. */
  layers(layers: readonly RetainedLayer[]): EglCompositionLayer[] {
    return layers.map((layer): EglCompositionLayer => {
      const named = layer.surface ? this.live.get(layer.surface) : undefined;
      if (!named) return layer;
      const image = named.target.image;
      return {
        ...layer,
        pixels: image,
        sourceWidth: image.width,
        sourceHeight: image.height,
        sourceStride: image.width * 4,
        revision: undefined,
      };
    });
  }

  destroy(): void {
    for (const { surface, target } of this.live.values()) {
      try {
        this.scaler.produce(() => surface.destroy());
      } finally {
        target.image.destroy();
      }
    }
    this.live.clear();
  }
}

function openGpu(output: KmsOutput): EglOutputScaler | null {
  if (process.env.MOIRE_BOOT_GPU === "0") return null;
  try {
    const scaler = new EglOutputScaler(output.fd, { gles3: true });
    if (scaler.clientVersion === 3) return scaler;
    console.warn("[boot] GLES 3 unavailable; presenting the static scene");
    scaler.destroy();
  } catch (error) {
    console.warn("[boot] EGL unavailable; presenting the static scene:", error);
  }
  return null;
}

async function findCard(): Promise<string | null> {
  // Standalone stages may start before udev has published the GPU; wait briefly for it.
  const deadline = performance.now() + 5000;
  for (;;) {
    try {
      const card = findConnectedCard();
      if (card) return card;
    } catch {
      // No DRM device yet.
    }
    if (performance.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** XRGB8888 memory order from a top-down RGBA readback. */
function rgbaToBgra(pixels: Uint8Array): Uint8Array {
  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at]!;
    pixels[at] = pixels[at + 2]!;
    pixels[at + 2] = r;
    pixels[at + 3] = 255;
  }
  return pixels;
}

/** Milliseconds since this process started, for the boot timeline in the journal. */
const since = () => Math.round(process.uptime() * 1000);

/**
 * Native boot stage: an animated GPU scene when GLES 3 is present, else one static frame.
 * It runs until the next stage asks for the display (see @moire/sys boot-handoff) or it is
 * stopped. Standalone (MOIRE_BOOT_STANDALONE=1) it is run directly by systemd and announces
 * itself before any heavy work, so it never delays the next stage; otherwise its guardian owns
 * the console and its lifetime.
 */
export async function runBootRenderer(): Promise<void> {
  if (process.platform !== "linux") throw new Error("Boot presentation requires Linux");
  const standalone = process.env.MOIRE_BOOT_STANDALONE === "1";
  if (!standalone && !process.send) throw new Error("Boot renderer must be owned by its guardian");
  const artwork = process.env.MOIRE_BOOT_ARTWORK;
  const sceneSpec = process.env.MOIRE_BOOT_SCENE || DEFAULT_BOOT_SCENE;
  if (!standalone && (!artwork || !process.env.MOIRE_BOOT_CARD))
    throw new Error("Guardian must supply boot artwork and DRM card");
  const standaloneLifetime = standalone ? createStandaloneLifetime(notifySystemdReady) : null;
  const lifetime = standaloneLifetime ?? createRendererLifetime();
  let output: KmsOutput | null = null;
  let root: BootRoot | null = null;
  let scaler: EglOutputScaler | null = null;
  let surfaces: SurfaceSet | null = null;
  let unwatch = () => {};
  let unwatchRelease = () => {};
  let releaseRequested = false;
  let resolveRelease: () => void = () => {};
  const releaseSignal = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const announcedAtMs = monotonicMs();
  let sceneName = "starting";
  const handoffState = (startedAtMs: number) => ({
    pid: process.pid,
    scene: sceneName,
    width: output?.width ?? 0,
    height: output?.height ?? 0,
    startedAtMs,
  });
  try {
    publishBootActive(handoffState(announcedAtMs));
    unwatchRelease = watchBootReleaseRequest(() => {
      releaseRequested = true;
      resolveRelease();
    });
  } catch (error) {
    console.warn("[boot] display handoff unavailable:", error);
  }
  // Standalone: the handoff is open, so the next stage may start now.
  standaloneLifetime?.notifyReady();
  console.log(`[boot] t+${since()}ms announced`);
  const interrupted = Promise.race([lifetime.waitForStop(), releaseSignal]);
  const live = () => !lifetime.isStopped() && !releaseRequested;
  /** Drop master (the frame stays up) and publish the frame and clock to the next stage. */
  const release = (startedAtMs: number, sceneSeconds: number, frame: Uint8Array | null) => {
    const dropped = output ? dropKmsMaster(output) : false;
    completeBootRelease(
      { ...handoffState(startedAtMs), sceneSeconds, releasedAtMs: monotonicMs() },
      frame && output ? { pixels: frame, width: output.width, height: output.height } : null,
    );
    console.log(
      `[boot] t+${since()}ms released display at scene t=${sceneSeconds.toFixed(2)}s` +
        (output ? ` (master ${dropped ? "dropped" : "kept"})` : " before presenting"),
    );
  };
  /** Keep the fd (and so the frame) until the next stage presents, bounded. */
  const awaitSuccessor = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      const dispose = watchBootPresented(() => {
        clearTimeout(timer);
        dispose();
        resolve();
      });
    });
  try {
    const cardPath = process.env.MOIRE_BOOT_CARD ?? (await findCard());
    if (!cardPath) {
      console.warn("[boot] no connected display; nothing to present");
      return;
    }
    const [scene] = await Promise.all([loadBootScene(sceneSpec), installUiFonts()]);
    sceneName = scene.name;
    console.log(`[boot] t+${since()}ms scene ${scene.name} and fonts loaded`);
    if (!live()) return;
    output = openKmsOutput(cardPath, undefined, {
      maxWidth: BOOT_MAX_WIDTH,
      maxHeight: BOOT_MAX_HEIGHT,
    });
    const { width, height } = output;
    setUiScaleFactor(1);
    console.log(`[boot] t+${since()}ms display ${output.connectorName} ${width}x${height}`);

    scaler = live() ? openGpu(output) : null;
    if (scaler) {
      console.log(`[boot] t+${since()}ms GLES ${scaler.clientVersion}: ${scaler.info.glRenderer}`);
      try {
        surfaces = new SurfaceSet(scaler, width, height);
        surfaces.mount(scene);
        console.log(`[boot] t+${since()}ms GPU surfaces ready`);
      } catch (error) {
        console.warn("[boot] GPU scene setup failed; presenting the static scene:", error);
        surfaces?.destroy();
        surfaces = null;
        scaler.destroy();
        scaler = null;
      }
    }
    if (!live()) {
      if (releaseRequested) release(announcedAtMs, 0, null);
      return;
    }

    if (!scaler || !surfaces) {
      root = createBootRoot(width, height, artwork ? loadBootArtwork(artwork) : null, { scene });
      const frame = root.softwareFrame();
      const feedback = await presentKmsPixels(output, packBootScanout(frame, output.pitch));
      const startedAtMs = monotonicMs();
      console.log(`[boot] t+${since()}ms static frame presented`);
      await lifetime.notifyScanoutAccepted(feedback);
      // No artificial duration or progress. The actual boot lifecycle ends it.
      if (live()) await interrupted;
      if (releaseRequested) {
        release(startedAtMs, 0, frame.pixels.slice());
        await awaitSuccessor();
      }
      return;
    }

    let seconds = 0;
    const gpuScaler = scaler;
    const gpuSurfaces = surfaces;
    const bootRoot = (root = createBootRoot(width, height, null, {
      scene,
      gpu: true,
      time: () => seconds,
    }));
    if (process.env.MOIRE_BOOT_SCENE_WATCH === "1") {
      unwatch = watchBootScene(sceneSpec, () => {
        loadBootScene(sceneSpec).then(
          (next) => {
            gpuSurfaces.mount(next);
            bootRoot.setScene(next);
            console.log(`[boot] reloaded scene ${next.name}`);
          },
          (error) => console.warn("[boot] scene reload failed:", error),
        );
      });
    }
    const directOutput = {
      id: "boot",
      x: 0,
      y: 0,
      width,
      height,
      targetWidth: width,
      targetHeight: height,
    };
    const draw = (): number => {
      gpuSurfaces.draw(seconds);
      const frame = bootRoot.retainedFrame();
      gpuScaler.beginComposition({
        width,
        height,
        clearColor: 0xff000000,
        layers: gpuSurfaces.layers(frame.layers),
      });
      return gpuScaler.renderOutputDirect(directOutput).framebufferId;
    };

    let started = 0;
    let startedAtMs = 0;
    let frames = 0;
    while (live()) {
      const current = bootRoot.scene;
      if (started && seconds >= current.settledAt) {
        // Settled: only ambient motion remains, at a reduced rate (or none).
        const interval = current.ambientFps > 0 ? 1000 / current.ambientFps : 0;
        const delay = interval
          ? Math.max(0, started + (seconds * 1000 + interval) - performance.now())
          : Number.POSITIVE_INFINITY;
        if (delay > 0) {
          await Promise.race([
            interrupted,
            ...(Number.isFinite(delay) ? [new Promise((r) => setTimeout(r, delay))] : []),
          ]);
          if (!live()) break;
        }
      }
      if (!started) {
        started = performance.now();
        startedAtMs = monotonicMs();
      }
      seconds = (performance.now() - started) / 1000;
      const feedback: KmsPresentationFeedback = await presentKmsFramebuffer(output, draw());
      if (frames++ === 0) {
        console.log(`[boot] t+${since()}ms first frame presented`);
        try {
          markBootPresenting(handoffState(startedAtMs));
        } catch (error) {
          console.warn("[boot] display handoff unavailable:", error);
        }
        await lifetime.notifyScanoutAccepted(feedback);
      }
    }
    if (frames) console.log(`[boot] ${frames} frames over ${seconds.toFixed(2)}s of scene time`);
    if (releaseRequested) {
      let pixels: Uint8Array | null = null;
      if (frames && bootReleaseWantsFrame()) {
        pixels = new Uint8Array(width * height * 4);
        gpuScaler.readDirectOutput(directOutput, pixels);
        rgbaToBgra(pixels);
      }
      release(startedAtMs || announcedAtMs, seconds, pixels);
      if (frames) await awaitSuccessor();
    }
  } finally {
    unwatch();
    unwatchRelease();
    try {
      surfaces?.destroy();
      root?.close();
    } finally {
      try {
        if (output) closeKmsOutput(output);
      } finally {
        try {
          scaler?.destroy();
        } finally {
          lifetime.close();
        }
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBootRenderer();
}
