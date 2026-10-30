/** Launcher pins: normalising a hand-edited list, pin/unpin/move, ordering, and the stored round trip. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_LAUNCHER_PINS,
  moveLauncherPin,
  normalizeLauncherPins,
  orderLauncherApps,
  pinLauncherApp,
  toggleLauncherPin,
  unpinLauncherApp,
} from "./launcher";

assert.deepEqual(normalizeLauncherPins(null), []);
assert.deepEqual(normalizeLauncherPins("files.desktop"), []);
assert.deepEqual(
  normalizeLauncherPins([
    " a.desktop ",
    "a.desktop",
    3,
    "",
    "x/y.desktop",
    "b\0.desktop",
    "b.desktop",
  ]),
  ["a.desktop", "b.desktop"],
  "trimmed, deduped, invalid ids dropped, order kept",
);
assert.equal(
  normalizeLauncherPins(Array.from({ length: 100 }, (_, i) => `app${i}.desktop`)).length,
  MAX_LAUNCHER_PINS,
);
assert.deepEqual(normalizeLauncherPins(["z".repeat(256)]), [], "overlong ids are dropped");

const pins = ["a", "b", "c"];
assert.deepEqual(pinLauncherApp(pins, "d"), ["a", "b", "c", "d"]);
assert.deepEqual(pinLauncherApp(pins, "b"), pins, "pinning twice is a no-op");
assert.deepEqual(pinLauncherApp(pins, "x/y"), pins, "invalid ids aren't pinned");
const full = Array.from({ length: MAX_LAUNCHER_PINS }, (_, i) => `p${i}`);
assert.deepEqual(pinLauncherApp(full, "more"), full, "a full list stays full");
assert.deepEqual(unpinLauncherApp(pins, "b"), ["a", "c"]);
assert.deepEqual(toggleLauncherPin(pins, "a"), ["b", "c"]);
assert.deepEqual(toggleLauncherPin(pins, "e"), ["a", "b", "c", "e"]);
assert.deepEqual(moveLauncherPin(pins, "c", -1), ["a", "c", "b"]);
assert.deepEqual(moveLauncherPin(pins, "a", -1), pins, "the first can't move earlier");
assert.deepEqual(moveLauncherPin(pins, "a", 1), ["b", "a", "c"]);
assert.deepEqual(moveLauncherPin(pins, "c", 5), pins, "the last can't move later");
assert.deepEqual(moveLauncherPin(pins, "missing", 1), pins);

const apps = ["files", "editor", "clock", "terminal"].map((id) => ({ id }));
assert.deepEqual(
  orderLauncherApps(apps, []).map((app) => app.id),
  ["files", "editor", "clock", "terminal"],
);
assert.deepEqual(
  orderLauncherApps(apps, ["terminal", "gone", "editor"]).map((app) => app.id),
  ["terminal", "editor", "files", "clock"],
  "installed pins first in pin order, missing pins skipped, the rest in their order",
);

// Stored: the field survives normalisation and the read-modify-write helper.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-pins-"));
process.env.XDG_CONFIG_HOME = home;
const { loadSettings, updateSettings, updateLauncherPins } = await import("./index");
assert.deepEqual(loadSettings().launcherPins, [], "defaults to no pins");
updateSettings({ launcherPins: ["files.desktop"] });
assert.deepEqual(
  updateLauncherPins((current) => pinLauncherApp(current, "editor.desktop")),
  ["files.desktop", "editor.desktop"],
);
fs.writeFileSync(
  path.join(home, "moire", "settings.json"),
  JSON.stringify({ launcherPins: ["ok.desktop", "ok.desktop", 7] }),
);
assert.deepEqual(loadSettings().launcherPins, ["ok.desktop"], "a hand-edited file is cleaned");
fs.rmSync(home, { recursive: true, force: true });
console.log("launcher pins: normalise, pin/unpin/move, order and store ok");
