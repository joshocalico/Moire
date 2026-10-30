/**
 * Idle policy state machine with a fake clock: dim → off → lock → suspend per power source,
 * inhibitors, activity, wake, sleep, and the dim fade curve. Pure; runs anywhere.
 */
import assert from "node:assert/strict";
import { DEFAULT_POWER_SETTINGS, applyPowerPatch, type PowerSettings } from "@moire/prefs";
import {
  IdlePolicy,
  LOCKED_SCREEN_OFF_MS,
  SUSPEND_RECHECK_MS,
  ScreenFade,
  idlePolicyConfig,
  type IdleEffect,
} from "./idle-policy";
import { FakeClock } from "./idle-testing";

const S = 1000;
const MIN = 60 * S;
const settings = (patch: Parameters<typeof applyPowerPatch>[1] = {}): PowerSettings =>
  applyPowerPatch(DEFAULT_POWER_SETTINGS, patch);

function harness(
  config: PowerSettings,
  source: "ac" | "battery",
  options: { lockSupported?: boolean; display?: string[]; suspend?: string[] } = {},
) {
  const clock = new FakeClock();
  const effects: (IdleEffect & { at: number })[] = [];
  const inhibitors = { display: options.display ?? [], suspend: options.suspend ?? [] };
  let displayReads = 0;
  let suspendReads = 0;
  const policy = new IdlePolicy({
    config: idlePolicyConfig(config, source),
    lockSupported: options.lockSupported ?? true,
    timers: clock,
    displayInhibitors: () => {
      displayReads++;
      return inhibitors.display;
    },
    suspendInhibitors: () => {
      suspendReads++;
      return inhibitors.suspend;
    },
    effect: (effect) => effects.push({ ...effect, at: clock.now() }),
  });
  const kinds = () =>
    effects.map((e) =>
      e.kind === "phase"
        ? `${e.phase}@${e.at / S}`
        : e.kind === "lock"
          ? `lock:${e.reason}@${e.at / S}`
          : `suspend@${e.at / S}`,
    );
  return {
    clock,
    policy,
    effects,
    inhibitors,
    kinds,
    reads: () => ({ display: displayReads, suspend: suspendReads }),
  };
}

let cases = 0;

// Prefs: choices snap, per-source patches merge.
{
  const merged = applyPowerPatch(DEFAULT_POWER_SETTINGS, { screenOffAfterSeconds: { ac: 900 } });
  assert.deepEqual(merged.screenOffAfterSeconds, { ac: 900, battery: 300 });
  const snapped = applyPowerPatch(DEFAULT_POWER_SETTINGS, {
    dimAfterSeconds: 7,
    suspendAfterSeconds: { battery: 42 },
    lidCloseAction: "explode" as never,
  });
  assert.equal(snapped.dimAfterSeconds, DEFAULT_POWER_SETTINGS.dimAfterSeconds);
  assert.equal(
    snapped.suspendAfterSeconds.battery,
    DEFAULT_POWER_SETTINGS.suspendAfterSeconds.battery,
  );
  assert.equal(snapped.lidCloseAction, "suspend");
  cases++;
}

// Battery defaults: dim 2m, off 5m, lock as it turns off, suspend 30m.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "battery");
  h.clock.advance(119 * S);
  assert.deepEqual(h.kinds(), []);
  h.clock.advance(1 * S);
  assert.deepEqual(h.kinds(), ["dimmed@120"]);
  h.clock.advance(3 * MIN);
  assert.deepEqual(h.kinds(), ["dimmed@120", "off@300", "lock:idle@300"]);
  assert.equal(h.policy.snapshot().lockPending, true);
  h.policy.setLocked(true);
  h.clock.advance(25 * MIN);
  assert.deepEqual(h.kinds().slice(3), ["suspend@1800"]);
  assert.equal(h.clock.pending, 0, "nothing left to time once suspend was requested");
  cases++;
}

// AC defaults: off at 10m, never suspends; lock delay applies after screen off.
{
  const h = harness(settings({ lockAfterScreenOffSeconds: 60 }), "ac");
  h.clock.advance(2 * 60 * MIN);
  assert.deepEqual(h.kinds(), ["dimmed@120", "off@600", "lock:idle@660"]);
  cases++;
}

// Switching power source re-measures from the same activity time.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "ac");
  h.clock.advance(4 * MIN);
  assert.deepEqual(h.kinds(), ["dimmed@120"]);
  h.policy.setConfig(idlePolicyConfig(DEFAULT_POWER_SETTINGS, "battery"));
  h.clock.advance(1 * MIN);
  assert.deepEqual(h.kinds(), ["dimmed@120", "off@300", "lock:idle@300"]);
  cases++;
}

// Activity: cheap while active (no evaluation, no inhibitor reads), wakes a dark screen.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "battery");
  const before = h.reads().display;
  for (let i = 0; i < 100; i++) {
    h.clock.advance(1 * S);
    h.policy.activity();
  }
  assert.equal(h.reads().display, before, "activity while active must not evaluate");
  assert.deepEqual(h.kinds(), []);
  h.clock.advance(2 * MIN);
  assert.deepEqual(h.kinds(), ["dimmed@220"]);
  h.policy.activity();
  assert.deepEqual(h.kinds(), ["dimmed@220", "active@220"]);
  h.clock.advance(5 * MIN);
  h.policy.activity();
  assert.deepEqual(h.kinds().slice(2), ["dimmed@340", "off@520", "lock:idle@520", "active@520"]);
  assert.equal(h.policy.snapshot().idleMs, 0);
  cases++;
}

// Dim is skipped when it would not come before screen off.
{
  const h = harness(
    settings({ dimAfterSeconds: 300, screenOffAfterSeconds: { battery: 120 } }),
    "battery",
  );
  h.clock.advance(10 * MIN);
  assert.deepEqual(h.kinds().slice(0, 1), ["off@120"]);
  cases++;
}

