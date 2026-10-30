/**
 * The silk simulation at rest, so a stage that starts without the boot (a greeter after logout)
 * resumes the ambient scene instantly instead of replaying ~0.5 s of physics per scene second.
 * Regenerate with `tsx src/scene/silk/settled.generate.ts` after changing motion.ts; the smoke
 * test fails while it is stale.
 */
import { SilkMotion, type SilkMotionState } from "./motion";
import { SILK_SETTLED_SNAPSHOT } from "./settled-snapshot";

/** Scene time of the shipped snapshot (after SILK_TIMELINE.settled). */
export const SILK_SETTLED_TIME = 9;

function decode(base64: string): number[] {
  const bytes = Buffer.from(base64, "base64");
  return Array.from(new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8));
}

export function silkSettledState(): SilkMotionState {
  const s = SILK_SETTLED_SNAPSHOT;
  return { time: s.time, pos: decode(s.pos), prev: decode(s.prev), seed: s.seed };
}

/** Recompute the snapshot from the simulation itself. */
export function computeSilkSettledState(): SilkMotionState {
  const motion = new SilkMotion();
  motion.frame(SILK_SETTLED_TIME);
  return motion.snapshot();
}
