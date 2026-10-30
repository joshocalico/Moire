/**
 * Displays' brightness and Night light, and Appearance's automatic dark style, with the fixture's
 * clock pinned to a June evening in London (after sunset). Brightness sets through the client and
 * a machine without a backlight says so instead of showing a slider; Night light's switch,
 * schedule and custom times write prefs; Auto picks the scheduled scheme at once and Light turns
 * it off. `SETTINGS_PNG_DIR` also writes the pages.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { loadSettings, updateSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import { createFakeBrightnessClient } from "@moire/system-management/brightness";
import { mountSettings } from "./testing-ui";
import { settingsFixture } from "./testing";

const pictures = process.env.SETTINGS_PNG_DIR;
type App = Awaited<ReturnType<typeof mountSettings>>;
const shows = (app: App, text: string) =>
  app.until(() => app.texts().includes(text), `Missing ${text}: ${app.texts().join(" | ")}`);
const showsMatch = (app: App, pattern: RegExp) =>
  app.until(
    () => app.texts().some((text) => pattern.test(text)),
    `Missing ${pattern}: ${app.texts().join(" | ")}`,
  );

await withFixture(async () => {
  // ---- Displays: brightness and night light.
  {
    const brightness = createFakeBrightnessClient();
    const fixture = settingsFixture(loadSettings(), {
      page: "displays",
      services: { brightness },
    });
    const app = await mountSettings(fixture, { width: 1020, height: 1100 });
    await shows(app, "Brightness");
    await shows(app, "60% · intel_backlight");
    await shows(app, "Night light");
    await shows(app, "Warmer colours in the evening");
    app.press({ focusId: "setting:displays.night-light" });
    await app.until(() => loadSettings().nightLight.enabled, "the switch writes nightLight");
    // 22:30 BST is after sunset, so it is on until about 04:45.
    await showsMatch(app, /^On until 0?4:4\d/);
    if (pictures) app.screenshot(path.join(pictures, "displays-night-light-dark-1020x1100.png"));
    // Custom times bring their rows; the summary follows them.
    updateSettings({
      nightLight: { ...loadSettings().nightLight, schedule: "custom", from: "23:00", to: "06:00" },
    });
    app.destroy();
    const custom = await mountSettings(
      settingsFixture(loadSettings(), { page: "displays", services: { brightness } }),
      { width: 1020, height: 1100 },
    );
    await shows(custom, "Turn on at");
    await shows(custom, "Turn off at");
    await showsMatch(custom, /^Comes on at 23:00|^Comes on at 11:00/);
    custom.destroy();
    // Brightness goes through the client.
    assert.deepEqual(await brightness.setLevel(0.3), { ok: true, value: undefined });
    assert.deepEqual(brightness.levels, [0.3]);
  }

  // ---- No backlight (the VM): no slider, an honest note.
  {
    const brightness = createFakeBrightnessClient({
      kind: "unavailable",
      message: "This display has no adjustable backlight.",
    });
    const app = await mountSettings(
      settingsFixture(loadSettings(), { page: "displays", services: { brightness } }),
      { width: 640, height: 1100 },
    );
    await shows(app, "Night light");
    assert.ok(!app.texts().includes("Brightness"), "no slider without a backlight");
    await showsMatch(app, /no adjustable backlight/);
    if (pictures) app.screenshot(path.join(pictures, "displays-no-backlight-dark-640x1100.png"));
    app.destroy();
  }

  // ---- Appearance: Light, Dark, Auto.
  {
    updateSettings({ dark: false, autoDark: { mode: "off", from: "19:00", to: "07:00" } });
    const app = await mountSettings(settingsFixture(loadSettings(), { page: "appearance" }), {
      width: 1020,
      height: 1400,
    });
    await shows(app, "Automatic dark style");
    await shows(app, "Light or Dark stays as you chose");
    app.press({ text: "Auto" });
    await app.until(
      () => loadSettings().autoDark.mode === "sunset" && loadSettings().dark,
      "Auto after sunset picks dark at once",
    );
    await showsMatch(app, /^Dark until 0?4:4\d/);
    if (pictures) app.screenshot(path.join(pictures, "appearance-auto-dark-1020x1400.png"));
    app.press({ text: "Light" });
    await app.until(
      () => loadSettings().autoDark.mode === "off" && !loadSettings().dark,
      "Light turns Auto off",
    );
    app.destroy();
  }
  {
    const app = await mountSettings(settingsFixture(loadSettings(), { page: "appearance" }), {
      width: 640,
      height: 1400,
    });
    await shows(app, "Automatic dark style");
    if (pictures) app.screenshot(path.join(pictures, "appearance-auto-dark-640x1400.png"));
    app.destroy();
  }
});

console.log("[settings] brightness, night light and automatic dark style passed");
