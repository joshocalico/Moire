/**
 * Settings' pure rules: the page and setting registry, deep links and the old tab numbers,
 * search folding and ranking, the change journal, and the wording and ordering the pages use.
 */
import assert from "node:assert/strict";
import {
  GROUPS,
  PAGES,
  SETTINGS,
  deepLink,
  initialRoute,
  parseDeepLink,
  parseSettingsActivation,
  settingsActivation,
} from "./catalog";
import {
  JOURNAL_LIMIT,
  parseJournal,
  recordChange,
  withoutEntry,
  type JournalEntry,
} from "./history";
import { PAGE_BUILDERS } from "./pages";
import {
  accentId,
  scaleFromSlider,
  sliderFromScale,
  wallpaperChoice,
} from "./pages/appearance-model";
import { bluetoothTile } from "./pages/bluetooth-model";
import { filterLayouts, layoutChoices, layoutName, moved } from "./pages/keyboard";
import {
  needsPassword,
  pointDetail,
  sortAccessPoints,
  wifiSentence,
  wifiTile,
} from "./pages/network-model";
import { timeoutLabel } from "./pages/power";
import { batteryDetail, formatDuration } from "./pages/power-model";
import { countsByPage, fold, groupHits, resultSummary, searchSettings } from "./search-settings";
import { generationFromLink, isAdministrator, parseOsRelease, passwdName } from "./system-info";
import { desktopSnapshot } from "./testing";

// ---- Registry: sixteen pages in four groups, every page has a builder, setting ids are unique.
assert.equal(PAGES.length, 16);
assert.deepEqual(
  GROUPS.map((group) => PAGES.filter((page) => page.group === group.id).length),
  [2, 5, 4, 5],
);
for (const page of PAGES) assert.ok(PAGE_BUILDERS[page.id], `${page.id} has a builder`);
assert.ok(PAGE_BUILDERS.overview);
assert.equal(
  new Set(SETTINGS.map((entry) => entry.id)).size,
  SETTINGS.length,
  "unique setting ids",
);
for (const entry of SETTINGS) {
  assert.ok(entry.id.startsWith(`${entry.page}.`), `${entry.id} is on its page`);
  assert.ok(PAGES.some((page) => page.id === entry.page));
}

// ---- Deep links: page, page#anchor, aliases, the old tab numbers; unknown parts are dropped.
assert.deepEqual(parseDeepLink("appearance#wallpaper"), {
  kind: "page",
  id: "appearance",
  anchor: "wallpaper",
});
assert.deepEqual(parseDeepLink("network#wifi"), { kind: "page", id: "network", anchor: "wifi" });
assert.deepEqual(parseDeepLink("appearance#nothing"), { kind: "page", id: "appearance" });
assert.deepEqual(parseDeepLink("search"), { kind: "page", id: "privacy" });
assert.deepEqual(parseDeepLink("bogus"), { kind: "page", id: "overview" });
assert.deepEqual(parseDeepLink(""), { kind: "page", id: "overview" });
assert.deepEqual(
  ["0", "1", "2", "3", "4", "9"].map((tab) => (parseDeepLink(tab) as { id: string }).id),
  ["appearance", "displays", "sound", "privacy", "about", "overview"],
);
assert.deepEqual(initialRoute({ MOIRE_SETTINGS_TAB: "1" }), { kind: "page", id: "displays" });
assert.deepEqual(
  initialRoute({ MOIRE_SETTINGS_PAGE: "displays#resolution", MOIRE_SETTINGS_TAB: "0" }),
  { kind: "page", id: "displays", anchor: "resolution" },
  "the page link wins over the old tab",
);
assert.equal(deepLink(parseDeepLink("appearance#wallpaper")), "appearance#wallpaper");

// ---- A second start hands its link (or none) to the running window; anything else is dropped.
assert.deepEqual(settingsActivation({ MOIRE_SETTINGS_PAGE: "displays" }), { link: "displays" });
assert.deepEqual(settingsActivation({}), { link: null });
assert.deepEqual(parseSettingsActivation({ link: "network#wifi" }), { link: "network#wifi" });
assert.deepEqual(parseSettingsActivation({ link: null }), { link: null });
for (const bad of [null, "displays", {}, { link: 3 }, { link: "x".repeat(257) }])
  assert.equal(parseSettingsActivation(bad), null);

