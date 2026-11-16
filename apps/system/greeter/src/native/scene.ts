/**
 * The greeter's backdrop as a compositor scene: the boot ribbon pours into the line-wave and
 * keeps breathing beneath the (transparent) greeter window. The compositor draws it, so the
 * greeter only redraws when its UI changes.
 */
import { SILK_SETTLED_TIME, silkSceneSurface, type SceneSurfaceFactory } from "@moire/ui";

export type GreeterSceneBackdrop = {
  create: SceneSurfaceFactory;
  time: () => number;
  frameInterval: (t: number) => number;
};

/** Seconds the ribbon takes to pour into the wave (see SilkRenderer.morphToWave). */
const POUR_SECONDS = 2.6;
/** Scene time by which the boot ribbon has swept across the screen. */
const RIBBON_FLIGHT_SECONDS = 3.2;
/** Ambient pacing once the wave is settled: slow motion needs no more than this. */
const AMBIENT_FRAME_MS = 33;

/**
 * `bootSceneTime` continues the boot stage's clock when it handed over the display; without
 * it the wave starts settled.
 */
/** How long a stage may take from creating this scene to showing it. */
const SCENE_PREPARE_SECONDS = 1;

export function greeterSceneBackdrop(bootSceneTime?: () => number): GreeterSceneBackdrop {
  if (bootSceneTime) {
    const startAt = bootSceneTime();
    // A fast boot hands over before the ribbon has crossed the screen: let it finish its flight
    // behind the login, then pour into the wave.
    const waveAt = Math.max(startAt + SCENE_PREPARE_SECONDS, RIBBON_FLIGHT_SECONDS);
    return {
      create: silkSceneSurface(startAt, { waveAt }),
      time: bootSceneTime,
      frameInterval: (t) => (t < waveAt + POUR_SECONDS + 0.5 ? 0 : AMBIENT_FRAME_MS),
    };
  }
  const origin = performance.now();
  const time = () => SILK_SETTLED_TIME + (performance.now() - origin) / 1000;
  return {
    create: silkSceneSurface(time(), { waveAt: Number.NEGATIVE_INFINITY }),
    time,
    frameInterval: () => AMBIENT_FRAME_MS,
  };
}
