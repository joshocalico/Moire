/**
 * Quick Settings' details views each end in a "… settings…" row that closes the popup and starts
 * Settings at that view's page (`MOIRE_SETTINGS_PAGE=page#setting`); the main view's Settings
 * row opens Settings without a page. Driven through the real shell controller.
 * `MOIRE_SHELL_CAPTURE_DIR` also saves each details view.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { PNG } from "pngjs";
import { createShellRoot, renderShell, rasterize, type HitRegion } from "@moire/react-host";
import { installUiFonts, tickAllMotions } from "@moire/ui";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
import { createShell } from "./controller";
import { QuickSettings } from "./QuickSettings";
import { DETAILS_SETTINGS_LINKS, type QuickSettingsDetailsView } from "./QuickSettingsDetails";
import { panelStatusGeometry } from "./Panel";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-qs-links-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "config");
process.env.XDG_DATA_HOME = path.join(home, "data");

const state: DesktopStatusState = {
  kind: "ready",
  owner: ":1.9",
  snapshot: {
    revision: 1,
    updating: false,
    audio: { kind: "ready", volume: 0.5, muted: false, name: "Speakers" },
    network: [{ name: "eth0", transport: "wired", addresses: ["192.0.2.3"] }],
    wifi: WIFI_UNAVAILABLE,
    bluetooth: BLUETOOTH_UNAVAILABLE,
    battery: {
      kind: "ready",
      source: "battery",
      percentage: 61,
      chargeState: "discharging",
      onBattery: true,
      warningLevel: "none",
      timeToEmptySeconds: 5400,
      timeToFullSeconds: null,
    },
    capabilities: {
      audio: true,
      brightness: false,
      battery: true,
      bluetooth: true,
      power: false,
      notifications: false,
    },
    notificationsAvailable: false,
    doNotDisturb: false,
    notices: [],
  },
};

/** The main-view control that opens each details view. */
const OPENERS: Record<QuickSettingsDetailsView, string> = {
  network: "quick:network",
  audio: "quick:audio",
  bluetooth: "quick:bluetooth",
  battery: "quick:battery",
  power: "quick:power",
};

async function main() {
  await installUiFonts();
  const width = 1280,
    height = 800;
  const noop = () => {};
  const spawned: string[] = [];
  const shell = createShell(
    ({ exec }: { exec: string }) => {
      spawned.push(exec);
      return {};
    },
    noop,
    undefined,
    undefined,
    noop,
  );
  shell.setPrimaryOutput({ x: 0, y: 0, width, height });
  shell.setDesktopStatus(state);
  const anchor = panelStatusGeometry({
    screenW: width,
    screenH: height,
    clock: "12:00",
    status: state,
    onControlsClick: noop,
    onNotificationsClick: noop,
  }).controls;
  assert(anchor);
  const paint = () => assert(shell.chromeRaster(width, height));
  const click = (hit: Pick<HitRegion, "x" | "y" | "width" | "height">) => {
    for (const value of [1, 0]) {
      shell.onPointerButton({
        x: hit.x + hit.width / 2,
        y: hit.y + hit.height / 2,
        button: 0x110,
        value,
        timeMs: 1,
      });
      paint();
    }
  };
  // The same popup, rendered on its own, says where the shell's controls are.
  const root = createShellRoot();
  const find = (view: "main" | QuickSettingsDetailsView, focusId: string) => {
    renderShell(
      root,
      <QuickSettings
        open
        screenW={width}
        screenH={height}
        anchor={anchor}
        state={state}
        view={view}
        onViewChange={noop}
        scrollY={0}
        onScroll={noop}
        onDismiss={noop}
        onLogout={noop}
        onSettings={noop}
        onBluetoothChange={noop}
        onBluetoothRefresh={noop}
      />,
    );
    const raster = rasterize(root.container, width, height);
    const captures = process.env.MOIRE_SHELL_CAPTURE_DIR;
    if (captures && view !== "main") {
      // Settle the popup's entrance before the picture.
      tickAllMotions(1);
      const settled = rasterize(root.container, width, height).pixels;
      const image = new PNG({ width, height });
      // The raster is BGRA.
      for (let i = 0; i < raster.pixels.length; i += 4) {
        image.data[i] = settled[i + 2]!;
        image.data[i + 1] = settled[i + 1]!;
        image.data[i + 2] = settled[i]!;
        image.data[i + 3] = 255;
      }
      fs.mkdirSync(captures, { recursive: true });
      fs.writeFileSync(path.join(captures, `qs-${view}-settings-link.png`), PNG.sync.write(image));
    }
    const hit = raster.hits.find((candidate) => candidate.focusId === focusId);
    assert(hit, `${view} has ${focusId}`);
    return hit;
  };

  paint();
  for (const [view, { link, label }] of Object.entries(DETAILS_SETTINGS_LINKS) as [
    QuickSettingsDetailsView,
    { link: string; label: string },
  ][]) {
    click(anchor);
    click(find("main", OPENERS[view]));
    const before = spawned.length;
    click(find(view, "quick:details:settings"));
    assert.equal(spawned.length, before + 1, `${label} starts Settings once`);
    const exec = spawned.at(-1)!;
    assert(
      exec.startsWith(`MOIRE_SETTINGS_PAGE='${link}' `) &&
        /moire-settings|@moire\/settings/.test(exec),
      `${label} opens Settings at ${link}: ${exec}`,
    );
    // The popup closed: clicking where the row was reaches the desktop, not Settings again.
    click(find(view, "quick:details:settings"));
    assert.equal(spawned.length, before + 1, `${label} closes Quick Settings`);
  }

  // The main view's Settings row opens Settings without a page.
  click(anchor);
  click(find("main", "quick:settings"));
  assert(!spawned.at(-1)!.includes("MOIRE_SETTINGS_PAGE"), "main Settings row has no deep link");
  console.log(
    `Quick Settings links: ${Object.keys(DETAILS_SETTINGS_LINKS).length} details views open Settings at their page`,
  );
  fs.rmSync(home, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
