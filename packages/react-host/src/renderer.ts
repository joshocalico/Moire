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
