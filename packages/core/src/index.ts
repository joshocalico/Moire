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

export { spawnDesktopApp, type SpawnOptions } from "./spawn.js";
export { CompositorServer, type CompositorShell, type SsdWindowInfo, type SsdAction } from "./server.js";
export {
  startXwayland,
  findFreeXDisplay,
  type XwaylandHandle,
} from "./xwayland.js";
export { X11Wm, type XwmWindow, type XwmWindowType } from "./xwm.js";
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
} from "./composition.js";
export {
  createCompositorOutputRenderer,
  resolveOutputRenderPreference,
  type CompositorOutputRenderer,
  type OutputRenderPreference,
  type OutputRenderTarget,
} from "./output-renderer.js";