// ---- Search: folding, synonyms, ranking and grouping.
assert.equal(fold("Wi‑Fi & Café"), "wi fi cafe");
const top = (query: string) => searchSettings(query)[0]?.entry.id;
assert.equal(top("dark mode"), "appearance.scheme", "dark mode finds Color scheme");
assert.equal(top("resolution"), "displays.resolution");
assert.equal(top("wifi"), "network.wifi", "wifi finds Wi‑Fi without its hyphen");
assert.equal(top("accent"), "appearance.accent");
assert.equal(top("caps"), "keyboard.caps");
assert.equal(top("suspend"), "power.suspend");
assert.ok(
  searchSettings("screen size").some((hit) => hit.entry.id === "displays.resolution"),
  "synonym",
);
assert.equal(searchSettings("xyzzy").length, 0);
assert.equal(searchSettings("   ").length, 0);
assert.ok(
  searchSettings("interface").findIndex((hit) => hit.entry.id === "appearance.size") <
    searchSettings("interface").findIndex((hit) => hit.entry.id === "keyboard.layouts") ||
    !searchSettings("interface").some((hit) => hit.entry.id === "keyboard.layouts"),
  "a label match ranks above a keyword match",
);
const groups = groupHits(searchSettings("screen"));
assert.deepEqual(
  groups.map((group) => group.page),
  PAGES.map((page) => page.id).filter((id) => groups.some((group) => group.page === id)),
  "groups follow the sidebar",
);
assert.ok((countsByPage(groups).displays ?? 0) >= 3);
assert.match(resultSummary(groups), /^\d+ settings on \d+ pages$/);
assert.equal(resultSummary([]), "No settings match");

// ---- Journal: newest first, repeated changes fold, going back cancels, capped and parsed.
const change = (key: JournalEntry["key"], from: unknown, to: unknown) => ({
  key,
  from,
  to,
  page: "appearance" as const,
  label: `${key} ${String(to)}`,
});
let journal = recordChange([], change("dark", true, false), 1, "a");
assert.equal(journal.length, 1);
journal = recordChange(journal, change("dark", false, true), 2, "b");
assert.equal(journal.length, 0, "changing straight back cancels the entry");
journal = recordChange([], change("themeFamily", "moire", "redmond"), 1, "a");
journal = recordChange(journal, change("themeFamily", "redmond", "cupertino"), 2, "b");
assert.deepEqual(
  [journal.length, journal[0]!.from, journal[0]!.to],
  [1, "moire", "cupertino"],
  "folds",
);
journal = recordChange(journal, change("dark", true, true), 3, "c");
assert.equal(journal.length, 1, "no change, no entry");
for (let index = 0; index < 30; index++)
  journal = recordChange(
    journal,
    change(index % 2 ? "dark" : "uiScale", index, index + 1),
    index,
    `x${index}`,
  );
assert.equal(journal.length, JOURNAL_LIMIT);
assert.equal(withoutEntry(journal, journal[0]!.id).length, JOURNAL_LIMIT - 1);
assert.equal(parseJournal(JSON.parse(JSON.stringify(journal))).length, JOURNAL_LIMIT);
assert.deepEqual(
  parseJournal([{ id: "x", key: "rm -rf", from: 1, at: 1, page: "x", label: "x" }, 7, null]),
  [],
);
assert.deepEqual(parseJournal("nope"), []);

