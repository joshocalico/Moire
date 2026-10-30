/**
 * Desktop & Launcher's pinned apps against the real prefs file: the list in pin order, a pin
 * whose app is gone, move down, unpin, pin from the menu, Undo, and search finding the section.
 * `SETTINGS_PNG_DIR` also saves the page at 1020 and 640 wide.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { loadSettings, updateSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import { mountSettings } from "./testing-ui";
import { settingsFixture } from "./testing";

await withFixture(async () => {
  updateSettings({ launcherPins: ["editor.desktop", "files.desktop", "gone.desktop"] });
  const pictures = process.env.SETTINGS_PNG_DIR;
  if (pictures)
    for (const [width, height] of [
      [1020, 700],
      [640, 650],
    ] as const) {
      const shot = await mountSettings(settingsFixture(loadSettings(), { page: "desktop" }), {
        width,
        height,
      });
      await shot.settle(6);
      shot.screenshot(path.join(pictures, `desktop-launcher-dark-${width}x${height}.png`));
      shot.destroy();
    }
  const app = await mountSettings(settingsFixture(loadSettings(), { page: "desktop#pins" }), {
    width: 1020,
    height: 900,
  });
  const shows = (text: string) =>
    app.until(() => app.texts().includes(text), `Missing “${text}”: ${app.texts().join(" | ")}`);
  const pins = () => loadSettings().launcherPins;

  await shows("Launcher");
  await shows("Text Editor");
  await shows("Not installed; it keeps its place if it comes back");
  await shows("Desktop icons shown · 3 pinned apps");
  const texts = app.texts();
  assert.ok(texts.indexOf("Text Editor") < texts.indexOf("Files"), "pins are listed in pin order");

  app.press({ focusId: "desktop:pin-down:editor.desktop" });
  await app.settle(2);
  assert.deepEqual(pins(), ["files.desktop", "editor.desktop", "gone.desktop"]);

  app.press({ focusId: "desktop:unpin:gone.desktop" });
  await app.settle(2);
  assert.deepEqual(pins(), ["files.desktop", "editor.desktop"]);

  // A pin made in the launcher meanwhile is kept: changes start from the stored list.
  updateSettings({ launcherPins: ["files.desktop", "editor.desktop", "firefox.desktop"] });
  app.press({ text: "Choose an app…" });
  await app.settle(2);
  app.press({ text: "Image Viewer" });
  await app.settle(2);
  assert.deepEqual(pins(), [
    "files.desktop",
    "editor.desktop",
    "firefox.desktop",
    "image-viewer.desktop",
  ]);
  await shows("Image Viewer");

  // Pin changes in a row are one journal entry, so Ctrl+Z puts back the list the page opened with.
  app.key(44, "z", { ctrl: true });
  await app.settle(2);
  assert.deepEqual(pins(), ["editor.desktop", "files.desktop", "gone.desktop"]);
  app.destroy();

  // Search finds the launcher by the words people use.
  const search = await mountSettings(settingsFixture(loadSettings()), {
    width: 1020,
    height: 700,
  });
  search.press({ focusId: "settings:search" });
  search.type("favourites");
  await search.until(
    () => search.texts().includes("Pinned apps"),
    `search: ${search.texts().join(" | ")}`,
  );
  search.destroy();
});
console.log("[settings/desktop] launcher pins: order, missing app, move, unpin, pin, undo, search");
