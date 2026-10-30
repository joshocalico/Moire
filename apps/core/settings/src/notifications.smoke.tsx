/**
 * Notifications: the per-app list and its rule sheet write `notificationRules`, the schedule
 * rows write `doNotDisturbSchedule`, and a schedule-held Do not disturb says so. Pure model
 * cases first. `SETTINGS_PNG_DIR` saves the page and an app's sheet.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { DEFAULT_REGION_SETTINGS, loadSettings, updateSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import { setUiScaleFactor } from "@moire/ui";
import { notificationApps, ruleSummary } from "./pages/notifications-model";
import { scheduleTimes, withTime } from "./time-choices";
import { FakeDesktop, desktopSnapshot, settingsFixture } from "./testing";
import { mountSettings, overflow } from "./testing-ui";

const pictures = process.env.SETTINGS_PNG_DIR;
const RULE = { allow: true, banners: true, sound: true, history: true };

// ---- Model: apps from notices (by rule key) and from saved rules, sorted by name.
{
  const apps = notificationApps(
    [
      { appName: "Files", appId: "org.moire.Files" },
      { appName: "Files", appId: "org.moire.Files" },
      { appName: "Calendar" },
    ],
    { Backup: { ...RULE, allow: false } },
  );
  assert.deepEqual(
    apps.map((app) => [app.id, app.name, app.count, app.rule.allow]),
    [
      ["Backup", "Backup", 0, false],
      ["Calendar", "Calendar", 1, true],
      ["org.moire.Files", "Files", 2, true],
    ],
  );
  assert.equal(ruleSummary(RULE), "Banners and sounds");
  assert.equal(ruleSummary({ ...RULE, allow: false }), "Off");
  assert.equal(ruleSummary({ ...RULE, banners: false, sound: false }), "Tray only · no sound");
  const times = scheduleTimes({ ...DEFAULT_REGION_SETTINGS, clock: "24h" });
  assert.equal(times.length, 48);
  assert.deepEqual(times[45], { id: "22:30", label: "22:30" });
  assert.equal(withTime(times, "06:45", DEFAULT_REGION_SETTINGS).length, 49);
}

await withFixture(async () => {
  const shows = async (app: Awaited<ReturnType<typeof mountSettings>>, text: string) =>
    app.until(() => app.texts().includes(text), `Missing “${text}”: ${app.texts().join(" | ")}`);

  for (const [width, height] of [
    [1020, 700],
    [640, 650],
  ] as const) {
    setUiScaleFactor(1);
    updateSettings({
      notificationRules: {},
      doNotDisturbSchedule: { enabled: false, from: "22:00", to: "07:00" },
      region: { ...loadSettings().region, clock: "24h" },
    });
    const app = await mountSettings(settingsFixture(loadSettings(), { page: "notifications" }), {
      width,
      height,
    });
    await shows(app, "Apps");
    await shows(app, "Calendar");

    // The schedule: turning it on shows the times; a time choice is written.
    app.press({ focusId: "setting:notifications.schedule" });
    await app.until(() => loadSettings().doNotDisturbSchedule.enabled, "schedule on");
    await shows(app, "Every day, 22:00 to 07:00");
    await shows(app, "The next morning");
    assert.deepEqual(overflow(app, width, height), [], `${width}: controls inside`);
    if (pictures) app.screenshot(path.join(pictures, `notifications-dark-${width}x${height}.png`));

    // An app's sheet: turning banners off writes a rule keyed by the app id.
    app.press({ focusId: "notifications:app:Calendar" });
    await shows(app, "Allow notifications");
    app.press({ focusId: "setting:notifications.app-banners" });
    await app.until(
      () => loadSettings().notificationRules.Calendar?.banners === false,
      "banners off written",
    );
    await shows(app, "Tray only");
    assert.deepEqual(overflow(app, width, height), [], `${width} sheet: controls inside`);
    if (pictures)
      app.screenshot(path.join(pictures, `notifications-app-sheet-dark-${width}x${height}.png`));
    // Off for the app disables the rest; back to the default removes the rule.
    app.press({ focusId: "setting:notifications.app-allow" });
    await app.until(() => loadSettings().notificationRules.Calendar?.allow === false, "app off");
    app.press({ focusId: "setting:notifications.app-allow" });
    app.press({ focusId: "setting:notifications.app-banners" });
    await app.until(() => !("Calendar" in loadSettings().notificationRules), "default drops rule");
    app.destroy();
  }

  // ---- A schedule-held Do not disturb says until when, and that turning it off skips tonight.
  {
    updateSettings({ doNotDisturbSchedule: { enabled: true, from: "22:00", to: "07:00" } });
    const fixture = settingsFixture(loadSettings(), { page: "notifications" });
    fixture.props.services.desktop = new FakeDesktop(
      desktopSnapshot({ doNotDisturb: true, doNotDisturbScheduled: true }),
    );
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    await shows(app, "Do not disturb is on until 07:00");
    app.destroy();
  }
});
console.log("[settings/notifications] schedule, per-app rules and their sheet passed");
