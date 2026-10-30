import assert from "node:assert/strict";
import { SilkMotion } from "./motion";
import { computeSilkSettledState, silkSettledState, SILK_SETTLED_TIME } from "./settled";

// A resumed simulation continues bit-exactly where the original run would be.
const straight = new SilkMotion();
const resumedFrom = new SilkMotion();
straight.frame(2.5);
resumedFrom.frame(2.5);
const resumed = new SilkMotion();
resumed.restore(resumedFrom.snapshot());
for (const t of [2.6, 3.4, 5.1]) {
  assert.deepEqual(resumed.frame(t).data, straight.frame(t).data, `resume diverged at t=${t}`);
}

// The shipped settled snapshot is the current simulation's own state.
const shipped = silkSettledState();
const computed = computeSilkSettledState();
assert.ok(Math.abs(shipped.time - SILK_SETTLED_TIME) < 1 / 240, "snapshot is at the settled time");
assert.deepEqual(shipped, computed, "settled-snapshot.ts is stale: run settled.generate.ts");
console.log("[ui/silk] resume is exact; shipped settled snapshot matches the simulation");