// ---- Network: order, wording, when a password is needed.
const snapshot = desktopSnapshot();
assert.equal(snapshot.wifi.kind, "ready");
if (snapshot.wifi.kind === "ready") {
  const wifi = snapshot.wifi;
  assert.deepEqual(
    sortAccessPoints([...wifi.accessPoints].reverse()).map((point) => point.ssid),
    ["Halcyon", "Halcyon-Guest", "Bluebird", "Corner Café", "NETGEAR-42"],
  );
  assert.equal(wifiSentence(wifi), "On · connected to Halcyon with internet access");
  assert.equal(wifiSentence({ ...wifi, enabled: false }), "Off");
  assert.deepEqual(wifiTile(wifi), { value: "Halcyon", detail: "Connected · internet access" });
  assert.equal(pointDetail(wifi.accessPoints[0]!, wifi), "Connected · Internet access");
  assert.equal(pointDetail(wifi.accessPoints[3]!, wifi), "Open network");
  assert.equal(needsPassword(wifi.accessPoints[2]!), true);
  assert.equal(
    needsPassword({ ...wifi.accessPoints[2]!, saved: true }),
    false,
    "a saved network joins without one",
  );
}
assert.deepEqual(bluetoothTile(snapshot.bluetooth), {
  value: "2 connected",
  detail: "MX Keys, MX Master 3S",
});

// ---- Power and battery wording.
assert.equal(formatDuration(3 * 3600 + 12 * 60), "3 h 12 min");
assert.equal(formatDuration(20), "under a minute");
assert.equal(
  snapshot.battery.kind === "ready" && batteryDetail(snapshot.battery),
  "3 h 12 min left",
);
assert.deepEqual(
  [null, 0, 60, 300, 1800, 3600].map((seconds) => timeoutLabel(seconds)),
  ["Never", "Immediately", "After 1 minute", "After 5 minutes", "After 30 minutes", "After 1 hour"],
);

// ---- Appearance: accent swatches, wallpaper choice and the size slider.
assert.equal(accentId(null), "default");
assert.equal(accentId("#3ecf8e"), "green");
assert.equal(accentId("#123456"), null, "a hand-edited colour selects no swatch");
assert.equal(wallpaperChoice(null), "theme");
assert.equal(wallpaperChoice({ mode: "image" }), "theme", "an image without a path is the default");
assert.equal(wallpaperChoice({ mode: "image", path: "/a.png" }), "image");
assert.equal(scaleFromSlider(sliderFromScale(1.5)), 1.5);

// ---- Keyboard: the layout picker and reordering.
const catalog = {
  source: "fallback" as const,
  path: null,
  layouts: [
    {
      name: "de",
      description: "German",
      shortDescription: "de",
      languages: ["ger"],
      variants: [
        {
          name: "nodeadkeys",
          description: "German (no dead keys)",
          shortDescription: "de",
          languages: [],
        },
      ],
    },
    {
      name: "us",
      description: "English (US)",
      shortDescription: "en",
      languages: ["eng"],
      variants: [],
    },
  ],
};
assert.equal(layoutChoices(catalog).length, 3);
assert.deepEqual(
  filterLayouts(layoutChoices(catalog), "german dead").map((choice) => choice.variant),
  ["nodeadkeys"],
);
assert.equal(layoutName(catalog, { layout: "de", variant: "nodeadkeys" }), "German (no dead keys)");
assert.equal(layoutName(null, { layout: "fr", variant: "bepo" }), "fr(bepo)");
assert.deepEqual(moved(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
assert.deepEqual(moved(["a", "b"], 0, -1), ["a", "b"]);

// ---- About: the system facts parsers.
assert.deepEqual(
  parseOsRelease('NAME=NixOS\nVERSION_ID="25.05"\nPRETTY_NAME="NixOS 25.05 (Warbler)"\n'),
  {
    NAME: "NixOS",
    VERSION_ID: "25.05",
    PRETTY_NAME: "NixOS 25.05 (Warbler)",
  },
);
assert.equal(
  passwdName("joshua:x:1000:100:Joshua Steele,,,:/home/joshua:/bin/sh\n", "joshua"),
  "Joshua Steele",
);
assert.equal(passwdName("joshua:x:1000:100::/home/joshua:/bin/sh\n", "joshua"), "joshua");
assert.equal(isAdministrator("wheel:x:1:joshua,root\n", "joshua"), true);
assert.equal(isAdministrator("wheel:x:1:root\nusers:x:100:joshua\n", "joshua"), false);
assert.equal(generationFromLink("system-42-link"), 42);
assert.equal(generationFromLink("/nix/store/abc"), null);

console.log("[settings/model] registry, deep links, search, journal and page wording passed");
