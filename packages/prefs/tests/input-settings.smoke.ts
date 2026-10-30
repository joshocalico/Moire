/* eslint-disable import/no-relative-parent-imports -- Exercise the package's own sources in a disposable profile. */
/** Keyboard and pointer prefs: normalization, merging writers, and the compositor's watcher. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_KEYBOARD_SETTINGS,
  DEFAULT_POINTER_SETTINGS,
  createInputSettingsWatcher,
  keyboardLayoutId,
  loadSettings,
  normalizeKeyboardSettings,
  normalizePointerSettings,
  settingsPath,
  updateKeyboardSettings,
  updatePointerSettings,
  updateSettings,
  type InputSettings,
} from "../src/index";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-input-prefs-"));
const previous = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = directory;
try {
  assert.deepEqual(loadSettings().keyboard, DEFAULT_KEYBOARD_SETTINGS, "no file → defaults");
  assert.deepEqual(loadSettings().pointer, DEFAULT_POINTER_SETTINGS);

  const keyboard = normalizeKeyboardSettings({
    layouts: [
      { layout: "us" },
      { layout: "de", variant: "nodeadkeys" },
      { layout: "us", variant: "" }, // duplicate
      { layout: "fr; rm -rf /" }, // not an XKB name
      { layout: "gb", variant: "extd" },
      { layout: "ru" },
      { layout: "jp" }, // fifth layout: XKB has four groups
    ],
    switchShortcut: "hyper-q",
    repeatEnabled: "yes",
    repeatDelayMs: 10,
    repeatRate: 1e9,
    capsLock: "escape",
  });
  assert.deepEqual(keyboard.layouts.map(keyboardLayoutId), [
    "us",
    "de(nodeadkeys)",
    "gb(extd)",
    "ru",
  ]);
  assert.equal(keyboard.switchShortcut, "super-space");
  assert.equal(keyboard.repeatEnabled, true);
  assert.equal(keyboard.repeatDelayMs, 150);
  assert.equal(keyboard.repeatRate, 100);
  assert.equal(keyboard.capsLock, "escape");
  assert.deepEqual(normalizeKeyboardSettings({ layouts: [] }).layouts, [
    { layout: "us", variant: "" },
  ]);
  const pointer = normalizePointerSettings({
    speed: 4,
    accelProfile: "linear",
    naturalScrollMouse: true,
    scrollMethod: "edge",
    leftHanded: 1,
    kineticScroll: false,
    clickMethod: "middle",
  });
  assert.equal(pointer.speed, 1);
  assert.equal(pointer.accelProfile, "adaptive");
  assert.equal(pointer.naturalScrollMouse, true);
  assert.equal(pointer.scrollMethod, "edge");
  assert.equal(pointer.leftHanded, false);
  assert.equal(pointer.kineticScroll, false);
  assert.equal(pointer.clickMethod, "clickfinger", "unknown click methods fall back");
  console.log("PASS keyboard and pointer prefs normalize field by field");

  const changes: [InputSettings, InputSettings][] = [];
  const watcher = createInputSettingsWatcher((next, before) => changes.push([next, before]));
  assert.equal(watcher.poll(), false);
  updateSettings({ dark: false });
  assert.equal(watcher.poll(), false, "unrelated prefs do not wake the seat");
  updateKeyboardSettings({ repeatRate: 25 });
  updatePointerSettings({ leftHanded: true });
  assert.equal(watcher.poll(), true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]![0].keyboard.repeatRate, 25);
  assert.equal(changes[0]![0].pointer.leftHanded, true);
  assert.equal(changes[0]![1].keyboard.repeatRate, 40);
  assert.equal(loadSettings().dark, false, "partial writers keep other prefs");
  assert.equal(watcher.current().keyboard.repeatRate, 25);
  // A hand-edited, malformed section falls back to defaults without breaking the file.
  const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...raw, keyboard: "qwerty" }));
  assert.equal(watcher.poll(), true);
  assert.deepEqual(watcher.current().keyboard, DEFAULT_KEYBOARD_SETTINGS);
  console.log("PASS updates merge into the stored profile and the watcher reports real changes");
} finally {
  process.env.XDG_CONFIG_HOME = previous;
  fs.rmSync(directory, { recursive: true, force: true });
}
