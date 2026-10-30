/**
 * Settings driven by keyboard and pointer with every service faked: deep links (and the old tab
 * numbers), the sidebar from the keyboard, search with live results, ↑/↓, Enter and Esc, Undo
 * from Overview and Ctrl+Z, Wi‑Fi and Bluetooth actions, the accent and wallpaper reaching the
 * active theme, and a page whose service is missing. `SETTINGS_PNG_DIR` also saves the search
 * results, side sheets and the 640px rail.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { activeThemePath, loadSettings, updateSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import { setUiScaleFactor } from "@moire/ui";
import { mountSettings } from "./testing-ui";
import { SETTINGS, pageInfo } from "./catalog";
import { NO_SERVICES, settingsFixture } from "./testing";

const pictures = process.env.SETTINGS_PNG_DIR;
type App = Awaited<ReturnType<typeof mountSettings>>;
const shot = (app: App, name: string) => {
  if (pictures) app.screenshot(path.join(pictures, `${name}.png`));
};
type HitRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  focusId?: string;
  onPress?: unknown;
};
const KEY = { up: 103, down: 108, enter: 28, escape: 1, z: 44, f: 33 } as const;

await withFixture(async (home) => {
  const shows = async (app: App, text: string) =>
    app.until(
      () => app.texts().includes(text),
      `Missing “${text}”: ${app.texts().slice(0, 80).join(" | ")}`,
    );
  const lacks = (app: App, text: string) =>
    assert.ok(!app.texts().includes(text), `Unexpected “${text}”`);

  // ---- Deep links: a page with an anchor, and the old tab numbers mapped to pages.
  for (const [link, title] of [
    ["appearance#wallpaper", "Wallpaper"],
    ["1", "Displays"],
    ["3", "Search & Privacy"],
    ["network", "Wi‑Fi & Network"],
  ] as const) {
    const app = await mountSettings(settingsFixture(loadSettings(), { page: link }), {
      width: 1020,
      height: 700,
    });
    await shows(app, title);
    app.destroy();
  }

  // ---- The time zone sheet's search: × clears and keeps focus in the field (it used to land on
  // the sheet's Close), typing continues there, and Ctrl+A, Backspace clears it too.
  {
    const app = await mountSettings(settingsFixture(loadSettings(), { page: "datetime" }), {
      width: 1020,
      height: 700,
    });
    const focused = () => (app.window as unknown as { focusedId: string | null }).focusedId;
    app.press({ focusId: "setting:datetime.timezone" });
    await app.until(() => focused() === "datetime:zone-search", "the zone search has focus");
    app.type("lond");
    await shows(app, "lond");
    const hits = (app.window as unknown as { hits: HitRegion[] }).hits;
    const field = hits.find((hit) => hit.focusId === "datetime:zone-search")!;
    // The × inside the field, not the sheet's own Close.
    const clear = hits.find(
      (hit) =>
        hit.focusId?.startsWith("icon-button:") &&
        !!hit.onPress &&
        hit.x >= field.x &&
        hit.x + hit.width <= field.x + field.width &&
        hit.y >= field.y &&
        hit.y + hit.height <= field.y + field.height,
    );
    assert.ok(clear, "the search shows a clear button");
    app.click(clear.x + clear.width / 2, clear.y + clear.height / 2);
    await app.settle(2);
    lacks(app, "lond");
    assert.equal(focused(), "datetime:zone-search", "× keeps focus in the search");
    lacks(app, "Close · Escape");
    app.type("utc");
    await shows(app, "utc");
    app.key(30, "a", { ctrl: true });
    app.key(14, "Backspace");
    await app.settle(2);
    lacks(app, "utc");
    app.type("par");
    await shows(app, "par");
    app.destroy();
  }

  // ---- Every catalog entry is built by its page (so search can't drift from the pages),
  // except those whose backend says no: there's one display (no primary to choose), no lock
  // screen yet, and no mail app installed.
  {
    const app = await mountSettings(settingsFixture(loadSettings()), { width: 1020, height: 2400 });
    const missing: string[] = [];
    for (const entry of SETTINGS) {
      app.press({ focusId: "settings:search" });
      app.key(30, "a", { ctrl: true });
      app.type(entry.label);
      await app.settle(2);
      const found = app.texts().includes(entry.label) && !app.texts().includes("No settings match");
      const page = app.texts().indexOf(pageInfo(entry.page).title, 20);
      if (!found || page < 0) missing.push(entry.id);
      app.key(KEY.escape, "Escape");
    }
    assert.deepEqual(missing.sort(), [
      "apps.mail",
      "displays.primary",
      "power.lock-after",
      "power.lock-on-suspend",
    ]);
    app.destroy();
  }

  // ---- Sidebar from the keyboard: focus a page, ↓ moves, Enter opens.
  {
    const app = await mountSettings(settingsFixture(loadSettings()), { width: 1020, height: 700 });
    await shows(app, "joshua-vm");
    app.press({ focusId: "sidebar:network" });
    await shows(app, "On · connected to Halcyon with internet access");
    app.key(KEY.down, "ArrowDown");
    app.key(KEY.enter, "Enter");
    await shows(app, "On · 2 devices connected");
    app.destroy();
  }

  // ---- Search: typing shows live rows grouped by page with sidebar counts; ↑↓ Enter Esc.
  {
    const fixture = settingsFixture(loadSettings());
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    app.press({ focusId: "settings:search" });
    app.type("screen");
    await shows(app, "Results for “screen”");
    await shows(app, "Resolution");
    await shows(app, "Display scale");
    await shows(app, "Turn the screen off");
    assert.ok(
      app.texts().some((text) => /settings on \d pages/.test(text)),
      "result summary",
    );
    shot(app, "search-dark-1020x700");
    // A setting with no backend is never offered: power-off lid action needs a lid.
    lacks(app, "When the lid closes");
    app.key(KEY.down, "ArrowDown");
    app.key(KEY.enter, "Enter");
    await shows(app, "Displays");
    await app.until(
      () => !app.texts().includes("Results for “screen”"),
      "Enter opens the result's page",
    );
    app.press({ focusId: "settings:search" });
    app.type("dark mode");
    await shows(app, "Color scheme");
    // The result is the live control: switching to Light from the results writes the pref.
    app.press({ text: "Light" });
    await app.until(() => !loadSettings().dark, "Light from search results writes dark=false");
    app.key(KEY.escape, "Escape");
    await app.until(
      () => !app.texts().some((text) => text.startsWith("Results for")),
      "Esc clears search",
    );
    app.press({ focusId: "settings:search" });
    app.type("zzzz");
    await shows(app, "No settings match");
    app.destroy();
  }

  // ---- Type to search: a printable key on a page starts a search with it and focuses the
  // field, so the rest of the word lands there once (typing in the field above would have
  // doubled every letter if fields didn't keep their keys). Ctrl, Alt and Space never do.
  {
    const app = await mountSettings(settingsFixture(loadSettings(), { page: "displays" }), {
      width: 1020,
      height: 700,
    });
    await shows(app, "Displays");
    app.key(0, " ", { text: " " });
    app.key(0, "q", { text: "q", ctrl: true });
    app.key(0, "w", { text: "w", alt: true });
    lacks(app, "Results for “q”");
    lacks(app, "Results for “w”");
    app.type("wallp");
    await shows(app, "Results for “wallp”");
    await shows(app, "Choose…");
    app.key(KEY.escape, "Escape");
    await app.until(
      () => !app.texts().some((text) => text.startsWith("Results for")),
      "Esc clears a typed search",
    );
    app.destroy();
  }

  // ---- Undo: a change lands in Recently changed; Undo there and Ctrl+Z both put it back.
  {
    updateSettings({ themeFamily: "moire", showDesktopIcons: true });
    const app = await mountSettings(settingsFixture(loadSettings(), { page: "appearance" }), {
      width: 1020,
      height: 700,
    });
    app.press({ text: "Cupertino" });
    await app.until(() => loadSettings().themeFamily === "cupertino", "style written");
    app.press({ focusId: "sidebar:overview" });
    await shows(app, "Desktop style set to Cupertino");
    shot(app, "overview-recent-dark-1020x700");
    app.press({ focusId: "overview:undo" });
    await app.until(() => loadSettings().themeFamily === "moire", "Undo restores the style");
    await app.until(
      () => !app.texts().includes("Desktop style set to Cupertino"),
      "the undone change leaves the list",
    );
    assert.ok(
      app.texts().includes("Color scheme set to Light"),
      "the journal persists across launches",
    );
    app.press({ focusId: "overview:toggle:icons" });
    await app.until(() => !loadSettings().showDesktopIcons, "quick toggle writes the pref");
    app.key(KEY.z, "z", { ctrl: true });
    await app.until(() => loadSettings().showDesktopIcons, "Ctrl+Z undoes the last change");
    app.destroy();
  }

  // ---- Accent and wallpaper reach the active theme the shell and apps load.
  {
    const app = await mountSettings(settingsFixture(loadSettings(), { page: "appearance" }), {
      width: 1020,
      height: 700,
    });
    app.press({ focusId: "setting:appearance.accent:green" });
    await app.until(() => loadSettings().accent === "#3ecf8e", "accent pref written");
    const theme = JSON.parse(fs.readFileSync(activeThemePath(), "utf8")) as {
      tokens: { accent: string };
      wallpaper: { mode: string; path?: string };
    };
    assert.equal(theme.tokens.accent, "#3ecf8e", "the active theme carries the accent");
    // A PNG chosen with the file chooser becomes the wallpaper image.
    const picture = path.join(home, "Pictures", "beach.png");
    fs.mkdirSync(path.dirname(picture), { recursive: true });
    const png = new PNG({ width: 4, height: 4 });
    fs.writeFileSync(picture, PNG.sync.write(png));
    app.press({ focusId: "setting:appearance.wallpaper:choose" });
    await shows(app, "Choose a wallpaper picture");
    app.press({ text: "Pictures" });
    await shows(app, "beach.png");
    app.press({ text: "beach.png" });
    app.press({ text: "Open" });
    await app.until(() => loadSettings().wallpaper?.path === picture, "image wallpaper written");
    const after = JSON.parse(fs.readFileSync(activeThemePath(), "utf8")) as {
      wallpaper: { mode: string; path?: string };
    };
    assert.deepEqual(
      [after.wallpaper.mode, after.wallpaper.path],
      ["image", picture],
      "the compositor's theme file names the picture",
    );
    await shows(app, "Picture");
    app.destroy();
  }

  // ---- Wi‑Fi: switch, Connect on a secured network asks for a password, details, Forget.
  {
    const fixture = settingsFixture(loadSettings(), { page: "network" });
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    await app.until(() => fixture.desktop.calls.includes("refreshWifi"), "opening the page scans");
    app.press({ focusId: "network:/ap/3" });
    await shows(app, "Join Bluebird");
    shot(app, "network-password-dark-1020x700");
    app.type("short");
    app.key(KEY.enter, "Enter");
    await shows(app, "8 to 63 characters, or 64 hexadecimal digits");
    app.type("-but-long-enough");
    app.press({ focusId: "network:password:connect" });
    await app.until(
      () => fixture.desktop.calls.some((call) => call.startsWith("connectWifi:/ap/3")),
      "connects with the password",
    );
    // An open network connects at once.
    app.press({ focusId: "network:/ap/4" });
    await app.until(
      () => fixture.desktop.calls.some((call) => call.startsWith("connectWifi:/ap/4")),
      "open network connects",
    );
    fixture.desktop.set({});
    app.press({ focusId: "setting:network.wifi" });
    await app.until(() => fixture.desktop.calls.includes("setWifiEnabled:false"), "Wi‑Fi switch");
    await shows(app, "Off");
    app.press({ focusId: "setting:network.wifi" });
    await app.until(() => fixture.desktop.calls.includes("setWifiEnabled:true"), "Wi‑Fi back on");
    app.destroy();
    // Details of the connected network: Disconnect and Forget.
    const second = settingsFixture(loadSettings(), { page: "network" });
    const details = await mountSettings(second, { width: 1020, height: 700 });
    details.press({ focusId: "network:/ap/1:details" });
    await shows(details, "IPv4 address");
    shot(details, "network-details-dark-1020x700");
    details.press({ focusId: "network:forget" });
    await details.until(() => second.desktop.calls.includes("forgetWifi:/ap/1"), "Forget");
    details.press({ focusId: "network:/ap/1:details" });
    await shows(details, "Disconnect");
    details.press({ focusId: "network:disconnect" });
    await details.until(() => second.desktop.calls.includes("disconnectWifi"), "Disconnect");
    details.destroy();
  }

  // ---- Bluetooth: power, connect, details with Forget, and discovery while the page is open.
  {
    const fixture = settingsFixture(loadSettings(), { page: "bluetooth" });
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    await shows(app, "Pixel 8");
    app.press({ focusId: "bluetooth:dev_phones:connect" });
    await app.until(
      () =>
        fixture.desktop.calls.some(
          (call) => call.startsWith("setBluetoothConnected") && call.includes("dev_phones"),
        ),
      "Connect",
    );
    app.press({ focusId: "bluetooth:dev_keys" });
    await shows(app, "E4:1A:22:01:02:03");
    shot(app, "bluetooth-details-dark-1020x700");
    app.press({ focusId: "bluetooth:forget" });
    await app.until(
      () =>
        fixture.desktop.calls.some(
          (call) => call.startsWith("forgetBluetoothDevice") && call.includes("dev_keys"),
        ),
      "Forget",
    );
    await app.until(() => !app.texts().includes("MX Keys"), "forgotten device leaves the list");
    app.press({ focusId: "bluetooth:pair:near_pixel" });
    await app.until(
      () => fixture.desktop.calls.some((call) => call.startsWith("beginBluetoothPair")),
      "Pair",
    );
    await shows(app, "Pairing… Follow any instructions on the device.");
    app.key(KEY.escape, "Escape");
    await app.until(() => !app.texts().includes("Pair Pixel 8"), "Escape closes the sheet");
    app.press({ focusId: "setting:bluetooth.power" });
    await app.until(
      () =>
        fixture.desktop.calls.some(
          (call) => call.startsWith("setBluetoothPowered") && call.includes("false"),
        ),
      "power off",
    );
    app.press({ focusId: "sidebar:sound" });
    await app.until(
      () => fixture.desktop.calls.some((call) => call.startsWith("stopBluetoothDiscovery")),
      "leaving the page stops discovery",
    );
    app.destroy();
  }

  // ---- A failure is a banner on the page; a missing service is an empty state, not a crash.
  {
    const fixture = settingsFixture(loadSettings(), { page: "sound" });
    fixture.desktop.client.setMute = async () => {
      throw new Error("The audio service didn't answer");
    };
    const app = await mountSettings(fixture, { width: 1020, height: 700 });
    app.press({ focusId: "setting:sound.mute" });
    await shows(app, "The audio service didn't answer");
    app.destroy();
    const bare = settingsFixture(loadSettings(), { page: "network", services: NO_SERVICES });
    const empty = await mountSettings(bare, { width: 1020, height: 700 });
    await shows(empty, "Network controls aren't running");
    empty.press({ focusId: "sidebar:overview" });
    await shows(empty, "Quick toggles");
    lacks(empty, "Wi‑Fi");
    empty.destroy();
  }

  // ---- The 640px rail, and search from it.
  {
    const app = await mountSettings(settingsFixture(loadSettings()), { width: 640, height: 650 });
    await shows(app, "joshua-vm");
    lacks(app, "Wi‑Fi & Network");
    app.press({ focusId: "sidebar:search" });
    app.type("sleep");
    await shows(app, "Suspend");
    shot(app, "search-dark-640x650");
    app.destroy();
  }

  // ---- Pictures at scale 1.5 and in light for review.
  if (pictures) {
    for (const [scheme, scale] of [
      ["light", 1],
      ["dark", 1.5],
    ] as const) {
      setUiScaleFactor(scale);
      const app = await mountSettings(
        settingsFixture({ ...loadSettings(), dark: scheme === "dark" }),
        {
          width: Math.round(1020 * scale),
          height: Math.round(700 * scale),
          scheme,
        },
      );
      app.press({ focusId: "settings:search" });
      app.type("screen");
      await shows(app, "Resolution");
      shot(app, `search-${scheme}-1020x700${scale === 1 ? "" : "-scale1.5"}`);
      app.destroy();
      for (const [width, height] of [
        [1020, 700],
        [640, 650],
      ] as const) {
        const sheet = await mountSettings(
          settingsFixture({ ...loadSettings(), dark: scheme === "dark" }, { page: "network" }),
          { width: Math.round(width * scale), height: Math.round(height * scale), scheme },
        );
        sheet.press({ focusId: "network:/ap/1:details" });
        await shows(sheet, "IPv4 address");
        shot(
          sheet,
          `network-details-${scheme}-${width}x${height}${scale === 1 ? "" : "-scale1.5"}`,
        );
        sheet.destroy();
      }
    }
    setUiScaleFactor(1);
  }
});
console.log(
  "[settings] deep links, sidebar keys, search, undo, accent and wallpaper, Wi‑Fi, Bluetooth and missing services passed",
);
