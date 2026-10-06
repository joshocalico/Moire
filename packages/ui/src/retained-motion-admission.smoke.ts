import assert from "node:assert/strict";
import {
  WindowRetainedMotionController,
  type RetainedMotionParticipant,
} from "./retained-motion-admission";

class Participant implements RetainedMotionParticipant {
  value = 0;
  playing = true;
  get(): number {
    return this.value;
  }
  isActive(): boolean {
    return this.playing;
  }
  tick(dt: number): boolean {
    if (this.playing) this.value += dt;
    return this.playing;
  }
  reset(): boolean {
    const changed = this.value !== 0;
    this.value = 0;
    return changed;
  }
}
let now = 1000;
const previousNow = Date.now;
Date.now = () => now;
try {
  const wakes: boolean[] = [];
  const a = new WindowRetainedMotionController((paint) => wakes.push(paint));
  const b = new WindowRetainedMotionController(() => {});
  const av = new Participant();
  const bv = new Participant();
  const disposeA = a.admission.register(av);
  b.admission.register(bv);
  a.visibilityChanged("visible");
  b.visibilityChanged("visible");
  a.submitted(1);
  a.frameReady(1);
  assert.equal(a.isActive(), false, "frame callback alone never grants rendering authority");
  a.renderingChanged({ kind: "hardware-retained", commitId: 2 });
  assert.equal(a.isActive(), false, "future/mismatched acceptance cannot arm a frame");
  a.renderingChanged({ kind: "hardware-retained", commitId: 1 });
  b.submitted(1);
  b.renderingChanged({ kind: "hardware-retained", commitId: 1 });
  assert.equal(b.isActive(), false, "qualified acceptance alone waits for the frame opportunity");
  b.frameReady(1);
  now += 50;
  assert.equal(a.tick(now), true);
  assert.equal(bv.value, 0, "another window's tick cannot advance this participant");
  a.beforePresent();
  a.renderingChanged({ kind: "static", reason: "awaiting-output", commitId: 2 });
  a.submitted(2);
  const held = av.value;
  for (let i = 0; i < 100; i++) {
    now += 10;
    assert.equal(a.tick(now), false);
  }
  assert.equal(av.value, held, "pending submission retains phase without advancing");
  assert.equal(b.isActive(), true, "pending A cannot consume B's accepted opportunity");
  assert.equal(b.tick(now), true);
  a.frameReady(1);
  assert.equal(a.isActive(), false, "stale frame cannot unlock a newer commit");
  a.renderingChanged({ kind: "hardware-retained", commitId: 2 });
  a.frameReady(2);
  a.visibilityChanged("hidden");
  assert.equal(a.tick(now + 1000), false);
  assert.equal(av.value, held, "hidden retains its last phase");
  a.visibilityChanged("visible");
  assert.equal(a.tick(now), false, "zero elapsed wake does not consume a paint opportunity");
  now += 10;
  assert.equal(a.tick(now), true);
  a.beforePresent(); // native backpressure: no submitted event
  assert.equal(a.tick(now + 10), false);
  a.frameReady(2);
  assert.equal(a.isActive(), false, "duplicate frame cannot bypass presentation backpressure");
  a.retry();
  assert.equal(a.isActive(), true, "actual release retry may retry unchanged qualified source");
  a.visibilityChanged("unknown");
  assert.equal(av.value, 0, "uncertain visibility demotes to canonical geometry");
  a.visibilityChanged("visible");
  a.renderingChanged({ kind: "static", reason: "backend-loss" });
  a.renderingChanged({ kind: "hardware-retained", commitId: 2 });
  a.frameReady(2);
  assert.equal(a.isActive(), false, "late acceptance cannot repair a lost owned context");
  assert.equal(b.isActive(), true, "actual loss is local to its window");
  disposeA();
  disposeA();
  a.destroy();
  a.admission.register(new Participant());
  assert.equal(a.isActive(), false);
  assert.equal(b.tick(now + 10), true, "teardown does not unregister another window");
  assert.ok(wakes.includes(true), "actual geometry demotion requests one canonical paint");
  b.destroy();

  const software = new WindowRetainedMotionController(() => {}, "bounded-wave");
  const wave = new Participant();
  const unregisterWave = software.admission.register(wave);
  software.visibilityChanged("visible");
  software.submitted(10);
  software.renderingChanged({ kind: "static", reason: "software", commitId: 10 });
  software.frameReady(10);
  assert.equal(software.isActive(), false, "submission plus callback is not accepted output");
  software.outputAccepted(9);
  assert.equal(software.isActive(), false, "stale software acceptance cannot arm motion");
  software.outputAccepted(10);
  assert.equal(software.isActive(), true);
  assert.equal(software.tick(now + 99), false, "software wave waits its 100ms budget");
  now += 100;
  assert.equal(software.tick(now), true);
  const advanced = wave.value;
  software.frameReady(10);
  software.outputAccepted(10);
  assert.equal(
    software.tick(now + 1000),
    false,
    "duplicate observations cannot spend an opportunity twice",
  );
  software.beforePresent();
  software.submitted(11);
  software.renderingChanged({ kind: "static", reason: "software", commitId: 11 });
  software.outputRevoked(11);
  assert.equal(wave.value, advanced, "software submission holds phase until acceptance");
  software.outputAccepted(10);
  software.frameReady(10);
  assert.equal(software.isActive(), false);
  software.outputAccepted(11);
  assert.equal(software.isActive(), false, "acceptance requires matching callback");
  software.frameReady(11);
  assert.equal(software.tick(now + 99), false, "100ms cap spans commits");
  wave.playing = false;
  assert.equal(software.tick(now + 1000), false, "reduced motion stops immediately");
  wave.playing = true;
  software.visibilityChanged("hidden");
  assert.equal(software.tick(now + 1000), false);
  assert.equal(wave.value, advanced);
  software.visibilityChanged("visible");
  software.outputRevoked(10);
  assert.equal(wave.value, advanced, "stale revocation does not touch newer geometry");
  software.outputRevoked(11);
  assert.equal(wave.value, 0, "unknown or replaced output resets canonical geometry");
  assert.equal(software.isActive(), false);
  software.outputAccepted(11);
  software.renderingChanged({ kind: "static", reason: "virtual", commitId: 11 });
  software.frameReady(11);
  assert.equal(
    software.isActive(),
    true,
    "verified virtual output admits only bounded wave repainting",
  );
  assert.equal(software.tick(now + 2000), true);
  software.frameReady(11);
  assert.equal(software.tick(now + 3000), false, "virtual output also spends a frame only once");
  software.renderingChanged({ kind: "static", reason: "unknown-execution", commitId: 11 });
  assert.equal(software.isActive(), false);
  software.renderingChanged({ kind: "static", reason: "backend-loss", commitId: 11 });
  software.outputAccepted(11);
  assert.equal(software.isActive(), false);
  unregisterWave();
  software.destroy();
  software.outputAccepted(11);
  assert.equal(software.isActive(), false);
  const paced = new WindowRetainedMotionController(() => {}, "bounded-wave");
  const pacedWave = new Participant();
  paced.admission.register(pacedWave);
  paced.visibilityChanged("visible");
  for (let token = 1; token <= 20; token++) {
    paced.beforePresent();
    paced.submitted(token);
    // First wake establishes the clock; subsequent native output handoffs take 90ms.
    if (token > 1) now += 90;
    paced.renderingChanged({ kind: "static", reason: "software", commitId: token });
    paced.outputAccepted(token);
    paced.frameReady(token);
    now += token === 1 ? 100 : 10;
    assert.equal(paced.tick(now), true);
  }
  assert.ok(pacedWave.value > 1.8, "frame handoffs must not discard elapsed animation time");
  assert.ok(Math.abs(pacedWave.value - 2) < 1e-9, "20 accepted frames advance two seconds");
  paced.destroy();
  const defaultPolicy = new WindowRetainedMotionController(() => {});
  defaultPolicy.admission.register(new Participant());
  defaultPolicy.visibilityChanged("visible");
  defaultPolicy.submitted(1);
  defaultPolicy.renderingChanged({ kind: "static", reason: "software", commitId: 1 });
  defaultPolicy.outputAccepted(1);
  defaultPolicy.frameReady(1);
  assert.equal(defaultPolicy.isActive(), false, "ordinary windows retain hardware-only admission");
  defaultPolicy.renderingChanged({ kind: "static", reason: "virtual", commitId: 1 });
  defaultPolicy.outputAccepted(1);
  assert.equal(defaultPolicy.isActive(), false, "ordinary windows reject virtual wave admission");
  defaultPolicy.destroy();
  console.log(
    "Software-wave current-output authority, 10Hz cap, one opportunity, reduction, revocation and fallback PASS",
  );
  console.log(
    "Per-window retained admission ordering, pending phase, stale ack, backpressure, hidden/unknown/loss, teardown and two-domain isolation PASS",
  );
} finally {
  Date.now = previousNow;
}
