import { EglOutputScaler, type EglCompositionScene, type OutputColorScale } from "@moire/sys";
import { copySceneToOutputScaled, type OutputGeometry } from "./display-layout";
import {
  orderedCompositionLayers,
  type CompositionCapabilities,
  type CompositionScene,
  type PixelSurface,
  type OwnedPixelSurface,
} from "./composition";
import type { DmabufBuffer } from "./dmabuf-map";
import { traceOutputPipeline } from "./output-pipeline-trace";
import { scaleOutputColors } from "./night-light";

export type OutputRenderPreference = "auto" | "software" | "egl";

export type OutputRenderTarget = {
  geometry: OutputGeometry;
  physicalWidth: number;
  physicalHeight: number;
  pitch: number;
  pixels: Uint8Array;
};

export type OutputRenderingFacts = Readonly<{
  generation: object;
  execution: EglOutputScaler["execution"];
  path: "software" | "flat-direct" | "retained-direct" | "readback";
  residentSources: ReadonlySet<PixelSurface>;
}>;

export type OutputRenderResult = {
  rendering?: OutputRenderingFacts;
  /** Renderer-owned DRM FB; caller presents it instead of flushing `pixels`. */
  framebufferId?: number;
};

export type EglPresentPreference = "auto" | "readback" | "direct";

/**
 * A GPU scene the compositor draws itself, beneath its clients (the greeter's backdrop).
 * Structurally a @moire/ui SceneSurfaceFactory.
 */
export type CompositorSceneFactory = (
  gl: never,
  options: { width: number; height: number; bgra: boolean },
) => { render(t: number, framebuffer: unknown): void; destroy(): void };

/** A scene drawn into a compositor-owned texture, composed like any surface. */
export type CompositorSceneLayer = {
  readonly source: OwnedPixelSurface;
  /** Draw scene time `t`; the next composition shows it. */
  draw(t: number): void;
  destroy(): void;
};

export type OutputRendererOptions = {
  /** Create a GLES 3 context so compositor scenes (createSceneLayer) can be drawn. */
  gles3?: boolean;
  /** Render on this fd instead of the KMS fd; pass -1 as the KMS fd until attachKmsDevice. */
  renderFd?: number;
};

export interface CompositorOutputRenderer {
  readonly id: "software" | "egl";
  /** Own the display: scanout registers on this fd from now on. Rendered state is kept. */
  attachKmsDevice?(fd: number): void;
  readonly capabilities: CompositionCapabilities;
  readonly detail: string;
  readonly renderingGeneration: object;
  beginFrame(scene: PixelSurface): void;
  /** Complete the GPU copy before returning; the producer may then reuse its buffer. */
  snapshotDmabuf?(
    buffer: DmabufBuffer,
    onReadback?: (bytes: number) => void,
  ): OwnedPixelSurface | null;
  /** Retained GPU scene path. Undefined only for the flattened software oracle. */
  beginComposition?(scene: CompositionScene): void;
  /** Whether createSceneLayer can succeed (an EGL renderer with a GLES 3 context). */
  readonly supportsSceneLayers?: boolean;
  /** Null when this renderer cannot draw GPU scenes (software, or no GLES 3). */
  createSceneLayer?(
    width: number,
    height: number,
    create: CompositorSceneFactory,
  ): CompositorSceneLayer | null;
  renderOutput(target: OutputRenderTarget): OutputRenderResult;
  /**
   * Multipliers every presented output is drawn with from now on (night light); null for none.
   * Captures are never scaled: a screenshot shows the composed colours. Test fixtures may omit it.
   */
  setOutputColorScale?(scale: OutputColorScale | null): void;
  /** Read the latest composed output in tight BGRA, without changing scanout. */
  captureOutput(target: Omit<OutputRenderTarget, "pixels" | "pitch">): Uint8Array;
  destroy(): void;
}

