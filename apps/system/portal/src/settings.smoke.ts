/** Settings portal: Moire's appearance as org.freedesktop.appearance, with live SettingChanged. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type MoireSettings } from "@moire/prefs";
import { startPortalFixture, until } from "./testing";

const SETTINGS = "org.freedesktop.impl.portal.Settings";
const APPEARANCE = "org.freedesktop.appearance";
const fixture = await startPortalFixture("settings");
const write = (patch: Partial<MoireSettings>) => {
  const directory = path.join(fixture.configHome, "moire");
  fs.mkdirSync(directory, { recursive: true });
  // Replace by rename, as Settings does.
  const temporary = path.join(directory, "settings.json.tmp");
  fs.writeFileSync(temporary, JSON.stringify({ ...DEFAULT_SETTINGS, ...patch }));
  fs.renameSync(temporary, path.join(directory, "settings.json"));
};
const value = (reply: { body?: unknown[] }) => (reply.body?.[0] as { value: unknown }).value;
try {
  write({ dark: true, accent: null, reducedMotion: false });
  await fixture.start();
  const changes = await fixture.signals(SETTINGS, "SettingChanged");
  const read = (key: string) => fixture.call(SETTINGS, "Read", "ss", [APPEARANCE, key]);

  assert.equal(value(await read("color-scheme")), 1, "dark is prefer-dark");
  assert.equal(value(await read("contrast")), 0);
  assert.equal(value(await read("reduced-motion")), 0);
  // No accent chosen: the Moire style's own (#8a7aff).
  const accent = value(await read("accent-color")) as number[];
  assert.deepEqual(
    accent.map((channel) => Math.round(channel * 255)),
    [0x8a, 0x7a, 0xff],
  );
  await assert.rejects(read("no-such-key"), /NotFound/);
  await assert.rejects(
    fixture.call(SETTINGS, "Read", "ss", ["org.gnome.desktop.interface", "color-scheme"]),
    /NotFound/,
  );

  const all = await fixture.call(SETTINGS, "ReadAll", "as", [[]]);
  assert.equal(all.signature, "a{sa{sv}}");
  const namespaces = all.body?.[0] as Record<string, Record<string, { value: unknown }>>;
  assert.deepEqual(Object.keys(namespaces), [APPEARANCE]);
  assert.deepEqual(Object.keys(namespaces[APPEARANCE]!).sort(), [
    "accent-color",
    "color-scheme",
    "contrast",
    "reduced-motion",
  ]);
  const matched = await fixture.call(SETTINGS, "ReadAll", "as", [["org.freedesktop.*"]]);
  assert.ok((matched.body?.[0] as Record<string, unknown>)[APPEARANCE]);
  const other = await fixture.call(SETTINGS, "ReadAll", "as", [["org.gnome.*"]]);
  assert.deepEqual(other.body?.[0], {});

  // A change made in Settings reaches clients without being asked for.
  write({ dark: false, accent: "#ff8000", reducedMotion: true });
  const changed = (key: string) => changes.find((body) => body[1] === key);
  await until(
    () => !!changed("color-scheme") && !!changed("accent-color") && !!changed("reduced-motion"),
    "SettingChanged for each changed key",
  );
  assert.equal(changed("color-scheme")![0], APPEARANCE);
  assert.deepEqual(changed("color-scheme")![2], { signature: "u", value: 2 });
  assert.deepEqual(changed("reduced-motion")![2], { signature: "u", value: 1 });
  const orange = changed("accent-color")![2] as { signature: string; value: number[] };
  assert.equal(orange.signature, "(ddd)");
  assert.deepEqual(
    orange.value.map((channel) => Math.round(channel * 255)),
    [0xff, 0x80, 0x00],
  );
  assert.equal(changed("contrast"), undefined, "unchanged keys stay quiet");
  assert.equal(value(await read("color-scheme")), 2);

  const stranger = await fixture.connect();
  await assert.rejects(
    fixture.call(SETTINGS, "Read", "ss", [APPEARANCE, "color-scheme"], stranger),
    /AccessDenied/,
  );
  console.log("[portal/settings] ok");
} finally {
  await fixture.close();
}
