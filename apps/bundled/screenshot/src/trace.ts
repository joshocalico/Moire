/**
 * Input-fixture diagnostics. Screenshot is the app the VM input fixture types into and drags on;
 * these observers record what it saw and never affect editing or saving.
 */
import {
  createInputFixtureTrace,
  type InputFixtureObservation,
  type InputFixtureTrace,
} from "@moire/sys";
import type { ImageData } from "@moire/ui";
import type { Bounds } from "./image";

type GesturePhase = Extract<InputFixtureObservation, { layer: "app-gesture" }>["phase"];

export const inputFixtureTrace = createInputFixtureTrace("app");

/** Run an observation; a failing observer stops tracing instead of disturbing the app. */
export function observe(trace: InputFixtureTrace, observation: () => void): void {
  try {
    if (trace.active()) observation();
  } catch {
    try {
      trace.stop("io-error");
    } catch {
      /* diagnostics remain unavailable */
    }
  }
}

export function observeGesture(
  trace: InputFixtureTrace,
  phase: GesturePhase,
  bounds: Bounds,
  image: ImageData,
): void {
  observe(trace, () =>
    trace.write({
      layer: "app-gesture",
      phase,
      ...bounds,
      imageWidth: image.width,
      imageHeight: image.height,
    }),
  );
}

export function observePointer(
  trace: InputFixtureTrace,
  phase: GesturePhase,
  x: number,
  y: number,
  image: ImageData,
): void {
  observeGesture(trace, phase, { x, y, width: 0, height: 0 }, image);
}