class SoftwareOutputRenderer implements CompositorOutputRenderer {
  readonly id = "software" as const;
  readonly renderingGeneration = Object.freeze({});
  readonly capabilities: CompositionCapabilities = {
    retainedLayers: false,
    projectiveTransforms: false,
    meshDeformation: false,
    extensionEffects: false,
    surfaceGeometryMask: false,
    directScanout: false,
    backdropBlur: false,
    dropShadow: false,
    colorMatrix: false,
    roundedClip: false,
  };
  readonly detail = "deterministic CPU crop/scale";
  private scene: PixelSurface | null = null;
  private colorScale: OutputColorScale | null = null;

  beginFrame(scene: PixelSurface): void {
    this.scene = scene;
  }

  private copyOutput(target: OutputRenderTarget): void {
    if (!this.scene) throw new Error("Software output frame was not begun");
    copySceneToOutputScaled(
      this.scene.pixels,
      this.scene.width,
      this.scene.height,
      target.geometry,
      target.pixels,
      target.physicalWidth,
      target.physicalHeight,
      target.pitch,
    );
  }

  renderOutput(target: OutputRenderTarget): OutputRenderResult {
    this.copyOutput(target);
    // The target is rewritten whole every frame, so scaling it in place never compounds.
    if (this.colorScale)
      scaleOutputColors(
        target.pixels,
        target.physicalWidth,
        target.physicalHeight,
        target.pitch,
        this.colorScale,
      );
    return {};
  }

  setOutputColorScale(scale: OutputColorScale | null): void {
    this.colorScale = scale;
  }

  captureOutput(target: Omit<OutputRenderTarget, "pixels" | "pitch">): Uint8Array {
    const pixels = new Uint8Array(target.physicalWidth * target.physicalHeight * 4);
    this.copyOutput({ ...target, pixels, pitch: target.physicalWidth * 4 });
    return pixels;
  }

  destroy(): void {
    this.scene = null;
  }
}

type CompositionScaler = Pick<
  EglOutputScaler,
  | "info"
  | "execution"
  | "beginFrame"
  | "snapshotDmabuf"
  | "beginComposition"
  | "renderOutput"
  | "renderOutputDirect"
  | "destroy"
> &
  // Only GLES 3 outputs draw scene layers; fixtures and GLES 2 scalers may omit them.
  Partial<SceneProducer>;
type SceneProducer = Pick<EglOutputScaler, "clientVersion" | "createProducerTarget" | "produce">;

function sceneProducer(scaler: CompositionScaler): SceneProducer | null {
  return scaler.clientVersion === 3 && scaler.createProducerTarget && scaler.produce
    ? (scaler as SceneProducer)
    : null;
}

export class EglCompositorOutputRenderer implements CompositorOutputRenderer {
  readonly id = "egl" as const;
  readonly capabilities: CompositionCapabilities = {
    retainedLayers: true,
    projectiveTransforms: true,
    meshDeformation: false,
    extensionEffects: false,
    surfaceGeometryMask: true,
    // This capability means bypassing composition for a fullscreen client,
    // not the renderer's own GBM output presentation path.
    directScanout: false,
    backdropBlur: true,
    dropShadow: true,
    colorMatrix: true,
    roundedClip: true,
  };
  private generation: object = Object.freeze({});
  private destroyed = false;
  private retainedSources: ReadonlySet<PixelSurface> = new Set();
  private retained = false;
  get renderingGeneration(): object {
    return this.generation;
  }

  private rendering(path: OutputRenderingFacts["path"]): OutputRenderingFacts {
    return Object.freeze({
      generation: this.generation,
      execution: this.scaler.execution,
      path,
      residentSources: path === "retained-direct" ? this.retainedSources : new Set<PixelSurface>(),
    });
  }

  private captureReady = false;
  private colorScale: OutputColorScale | null = null;
  private activePresentation: "readback" | "direct" | null;
  private readonly residentSources = new WeakMap<
    PixelSurface,
    ReturnType<EglOutputScaler["snapshotDmabuf"]>
  >();
  private warnedImport = false;

  constructor(
    private readonly scaler: CompositionScaler,
    private readonly presentation = resolveEglPresentPreference(),
  ) {
    this.activePresentation = presentation === "auto" ? null : presentation;
  }

