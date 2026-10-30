import type { SceneSurfaceFactory } from "./surface";
import { SilkRenderer } from "./silk/renderer";
import { silkSettledState } from "./silk/settled";

export type SilkSceneSurfaceOptions = {
  /**
   * Scene time at which the ribbon pours into the line-wave (the greeter's backdrop);
   * `-Infinity` shows the wave alone. Omitted, the ribbon stays a ribbon (the boot).
   */
  waveAt?: number;
};

/**
 * The silk ribbon as a scene surface. `startAt` is the first scene time it will draw: from the
 * settled snapshot onward it resumes instantly instead of replaying the physics from t = 0.
 */
export function silkSceneSurface(
  startAt = 0,
  options: SilkSceneSurfaceOptions = {},
): SceneSurfaceFactory {
  return (gl, { width, height, bgra }) => {
    const settled = silkSettledState();
    const renderer = new SilkRenderer(
      gl,
      width,
      height,
      bgra,
      startAt >= settled.time ? settled : undefined,
    );
    if (options.waveAt !== undefined) renderer.morphToWave(options.waveAt);
    return {
      render: (t, framebuffer) => renderer.render(t, framebuffer),
      destroy: () => renderer.destroy(),
    };
  };
}