// Everything "never": no timers at all; activity stays cheap.
{
  const h = harness(
    settings({
      dimAfterSeconds: null,
      screenOffAfterSeconds: { ac: null },
      suspendAfterSeconds: { ac: null },
    }),
    "ac",
  );
  assert.equal(h.clock.pending, 0);
  h.clock.advance(10 * 60 * MIN);
  h.policy.activity();
  assert.deepEqual(h.kinds(), []);
  cases++;
}

// No lock provider: lock steps are skipped, never faked; logind Lock is refused.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "battery", { lockSupported: false });
  h.clock.advance(31 * MIN);
  assert.deepEqual(h.kinds(), ["dimmed@120", "off@300", "suspend@1800"]);
  assert.equal(h.policy.requestLock(), false);
  assert.equal(h.policy.prepareForSleep(), false);
  cases++;
}

// A display inhibitor (video) holds everything off and restarts timers when released.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "battery", { display: ["org.moire.Video"] });
  h.clock.advance(60 * MIN);
  assert.deepEqual(h.kinds(), []);
  assert.deepEqual(h.policy.snapshot().inhibitors.display, ["org.moire.Video"]);
  h.inhibitors.display = [];
  h.clock.advance(30 * S);
  h.policy.inhibitorsChanged();
  h.clock.advance(119 * S);
  assert.deepEqual(h.kinds(), [], "release restarts the dim timer from the release");
  h.clock.advance(1 * S);
  assert.deepEqual(h.kinds(), ["dimmed@3750"]);
  // An inhibitor appearing while dimmed wakes the screen.
  h.inhibitors.display = ["org.moire.Video"];
  h.policy.inhibitorsChanged();
  assert.deepEqual(h.kinds(), ["dimmed@3750", "active@3750"]);
  cases++;
}

// Audio blocks only suspend; it is read only when suspend is due, then rechecked.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "battery", {
    lockSupported: false,
    suspend: ["audio"],
  });
  h.clock.advance(29 * MIN);
  assert.equal(h.reads().suspend, 0, "audio is not probed before suspend is due");
  h.clock.advance(1 * MIN);
  assert.deepEqual(h.kinds(), ["dimmed@120", "off@300"], "dims and blanks while music plays");
  assert.equal(h.reads().suspend, 1);
  assert.deepEqual(h.policy.snapshot().inhibitors.suspend, ["audio"]);
  h.clock.advance(SUSPEND_RECHECK_MS);
  assert.equal(h.reads().suspend, 2);
  h.inhibitors.suspend = [];
  h.clock.advance(SUSPEND_RECHECK_MS);
  assert.deepEqual(h.kinds().at(-1), `suspend@${(30 * MIN + 2 * SUSPEND_RECHECK_MS) / S}`);
  cases++;
}

// Locked: an untouched lock screen goes dark after a minute even with screen off "never".
{
  const h = harness(settings({ screenOffAfterSeconds: { ac: null }, dimAfterSeconds: null }), "ac");
  h.policy.requestLock();
  h.policy.setLocked(true);
  h.clock.advance(LOCKED_SCREEN_OFF_MS);
  assert.deepEqual(h.kinds(), ["lock:request@0", "off@60"]);
  h.policy.activity();
  assert.equal(h.policy.snapshot().phase, "active");
  // Unlocking counts as activity and restores the configured (never) screen off.
  h.policy.setLocked(false);
  h.clock.advance(60 * MIN);
  assert.deepEqual(h.kinds().slice(2), ["active@60"]);
  cases++;
}

// Sleep: lock first when asked, never twice; resume is activity and re-arms suspend.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "battery");
  assert.equal(h.policy.prepareForSleep(), true);
  assert.equal(h.policy.prepareForSleep(), false, "a pending lock is not requested again");
  h.policy.setLocked(true);
  h.clock.advance(31 * MIN);
  const suspends = () => h.kinds().filter((k) => k.startsWith("suspend")).length;
  assert.equal(suspends(), 1);
  h.policy.resumed();
  h.clock.advance(31 * MIN);
  assert.equal(suspends(), 2, "after waking, the next idle period may suspend again");
  const off = harness(settings({ lockOnSuspend: false }), "battery");
  assert.equal(off.policy.prepareForSleep(), false);
  cases++;
}

// A refused lock may be retried by the next request.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "ac");
  assert.equal(h.policy.requestLock(), true);
  h.policy.lockFailed();
  assert.equal(h.policy.requestLock(), true);
  cases++;
}

// Dispose cancels the timer.
{
  const h = harness(DEFAULT_POWER_SETTINGS, "ac");
  h.policy.dispose();
  assert.equal(h.clock.pending, 0);
  h.clock.advance(60 * MIN);
  h.policy.activity();
  assert.deepEqual(h.kinds(), []);
  cases++;
}

// Fade: smoothstep, retargets from the current value, duration 0 jumps.
{
  const fade = new ScreenFade();
  fade.set(1, 0, 100);
  assert.equal(fade.value(0), 0);
  assert.equal(fade.value(50), 0.5);
  assert.ok(fade.value(25) < 0.25, "eases in");
  assert.equal(fade.animating(99), true);
  assert.equal(fade.value(100), 1);
  assert.equal(fade.animating(100), false);
  fade.set(0, 200, 100);
  fade.set(0.5, 250, 100);
  assert.equal(fade.value(250), 0.5);
  fade.set(0, 260, 0);
  assert.equal(fade.value(260), 0);
  assert.equal(fade.animating(260), false);
  cases++;
}

console.log(`[idle-policy] ${cases} cases PASS`);