  get detail(): string {
    const presentation =
      this.activePresentation === "direct"
        ? "GBM direct presentation"
        : this.activePresentation === "readback"
          ? "readback scanout"
          : "automatic presentation probe";
    return `${this.scaler.info.glRenderer}; ${this.scaler.info.glVersion}; ${presentation}`;
  }

  attachKmsDevice(fd: number): void {
    (this.scaler as Partial<Pick<EglOutputScaler, "attachKmsDevice">>).attachKmsDevice?.(fd);
  }

  get supportsSceneLayers(): boolean {
    return !this.destroyed && sceneProducer(this.scaler) !== null;
  }

  createSceneLayer(
    width: number,
    height: number,
    create: CompositorSceneFactory,
  ): CompositorSceneLayer | null {
    const scaler = this.destroyed ? null : sceneProducer(this.scaler);
    if (!scaler) return null;
    const target = scaler.createProducerTarget(width, height);
    let instance: ReturnType<CompositorSceneFactory>;
    try {
      instance = scaler.produce((gl) => create(gl as never, { width, height, bgra: true }));
    } catch (error) {
      target.image.destroy();
      throw error;
    }
    let pixels: Uint8Array | undefined;
    let revision = 0;
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        scaler.produce(() => instance.destroy());
      } finally {
        target.image.destroy();
      }
    };
    const source: OwnedPixelSurface = {
      storage: "gpu",
      width,
      height,
      stride: width * 4,
      get revision() {
        return revision;
      },
      get pixels() {
        return (pixels ??= target.image.readbackPixels());
      },
      destroy,
    };
    this.residentSources.set(source, target.image);
    return {
      source,
      draw(t: number) {
        if (destroyed) return;
        scaler.produce(() => instance.render(t, target.framebuffer));
        revision++;
        pixels = undefined;
      },
      destroy,
    };
  }

  beginFrame(scene: PixelSurface): void {
    this.retained = false;
    this.retainedSources = new Set();
    if (scene.stride !== scene.width * 4) {
      throw new Error("EGL logical scene currently requires a tight stride");
    }
    this.scaler.beginFrame(scene.pixels, scene.width, scene.height);
    traceOutputPipeline({ stage: "gpu", damagePixels: scene.width * scene.height });
    this.captureReady = true;
  }

  snapshotDmabuf(
    buffer: DmabufBuffer,
    onReadback?: (bytes: number) => void,
  ): OwnedPixelSurface | null {
    const plane = buffer.planes[0];
    if (!plane || buffer.planes.length !== 1 || buffer.flags !== 0) return null;
    try {
      const image = this.scaler.snapshotDmabuf({
        width: buffer.width,
        height: buffer.height,
        format: buffer.format,
        plane: {
          fd: plane.fd,
          offset: plane.offset,
          stride: plane.stride,
          modifier: (BigInt(plane.modifierHi >>> 0) << 32n) | BigInt(plane.modifierLo >>> 0),
        },
      });
      let pixels: Uint8Array | undefined;
      const source: OwnedPixelSurface = {
        storage: "gpu",
        width: buffer.width,
        height: buffer.height,
        stride: buffer.width * 4,
        get pixels() {
          if (!pixels) {
            pixels = image.readbackPixels();
            onReadback?.(pixels.byteLength);
          }
          return pixels;
        },
        destroy: () => image.destroy(),
      };
      this.residentSources.set(source, image);
      return source;
    } catch (error) {
      if (!this.warnedImport) {
        this.warnedImport = true;
        console.warn("[renderer] dma-buf GPU snapshot unavailable; using CPU fallback:", error);
      }
      return null;
    }
  }

  beginComposition(scene: CompositionScene): void {
    const unsupported = scene.layers.find(
      (layer) =>
        layer.mesh ||
        layer.clip ||
        layer.effects?.some(
          (effect) =>
            effect.kind !== "drop-shadow" &&
            effect.kind !== "backdrop-blur" &&
            effect.kind !== "color-matrix",
        ),
    );
    if (unsupported) {
      throw new Error(
        `EGL retained layer ${unsupported.id} requests a capability not implemented by the core pass`,
      );
    }
    const eglScene: EglCompositionScene = {
      width: scene.width,
      height: scene.height,
      clearColor: scene.clearColor,
      layers: orderedCompositionLayers(scene).map((layer) => {
        const dropShadow = layer.effects?.find((effect) => effect.kind === "drop-shadow");
        const backdropBlur = layer.effects?.find((effect) => effect.kind === "backdrop-blur");
        const colorMatrix = layer.effects?.find((effect) => effect.kind === "color-matrix");
        return {
          id: layer.id,
          pixels: this.residentSources.get(layer.source) ?? layer.source.pixels,
          sourceWidth: layer.source.width,
          sourceHeight: layer.source.height,
          sourceStride: layer.source.stride,
          revision: layer.source.revision,
          sourceRect: layer.sourceRect,
          damage: layer.damage,
          destination: layer.destination,
          opacity: layer.opacity,
          transform: layer.transform?.matrix,
          transformOrigin: layer.transform?.origin,
          sampling: layer.sampling,
          surfaceGeometry: layer.surfaceGeometry,
          contentShape: layer.contentShape,
          cornerRadius: layer.cornerRadius,
          dropShadow,
          backdropBlur,
          colorMatrix: colorMatrix?.matrix,
        };
      }),
    };
    const damage = this.scaler.beginComposition(eglScene);
    traceOutputPipeline({ stage: "gpu", damagePixels: damage ? damage.width * damage.height : 0 });
    this.retained = true;
    this.retainedSources = new Set(
      scene.layers
        .filter((layer) => this.residentSources.has(layer.source))
        .map((layer) => layer.source),
    );
    this.captureReady = true;
  }

  renderOutput(target: OutputRenderTarget): OutputRenderResult {
    // Retained composition lives in the scaler's logical scene target, while
    // flattened frames retain `scene` for fallback. Both are valid begins.
    const output = {
      id: target.geometry.id,
      x: target.geometry.x,
      y: target.geometry.y,
      width: target.geometry.width,
      height: target.geometry.height,
      targetWidth: target.physicalWidth,
      targetHeight: target.physicalHeight,
      colorScale: this.colorScale ?? undefined,
    };
    if (this.activePresentation !== "readback") {
      try {
        const direct = this.scaler.renderOutputDirect(output);
        if (this.activePresentation == null) {
          console.log("[renderer] automatic presentation selected direct GBM scanout");
        }
        this.activePresentation = "direct";
        return {
          framebufferId: direct.framebufferId,
          rendering: this.rendering(this.retained ? "retained-direct" : "flat-direct"),
        };
      } catch (error) {
        if (this.presentation === "direct") throw error;
        console.warn(
          "[renderer] direct GBM presentation unavailable; retaining EGL readback:",
          error,
        );
        this.activePresentation = "readback";
        this.generation = Object.freeze({});
      }
    }
    this.scaler.renderOutput({
      ...output,
      targetPitch: target.pitch,
      target: target.pixels,
    });
    return { rendering: this.rendering("readback") };
  }

  setOutputColorScale(scale: OutputColorScale | null): void {
    this.colorScale = scale;
  }

  captureOutput(target: Omit<OutputRenderTarget, "pixels" | "pitch">): Uint8Array {
    if (!this.captureReady) throw new Error("No composed frame available yet");
    const pixels = new Uint8Array(target.physicalWidth * target.physicalHeight * 4);
    this.scaler.renderOutput({
      id: target.geometry.id,
      x: target.geometry.x,
      y: target.geometry.y,
      width: target.geometry.width,
      height: target.geometry.height,
      targetWidth: target.physicalWidth,
      targetHeight: target.physicalHeight,
      target: pixels,
      targetPitch: target.physicalWidth * 4,
    });
    return pixels;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation = Object.freeze({});
    this.retainedSources = new Set();
    this.scaler.destroy();
  }
}

