/**
 * Boot scenes: a React view plus the GPU surfaces it places with `<Group surface="name">`.
 *
 * Everything a scene shows is ordinary @moire/react-host UI (text, images, motion through live
 * numbers) composed by the compositor's EGL scene pipeline; only the named surfaces are drawn
 * directly with GLES 3. A scene is chosen by name or by module path (MOIRE_BOOT_SCENE), so a new
 * look ships, or is iterated on with MOIRE_BOOT_SCENE_WATCH=1, without rebuilding the renderer.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "react";
import type { SceneSurfaceFactory, SceneSurfaceInstance, SilkBackdropSource } from "@moire/ui";

/** A GLES 3 producer drawing one frame into `framebuffer` at scene time `t` (seconds). */
export type BootSurface = SceneSurfaceInstance;
export type BootSurfaceFactory = SceneSurfaceFactory;

export type BootSceneProps = {
  width: number;
  height: number;
  /** Scene time in seconds; read it from live numbers so motion needs no React commit. */
  time: () => number;
  /** False when GLES 3 is unavailable: surfaces are not drawn, so show a static equivalent. */
  gpu: boolean;
  /** Prebaked static artwork for the no-GPU path, when installed. */
  artwork: SilkBackdropSource | null;
};

export type BootScene = Readonly<{
  name: string;
  View: ComponentType<BootSceneProps>;
  surfaces: Readonly<Record<string, BootSurfaceFactory>>;
  /** After this many seconds only ambient motion remains; the presenter may lower its rate. */
  settledAt: number;
  /** Frame rate once settled (0 holds the last frame). */
  ambientFps: number;
}>;

const BUILTIN: Readonly<Record<string, () => Promise<BootScene>>> = {
  silk: async () => (await import("./scene-silk")).silkScene,
  fold: async () => (await import("./scene-fold")).foldScene,
};

export const DEFAULT_BOOT_SCENE = "silk";

function isBootScene(value: unknown): value is BootScene {
  const scene = value as Partial<BootScene> | null;
  return (
    !!scene &&
    typeof scene.name === "string" &&
    typeof scene.View === "function" &&
    typeof scene.surfaces === "object" &&
    typeof scene.settledAt === "number" &&
    typeof scene.ambientFps === "number"
  );
}

/**
 * Resolve a builtin scene name or an absolute module path exporting `scene` (or a default
 * export). Paths are re-imported on every call, so a watcher can swap in an edited scene.
 */
export async function loadBootScene(spec = DEFAULT_BOOT_SCENE): Promise<BootScene> {
  const builtin = BUILTIN[spec];
  if (builtin) return builtin();
  if (!path.isAbsolute(spec)) {
    throw new Error(`Unknown boot scene "${spec}" (builtins: ${Object.keys(BUILTIN).join(", ")})`);
  }
  const version = fs.statSync(spec).mtimeMs;
  const module = (await import(`${pathToFileURL(spec).href}?v=${version}`)) as Record<
    string,
    unknown
  >;
  const scene = module.scene ?? module.default;
  if (!isBootScene(scene)) throw new Error(`${spec} does not export a boot scene`);
  return scene;
}

/** Call `onChange` (debounced) whenever a path-loaded scene module changes on disk. */
export function watchBootScene(spec: string, onChange: () => void): () => void {
  if (!path.isAbsolute(spec)) return () => {};
  let timer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(spec, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 120);
  });
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
