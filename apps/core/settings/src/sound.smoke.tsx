/**
 * Sound with the desktop controls faked: choosing the output and input, the microphone switch,
 * per-app mute, the input meter running only while it is on screen, an older service without
 * device lists, and a meter that can't run. Also the pure wording and meter arithmetic.
 * `SETTINGS_PNG_DIR` also writes the page.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { loadSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import { mountSettings } from "./testing-ui";
import { desktopSnapshot, FakeDesktop, settingsFixture } from "./testing";
import {
  appsSummary,
  deviceChoices,
  meterLevel,
  meterStep,
  streamDescription,
} from "./pages/sound-model";

const pictures = process.env.SETTINGS_PNG_DIR;
type App = Awaited<ReturnType<typeof mountSettings>>;

// ---- Wording and the meter's scale.
assert.equal(meterLevel(0), 0);
assert.equal(meterLevel(1), 1);
assert.equal(meterLevel(0.001), 0, "-60 dB is the floor");
assert.ok(Math.abs(meterLevel(0.1) - 2 / 3) < 1e-9, "-20 dB sits two thirds up");
assert.equal(meterStep(0.9, 0), 0.9 - 0.12, "the bar falls back gently");
assert.equal(meterStep(0.1, 1), 1, "and jumps up at once");
assert.deepEqual(
  deviceChoices([
    { id: "1", name: "USB Audio", isDefault: true },
    { id: "2", name: "USB Audio", isDefault: false },
    { id: "3", name: "HDMI", isDefault: false },
  ]).map((choice) => choice.label),
  ["USB Audio (1)", "USB Audio (2)", "HDMI"],
);
assert.equal(
  streamDescription({ id: "1", app: "Firefox", title: "Radio", volume: 0.5, muted: false }),
  "Radio · 50%",
);
assert.equal(
  streamDescription({ id: "1", app: "Videos", title: "", volume: 0.5, muted: true }),
  "Muted",
);
assert.equal(appsSummary([]), "When an app plays sound, its volume appears here.");

await withFixture(async () => {
  const shows = async (app: App, text: string) =>
    app.until(
      () => app.texts().includes(text),
      `Missing “${text}”: ${app.texts().slice(0, 80).join(" | ")}`,
    );
  const lacks = (app: App, text: string) =>
    assert.ok(!app.texts().includes(text), `Unexpected “${text}”`);

  // ---- Devices, the microphone, apps and the meter.
  {
    const fixture = settingsFixture(loadSettings(), { page: "sound" });
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    for (const text of [
      "Output",
      "Input",
      "Applications",
      "Firefox",
      "Lo-fi beats – YouTube · 100%",
    ])
      await shows(app, text);
    await app.until(
      () =>
        fixture.desktop.calls.includes("startInputMeter") && fixture.desktop.levelFollowers === 1,
      "the meter runs while the page is open",
    );
    fixture.desktop.inputLevel(0.5);
    await app.settle(2);
    if (pictures) app.screenshot(path.join(pictures, "sound-dark-1020x700.png"));

    app.press({ text: "Built-in Audio Analog Stereo" });
    await app.settle(2);
    app.press({ text: "WH-1000XM5" });
    await app.until(
      () => fixture.desktop.calls.includes("setDefaultSoundDevice:output,61"),
      "choosing an output",
    );
    await shows(app, "On · 64% on WH-1000XM5");

    app.press({ text: "Built-in Microphone" });
    await app.settle(2);
    app.press({ text: "USB Microphone" });
    await app.until(
      () => fixture.desktop.calls.includes("setDefaultSoundDevice:input,62"),
      "choosing an input",
    );

    app.press({ focusId: "setting:sound.input-mute" });
    await app.until(
      () => fixture.desktop.calls.includes("setInputMute:true"),
      "the microphone switch mutes the input",
    );
    await shows(app, "Muted: apps hear silence");

    app.press({ focusId: "sidebar:displays" });
    await app.until(
      () =>
        fixture.desktop.calls.includes("stopInputMeter") && fixture.desktop.levelFollowers === 0,
      "leaving the page stops the meter",
    );
    app.destroy();
  }

  // ---- 640px, opened at Applications: the per-app slider and its mute button, inside.
  {
    const fixture = settingsFixture(loadSettings(), { page: "sound#apps" });
    const app = await mountSettings(fixture, { width: 640, height: 650 });
    await shows(app, "Applications");
    await app.settle(4);
    if (pictures) app.screenshot(path.join(pictures, "sound-dark-640x650.png"));
    app.press({ focusId: "setting:sound.app.80:mute" });
    await app.until(
      () => fixture.desktop.calls.includes("setStreamMute:80,false"),
      "unmuting an app",
    );
    await shows(app, "45%");
    app.destroy();
  }

  // ---- No apps playing, and a meter that can't run: said, not hidden behind a dead control.
  {
    const base = desktopSnapshot();
    const sound = base.sound!;
    assert.equal(sound.kind, "ready");
    if (sound.kind !== "ready") throw new Error("fixture");
    const fixture = settingsFixture(loadSettings(), { page: "sound" });
    fixture.desktop.set({
      sound: {
        ...sound,
        streams: [],
        meter: {
          kind: "unavailable",
          message: "The input level can't be shown: PipeWire's library isn't available",
        },
      },
    });
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    await shows(app, "No apps are playing");
    await shows(app, "The input level can't be shown: PipeWire's library isn't available");
    assert.ok(!fixture.desktop.calls.includes("startInputMeter"), "no meter when it can't run");
    app.destroy();
  }

  // ---- An older service without device lists: output only, as before.
  {
    const { sound: _unused, ...older } = desktopSnapshot();
    const fixture = settingsFixture(loadSettings(), {
      page: "sound",
      services: { desktop: new FakeDesktop(older) },
    });
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    await shows(app, "Output");
    lacks(app, "Input");
    lacks(app, "Applications");
    app.destroy();
  }
});
console.log(
  "[settings/sound] output and input choice, microphone switch, per-app mute, meter lifetime, older service and unavailable meter passed",
);