/** Auto mode can recover from context loss or a driver failure mid-session. */
class AutoCompositorOutputRenderer implements CompositorOutputRenderer {
  private active: CompositorOutputRenderer;
  private scene: PixelSurface | null = null;
  private retainedFrame = false;
  private colorScale: OutputColorScale | null = null;

  constructor(drmFd: number, options: OutputRendererOptions = {}) {
    try {
      this.active = new EglCompositorOutputRenderer(new EglOutputScaler(drmFd, options));
    } catch (error) {
      console.warn("[renderer] EGL unavailable; falling back to software:", error);
      this.active = new SoftwareOutputRenderer();
    }
  }

  attachKmsDevice(fd: number): void {
    this.active.attachKmsDevice?.(fd);
  }

  get renderingGeneration(): object {
    return this.active.renderingGeneration;
  }

  get id(): "software" | "egl" {
    return this.active.id;
  }

  get capabilities(): CompositionCapabilities {
    return this.active.capabilities;
  }

  get detail(): string {
    return this.active.detail;
  }

  private fallBack(error: unknown): void {
    if (this.active.id === "software") throw error;
    console.warn("[renderer] EGL frame failed; switching to software:", error);
    this.active.destroy();
    this.active = new SoftwareOutputRenderer();
    this.active.setOutputColorScale?.(this.colorScale);
    if (this.scene) this.active.beginFrame(this.scene);
  }

