/**
 * Compositor core: clients, surfaces, scene, spawn.
 */

export type MoireVersion = {
  name: string;
  version: string;
};

export const MOIRE: MoireVersion = {
  name: "Moire",
  version: "0.0.0",
};

export { spawnDesktopApp, type SpawnOptions } from "./spawn";
export {
  CompositorServer,
  type CompositorShell,
  type SsdWindowInfo,
  type SsdAction,
} from "./server";
export { startXwayland, findFreeXDisplay, type XwaylandHandle } from "./xwayland";
export { X11Wm, type XwmWindow, type XwmWindowType } from "./xwm";
export {
  validateCompositionScene,
  orderedCompositionLayers,
  type CompositionRect,
  type CompositionMatrix4,
  type CompositionTransform,
  type CompositionMesh,
  type PixelSurface,
  type CompositionEffect,
  type CompositionLayer,
  type CompositionScene,
  type CompositionCapabilities,
} from "./composition";
export {
  createCompositorOutputRenderer,
  resolveOutputRenderPreference,
  resolveEglPresentPreference,
  type CompositorOutputRenderer,
  type OutputRenderPreference,
  type OutputRenderTarget,
  type OutputRenderResult,
  type EglPresentPreference,
} from "./output-renderer";
