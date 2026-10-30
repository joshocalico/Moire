/**
 * Settings › Search driven by pointer input against a throwaway HOME: every status state with
 * live updates, the switch and its confirmation, excluding and re-including a folder through
 * the folder chooser, a drive opt-in (on Storage & Drives), Rebuild and Clear. `SETTINGS_SEARCH_PNG_DIR` also renders
 * the page in both schemes at 640 and 1020 wide, at scale 1 and 1.5.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setUiScaleFactor } from "@moire/ui";
import { loadSettings, updateSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import type { IndexClient } from "@moire/system-management/index-status";
import type { StorageClient } from "@moire/system-management/storage-status";
import {
  FakeIndex,
  absentIndex,
  fakeStorage,
  indexStatus,
  mountedVolume,
  settingsFixture,
} from "./testing";
import { mountSettings } from "./testing-ui";

const GIB = 1024 ** 3;

function mount(
  index: IndexClient | null,
  storage: StorageClient | null,
  // Tall enough that the whole page fits, so focus never scrolls a control out of reach.
  size: { width: number; height: number; scheme?: "dark" | "light" } = {
    width: 1020,
    height: 1400,
  },
  page = "privacy",
) {
  return mountSettings(
    settingsFixture(loadSettings(), { page, services: { index, storage } }),
    size,
  );
}

const savedCache = process.env.XDG_CACHE_HOME;
await withFixture(async (home) => {
  process.env.XDG_CACHE_HOME = path.join(home, "cache");
  fs.mkdirSync(path.join(home, "Projects"));
  fs.mkdirSync(path.join(home, "Documents"));
  const usb = path.join(home, "media", "USB");
  const storage = fakeStorage([mountedVolume("USB", usb, 32 * GIB)]);
  const fake = new FakeIndex();
  const prefs = () => loadSettings();

  // ---- Status: each state the service reports, live through its subscription.
  const app = await mount(fake.client, storage);
  const shows = (text: string) =>
    app.until(() => app.texts().includes(text), `Missing ${text}: ${app.texts().join(" | ")}`);
  await shows("Up to date");
  await shows("18,432 files · 2,210 folders");
  await shows("12 min ago");
  fake.set({ state: "crawling", crawl: { directories: 120, entries: 4000, queued: 40 } });
  await shows("Indexing your files");
  await shows("120 folders read · 40 waiting");
  fake.set({ state: "paused", message: "Paused while the battery is low" });
  await shows("Paused while the battery is low");
  fake.set({ state: "error", message: "Disk is full" });
  await shows("Indexing stopped");
  fake.set({ state: "ready", message: "Up to date" });
  await shows("Up to date");

  // ---- Turning indexing off asks first, since it deletes the index; Cancel keeps it.
  app.press({ focusId: "search:enabled" });
  await shows("Turn off indexing?");
  app.press({ text: "Cancel" });
  await app.settle(20);
  assert.equal(prefs().indexingEnabled, true, "Cancel leaves indexing on");
  app.press({ focusId: "search:enabled" });
  await shows("Turn off indexing?");
  app.press({ text: "Turn off" });
  await app.until(() => !prefs().indexingEnabled, "Turn off writes indexingEnabled");
  fake.set({ state: "disabled", message: "Indexing is off", files: 0, folders: 0, withText: 0 });
  await shows("Indexing is off");
  assert.ok(!app.texts().includes("Files indexed"), "no counts without an index");
  // With no index there is nothing to lose: on and off again need no confirmation.
  app.press({ focusId: "search:enabled" });
  await app.until(() => prefs().indexingEnabled, "Turn on writes indexingEnabled");
  fake.set({ state: "ready", message: "Up to date", files: 10, folders: 2, withText: 4 });
  await shows("Up to date");

  // ---- Excluding a folder through the chooser, refusing Home, and removing it again.
  const projects = path.join(home, "Projects");
  app.press({ focusId: "search:add-exclude" });
  await shows("Exclude a folder from search");
  app.press({ text: "Projects" });
  await shows("Choose folder");
  app.press({ text: "Choose folder" });
  await app.until(
    () => prefs().indexExcludes.includes(projects),
    "The chosen folder is written to indexExcludes",
  );
  await shows("~/Projects");
  await shows("~/Projects excluded");
  app.press({ focusId: "search:add-exclude" });
  await shows("Exclude a folder from search");
  app.press({ text: "Home" });
  await shows("Choose this folder");
  app.press({ text: "Choose this folder" });
  await shows("Your home folder can't be excluded; turn indexing off instead");
  assert.deepEqual(prefs().indexExcludes, [projects], "Home is never excluded");
  app.press({ focusId: `search:remove:${projects}` });
  await app.until(() => prefs().indexExcludes.length === 0, "Remove clears the exclude");
  await shows("No folders excluded");

  // ---- Opting a removable drive in and out, on Storage & Drives where drives now live.
  app.press({ focusId: "sidebar:storage" });
  await shows("Index USB");
  app.press({ focusId: `search:drive:${usb}` });
  await app.until(
    () => prefs().indexIncludes.includes(usb),
    "The drive is written to indexIncludes",
  );
  app.press({ focusId: `search:drive:${usb}` });
  await app.until(() => prefs().indexIncludes.length === 0, "Turning the drive off removes it");
  app.press({ focusId: "sidebar:privacy" });
  await shows("Rebuild index");

  // ---- Rebuild asks the service to walk everything again.
  app.press({ focusId: "setting:privacy.rebuild" });
  await app.until(() => fake.reindexed.length === 1, "Rebuild calls Reindex");
  assert.deepEqual(fake.reindexed, [""], "Rebuild covers every root");
  await shows("Rebuilding the index");

  // ---- Clear: confirm, indexing goes off until the service reports the index gone, then on.
  app.press({ focusId: "setting:privacy.clear" });
  await shows("Clear the index?");
  app.press({ text: "Clear" });
  await app.until(() => !prefs().indexingEnabled, "Clear turns indexing off first");
  await app.settle(10);
  assert.equal(prefs().indexingEnabled, false, "and waits for the service to delete the index");
  fake.set({ state: "disabled", message: "Indexing is off" });
  await app.until(() => prefs().indexingEnabled, "then turns it back on");
  await shows("Index cleared · indexing again from the start");
  app.destroy();

  // ---- A service that isn't running is said plainly, and nothing can be rebuilt.
  updateSettings({ indexExcludes: [projects], indexIncludes: [usb] });
  const absent = await mount(absentIndex(), null);
  await absent.until(
    () => absent.texts().includes("The search service isn't running"),
    "unavailable service",
  );
  assert.ok(absent.texts().includes("Your choices here are saved and apply when it starts"));
  assert.ok(!absent.texts().some((text) => /Error|undefined/.test(text)), "no error dump");
  assert.throws(
    () => absent.press({ focusId: "setting:privacy.rebuild" }),
    /No visible control/,
    "Rebuild is disabled without the service",
  );
  absent.destroy();
  const unplugged = await mount(absentIndex(), null, undefined, "storage");
  await unplugged.until(
    () => unplugged.texts().includes("Index USB"),
    "an opted-in drive stays listed while unplugged",
  );
  unplugged.destroy();

  // ---- Pictures for review: both schemes, two widths, two scales.
  const pictures = process.env.SETTINGS_SEARCH_PNG_DIR;
  if (pictures) {
    fs.writeFileSync(
      path.join(home, "config", "moire", "index.json"),
      JSON.stringify({ exclude: ["*.iso"] }),
    );
    const shown = new FakeIndex(indexStatus({ lastCrawlAt: Date.now() - 3 * 60_000 }));
    for (const scheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const width of [640, 1020]) {
          setUiScaleFactor(scale);
          for (const [name, height] of [
            ["", Math.round(650 * scale)],
            ["-full", Math.round(1500 * scale)],
          ] as const) {
            const view = await mount(shown.client, storage, {
              width: Math.round(width * scale),
              height,
              scheme,
            });
            await view.until(() => view.texts().includes("Up to date"), "ready state");
            await view.settle(4);
            view.screenshot(
              path.join(
                pictures,
                `settings-search-${scheme}-${width}x${height}-scale${scale}${name}.png`,
              ),
            );
            view.destroy();
          }
        }
    setUiScaleFactor(1);
    shown.set({ state: "crawling", crawl: { directories: 812, entries: 30_000, queued: 260 } });
    const crawl = await mount(shown.client, storage, { width: 640, height: 650 });
    await crawl.until(() => crawl.texts().includes("Indexing your files"), "crawling");
    await crawl.settle(4);
    crawl.screenshot(path.join(pictures, "settings-search-dark-640x650-scale1-crawling.png"));
    crawl.press({ focusId: "search:enabled" });
    await crawl.until(() => crawl.texts().includes("Turn off indexing?"), "dialog");
    await crawl.settle(30);
    crawl.screenshot(path.join(pictures, "settings-search-dark-640x650-scale1-turn-off.png"));
    crawl.destroy();
    const missing = await mount(absentIndex(), null, { width: 640, height: 650 });
    await missing.settle(6);
    missing.screenshot(path.join(pictures, "settings-search-dark-640x650-scale1-unavailable.png"));
    missing.destroy();
  }
});
if (savedCache === undefined) delete process.env.XDG_CACHE_HOME;
else process.env.XDG_CACHE_HOME = savedCache;
console.log(
  "[settings/search] status states, switch + confirm, chooser excludes, drive opt-in, rebuild and clear passed",
);