  setOutputColorScale(scale: OutputColorScale | null): void {
    this.colorScale = scale;
    this.active.setOutputColorScale?.(scale);
  }

  beginFrame(scene: PixelSurface): void {
    this.scene = scene;
    this.retainedFrame = false;
    try {
      this.active.beginFrame(scene);
    } catch (error) {
      this.fallBack(error);
    }
  }

  snapshotDmabuf(
    buffer: DmabufBuffer,
    onReadback?: (bytes: number) => void,
  ): OwnedPixelSurface | null {
    return this.active.snapshotDmabuf?.(buffer, onReadback) ?? null;
  }

  get supportsSceneLayers(): boolean {
    return this.active.supportsSceneLayers === true;
  }

  createSceneLayer(
    width: number,
    height: number,
    create: CompositorSceneFactory,
  ): CompositorSceneLayer | null {
    return this.active.createSceneLayer?.(width, height, create) ?? null;
  }

  beginComposition(scene: CompositionScene): void {
    this.scene = null;
    this.retainedFrame = true;
    try {
      if (!this.active.beginComposition) {
        throw new Error("Active renderer does not support retained composition");
      }
      this.active.beginComposition(scene);
    } catch (error) {
      // There is no flattened oracle buffer available here, so do not switch
      // silently and render stale content. The caller can rebuild in software.
      throw error;
    }
  }

  renderOutput(target: OutputRenderTarget): OutputRenderResult {
    try {
      return this.active.renderOutput(target);
    } catch (error) {
      if (this.retainedFrame) throw error;
      this.fallBack(error);
      return this.active.renderOutput(target);
    }
  }

  captureOutput(target: Omit<OutputRenderTarget, "pixels" | "pitch">): Uint8Array {
    return this.active.captureOutput(target);
  }

  destroy(): void {
    this.scene = null;
    this.active.destroy();
  }
}

export function resolveOutputRenderPreference(
  value = process.env.MOIRE_RENDERER,
): OutputRenderPreference {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "software" || normalized === "egl") return normalized;
  throw new Error(
    `Invalid MOIRE_RENDERER=${JSON.stringify(value)} (expected auto, software, or egl)`,
  );
}

export function resolveEglPresentPreference(
  value = process.env.MOIRE_EGL_PRESENT,
): EglPresentPreference {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "readback" || normalized === "direct") return normalized;
  throw new Error(
    `Invalid MOIRE_EGL_PRESENT=${JSON.stringify(value)} (expected auto, readback, or direct)`,
  );
}

export function createCompositorOutputRenderer(
  drmFd: number,
  preference = resolveOutputRenderPreference(),
  options: OutputRendererOptions = {},
): CompositorOutputRenderer {
  if (preference === "software") return new SoftwareOutputRenderer();
  if (preference === "auto") return new AutoCompositorOutputRenderer(drmFd, options);
  return new EglCompositorOutputRenderer(new EglOutputScaler(drmFd, options));
}
