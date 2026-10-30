/**
 * Automatic dark style: the scheduler flips `dark` only while Auto is on and only when the
 * schedule disagrees, across a custom evening and sunset in London, and a real flip writes the
 * pref and the active theme under a throwaway config directory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, activeThemePath, loadSettings, type MoireSettings } from "@moire/prefs";
import { applyDark, attachAppearanceSchedule, scheduledDark } from "./appearance-schedule";

const utc = { timeZone: "UTC", location: null };
const london = {
  timeZone: "Europe/London",
  location: { latitude: 51.5083, longitude: -0.1253 },
};
const at = (iso: string) => new Date(iso);
const prefs = (patch: Partial<MoireSettings>): MoireSettings => ({ ...DEFAULT_SETTINGS, ...patch });

// ---- The pure decision.
const off = prefs({ dark: false });
assert.equal(scheduledDark(off, at("2026-06-21T23:00:00Z"), utc), null, "off never flips");
const evening = prefs({ dark: false, autoDark: { mode: "custom", from: "19:00", to: "07:00" } });
assert.equal(scheduledDark(evening, at("2026-06-21T20:00:00Z"), utc), true);
assert.equal(scheduledDark(evening, at("2026-06-21T12:00:00Z"), utc), null, "already light");
assert.equal(scheduledDark({ ...evening, dark: true }, at("2026-06-21T12:00:00Z"), utc), false);
const sunset = prefs({ dark: true, autoDark: { mode: "sunset", from: "19:00", to: "07:00" } });
assert.equal(scheduledDark(sunset, at("2026-06-21T12:00:00Z"), london), false, "midday is light");
assert.equal(scheduledDark(sunset, at("2026-06-21T22:00:00Z"), london), null, "after sunset");
const withLight = prefs({
  dark: false,
  autoDark: { mode: "night-light", from: "19:00", to: "07:00" },
  nightLight: { enabled: true, schedule: "custom", from: "22:00", to: "06:00", strength: 0.5 },
});
assert.equal(scheduledDark(withLight, at("2026-06-21T21:00:00Z"), utc), null, "before 22:00");
assert.equal(scheduledDark(withLight, at("2026-06-21T22:30:00Z"), utc), true);

// ---- The scheduler with stand-ins: applies once, then agrees.
{
  let stored = evening;
  const applied: boolean[] = [];
  const schedule = attachAppearanceSchedule({
    load: () => stored,
    apply: (dark) => {
      applied.push(dark);
      stored = { ...stored, dark };
      return stored;
    },
    context: () => utc,
    now: () => at("2026-06-21T20:00:00Z"),
    watch: false,
  });
  assert.deepEqual(applied, [true], "flips on attach");
  assert.equal(schedule.check(), null, "then agrees");
  await schedule.dispose();
}

// ---- A real flip writes settings.json and the active theme.
const config = fs.mkdtempSync(path.join(os.tmpdir(), "moire-auto-dark-"));
const saved = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = config;
try {
  const next = applyDark(false);
  assert.equal(next.dark, false);
  assert.equal(loadSettings().dark, false);
  assert.ok(fs.existsSync(activeThemePath()), "the active theme is written for the desktop");
} finally {
  if (saved == null) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = saved;
  fs.rmSync(config, { recursive: true, force: true });
}

console.log("[appearance-schedule] decisions, scheduler and prefs write passed");
