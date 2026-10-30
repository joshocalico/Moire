/**
 * Named GPU scene surfaces: content drawn directly with GLES 3 each frame (the silk ribbon) and
 * placed in a React scene by `<SceneSurface name>`. The platform that composes the window draws
 * them into compositor-owned targets; React layers compose above and below as usual.
 */
import type { SilkGl } from "./silk/gl";

/** The WebGL2-shaped subset a surface may use (a browser context or the native binding). */
export type SceneGl = SilkGl;

export type SceneSurfaceInstance = {
  /** Draw scene time `t` (seconds) into `framebuffer`. */
  render(t: number, framebuffer: unknown): void;
  destroy(): void;
};

export type SceneSurfaceOptions = {
  width: number;
  height: number;
  /** Write B,G,R,A, the compositor's resident texture convention. */
  bgra: boolean;
};

export type SceneSurfaceFactory = (
  gl: SceneGl,
  options: SceneSurfaceOptions,
) => SceneSurfaceInstance;

type Entry = { create: SceneSurfaceFactory; time: () => number };

const registry = new Map<string, Entry>();
let support: boolean | null = null;

/** Make `name` drawable; `time` is read once per drawn frame. Returns an unregister function. */
export function registerSceneSurface(
  name: string,
  create: SceneSurfaceFactory,
  time: () => number,
): () => void {
  const entry = { create, time };
  registry.set(name, entry);
  return () => {
    if (registry.get(name) === entry) registry.delete(name);
  };
}

export function sceneSurfaceEntry(name: string): Readonly<Entry> | undefined {
  return registry.get(name);
}

export function hasSceneSurfaces(): boolean {
  return registry.size > 0;
}

/** Set by the platform once it knows whether it can draw scene surfaces (GLES 3). */
export function setSceneSurfaceSupport(available: boolean): void {
  support = available;
}

/**
 * Whether scene surfaces will actually be drawn in this process. Views show a static equivalent
 * when false (software rendering, no GLES 3, or a surface failed).
 */
export function sceneSurfacesAvailable(): boolean {
  return support === true;
}
