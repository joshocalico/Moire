import type { SceneNode } from "./index.js";

/** Viewport passed to a scene renderer, independent of its output target. */
export type RenderViewport = {
  width: number;
  height: number;
};

/** Common metadata carried by every completed render. */
export type RenderFrame = RenderViewport;

/**
 * Backend-neutral retained-scene renderer.
 *
 * The current implementation returns a CPU pixel buffer. An EGL backend can
 * instead return a texture/surface frame without changing SceneNode, widgets,
 * layout, or hit testing.
 */
export interface RendererBackend<TFrame extends RenderFrame> {
  readonly id: string;
  render(root: SceneNode, viewport: RenderViewport): TFrame;
}

/** Frame produced by the deterministic software renderer. */
export type SoftwareFrame = RenderFrame & {
  pixels: Uint8Array;
};

export type RetainedClip = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Texture-backed primitive emitted without choosing a platform API. */
export type RetainedLayer = {
  id: string;
  pixels: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  sourceStride: number;
  revision: number;
  destination: RetainedClip;
  clip?: RetainedClip;
  opacity?: number;
  sampling?: "nearest" | "linear";
  cornerRadius?: number;
  dropShadow?: {
    offsetX: number;
    offsetY: number;
    blurRadius: number;
    spread?: number;
    color: number;
  };
};

/** Renderer-neutral retained scene suitable for an accelerated platform. */
export type RetainedSceneFrame = RenderFrame & {
  clearColor: number;
  layers: readonly RetainedLayer[];
};
