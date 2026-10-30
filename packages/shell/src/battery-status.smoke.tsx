import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
/** Synthetic read-only UPower scenes and real public Window/shell lifecycles; no device calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import React from "react";
import { createShellRoot, renderShell, rasterize, type SceneNode } from "@moire/react-host";
import {
  FocusScope,
  Surface,
  WidgetThemeProvider,
  Window,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindowOpts,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { THEME_FAMILIES, applyThemeFamily, getTheme, setTheme } from "@moire/theme";
import { BATTERY_UNAVAILABLE, type DesktopBattery } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import { batteryPresentation } from "./battery-presentation";
import { QuickSettingsContent, measureQuickSettingsContent } from "./QuickSettingsContent";
import { QuickSettingsDetails, measureQuickSettingsDetails } from "./QuickSettingsDetails";
import { QuickSettings, type DesktopControlActions } from "./QuickSettings";
import { Panel, panelStatusGeometry } from "./Panel";
import { createShell } from "./controller";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-battery-ui-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "config");
process.env.XDG_DATA_HOME = path.join(home, "data");
const previews = process.env.MOIRE_BATTERY_PREVIEW_DIR;
if (previews) fs.mkdirSync(previews, { recursive: true });
const base: Extract<DesktopBattery, { kind: "ready" }> = {
  kind: "ready",
  source: "battery",
  percentage: 61,
  chargeState: "discharging",
  onBattery: true,
  warningLevel: "none",
  timeToEmptySeconds: 5400,
  timeToFullSeconds: 9999,
};
const variants: Record<string, DesktopBattery> = {
  discharging: base,
  charged: { ...base, percentage: 100, chargeState: "fully-charged", onBattery: false },
  charging: {
    ...base,
    percentage: 73,
    chargeState: "charging",
    onBattery: false,
    timeToFullSeconds: 4800,
  },
  pending: { ...base, chargeState: "pending-charge" },
  ups: { ...base, source: "ups", percentage: 12, warningLevel: "critical" },
  empty: { ...base, percentage: 0, chargeState: "empty", warningLevel: "action" },
  unknown: {
    ...base,
    chargeState: "discharging",
    timeToEmptySeconds: null,
    warningLevel: "unknown",
  },
  loading: { kind: "loading", supported: true, message: "Reading UPower" },
  error: { kind: "error", supported: true, message: "UPower read failed" },
  unavailable: BATTERY_UNAVAILABLE,
};
const state = (battery: DesktopBattery): DesktopStatusState => ({
  kind: "ready",
  owner: ":1.46",
  snapshot: {
    revision: 1,
    bluetooth: BLUETOOTH_UNAVAILABLE,
    battery,
    wifi: WIFI_UNAVAILABLE,
    network: [],
    audio: { kind: "unavailable", message: "Audio unavailable" },
    capabilities: {
      audio: false,
      battery: batteryPresentation(battery).supported,
      bluetooth: false,
      brightness: false,
      power: false,
      notifications: false,
    },
    updating: false,
    doNotDisturb: false,
    notificationsAvailable: false,
    notices: [],
  },
});
const all = (n: SceneNode): SceneNode[] => [n, ...n.children.flatMap(all)];
function png(pixels: Uint8Array, w: number, h: number) {
  const crc = (b: Buffer) => {
    let v = 0xffffffff;
    for (const x of b) {
      v ^= x;
      for (let i = 0; i < 8; i++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0);
    }
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (s: string, b: Buffer) => {
    const t = Buffer.from(s),
      len = Buffer.alloc(4),
      c = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    c.writeUInt32BE(crc(Buffer.concat([t, b])));
    return Buffer.concat([len, t, b, c]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = (y * w + x) * 4,
        b = y * (w * 4 + 1) + 1 + x * 4;
      raw[b] = pixels[a + 2]!;
      raw[b + 1] = pixels[a + 1]!;
      raw[b + 2] = pixels[a]!;
      raw[b + 3] = pixels[a + 3]!;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
class Retained extends HeadlessPlatform {
  override createWindow(opts: PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), { presentScene: () => false });
  }
}
const noop = () => {};
await installUiFonts();
let frames = 0,
  workflows = 0;
try {
  assert.equal(batteryPresentation(base).estimate, "About 1 hr 30 min remaining");
  assert.equal(batteryPresentation(variants.charging).estimate, "About 1 hr 20 min to full");
  assert.equal(
    batteryPresentation(variants.pending).estimate,
    null,
    "pending states cannot use either irrelevant estimate",
  );
  assert.equal(batteryPresentation(variants.unknown).estimate, "Time remaining unknown");
  assert.equal(
    batteryPresentation(variants.empty).percentage,
    0,
    "a real empty battery remains supported",
  );
  assert.equal(batteryPresentation(undefined, true).percentage, null);
  for (const family of THEME_FAMILIES)
    for (const scheme of ["light", "dark"] as const)
      for (const scale of [1, 1.5])
        for (const width of [320, 520]) {
          setUiScaleFactor(scale);
          const theme = createPersonalizedWidgetTheme(
            discoverPersonalization("linux", {
              themeFamily: family,
              colorScheme: scheme,
              reducedMotion: true,
            }),
          );
          for (const [name, battery] of [
            ...Object.entries(variants),
            ["outer-loss", undefined] as const,
          ])
            for (const view of ["main", "battery"] as const) {
              const observation: DesktopStatusState = battery
                ? state(battery)
                : { kind: "unavailable", message: "Status service unavailable" };
              const cachedCapabilities =
                state(base).kind === "ready"
                  ? {
                      audio: false,
                      battery: true,
                      brightness: false,
                      bluetooth: false,
                      power: false,
                      notifications: false,
                    }
                  : undefined;
              const props = {
                width,
                state: observation,
                cachedCapabilities,
                onBatteryOpen: noop,
                onBack: noop,
              };
              const height = Math.ceil(
                view === "main"
                  ? measureQuickSettingsContent(props, theme).height
                  : measureQuickSettingsDetails({ ...props, view }, theme).height,
              );
              const root = createShellRoot();
              renderShell(
                root,
                <WidgetThemeProvider theme={theme}>
                  <Surface width={width} height={height}>
                    {view === "main" ? (
                      <QuickSettingsContent {...props} />
                    ) : (
                      <QuickSettingsDetails {...props} view={view} />
                    )}
                  </Surface>
                </WidgetThemeProvider>,
              );
              const frame = rasterize(root.container, width, height);
              const texts = all(root.container)
                .filter((n) => n.kind === "text")
                .map((n) => n.text ?? "")
                .join(" ");
              const presentation = batteryPresentation(battery, true);
              if (presentation.available) {
                assert(texts.includes(`${presentation.percentage}%`));
                if (view === "battery") {
                  assert(texts.includes(presentation.charge));
                  if (presentation.estimate) assert(texts.includes(presentation.estimate));
                  if (presentation.warning) assert(texts.includes(presentation.warning));
                }
              } else
                assert(
                  !/\d+%|External power|On battery power|remaining|to full/.test(texts),
                  "loss/transient never retains numeric/source/estimate facts",
                );
              if (view === "main")
                assert.equal(
                  frame.hits.some((h) => h.focusable && h.focusId === "quick:battery"),
                  presentation.supported,
                );
              for (const hit of frame.hits.filter((h) => h.focusable))
                assert(hit.y >= 0 && hit.y + hit.height <= height + 1, "natural action extent");
              if (
                previews &&
                family === "moire" &&
                scheme === "dark" &&
                view === "battery" &&
                ["charging", "ups", "error", "outer-loss"].includes(name) &&
                ((width === 320 && scale === 1.5) || (width === 520 && scale === 1))
              )
                fs.writeFileSync(
                  path.join(previews, `${name}-${width}-${scale}.png`),
                  png(frame.pixels, width, height),
                );
              renderShell(root, null);
              frames++;
            }
        }
  // Existing shared artwork and geometry follow support, not a stale forced capability.
  setUiScaleFactor(1);
  for (const battery of Object.values(variants)) {
    const root = createShellRoot();
    const props = { screenW: 1000, screenH: 800, status: state(battery), onControlsClick: noop };
    renderShell(root, <Panel {...props} />);
    // Status glyphs live in the system-controls button; brand and Apps artwork are elsewhere.
    const controls = all(root.container).find((n) => n.focusId === "panel:controls");
    assert.ok(controls?.parent);
    const images = all(controls.parent).filter((n) => n.kind === "image");
    assert.equal(
      images.length,
      batteryPresentation(battery).supported ? 2 : 1,
      "unsupported battery must not leave a panel symbol",
    );
    const bounds = panelStatusGeometry(props).controls;
    assert(bounds && bounds.width >= 36);
    renderShell(root, null);
  }
  for (const retained of [false, true])
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", {
          themeFamily: "moire",
          colorScheme: "dark",
          reducedMotion: true,
        }),
      );
      const width = 360,
        height = 900;
      let observation = state(base),
        view: "main" | "battery" = "main",
        opens = 0,
        backs = 0;
      const props = () => ({
        width,
        state: observation,
        cachedCapabilities: {
          audio: false,
          battery: true,
          bluetooth: false,
          brightness: false,
          power: false,
          notifications: false,
        },
        onBatteryOpen() {
          opens++;
          view = "battery";
        },
        onBack() {
          backs++;
          view = "main";
        },
      });
      const tree = () => (
        <WidgetThemeProvider theme={theme}>
          <Surface width={width} height={height}>
            <FocusScope id="battery-fixture">
              {view === "main" ? (
                <QuickSettingsContent {...props()} />
              ) : (
                <QuickSettingsDetails {...props()} view="battery" />
              )}
            </FocusScope>
          </Surface>
        </WidgetThemeProvider>
      );
      const scene = () => {
        const r = createShellRoot();
        renderShell(r, tree());
        const frame = rasterize(r.container, width, height),
          text = all(r.container)
            .filter((n) => n.kind === "text")
            .map((n) => n.text ?? "")
            .join(" ");
        renderShell(r, null);
        return { frame, text };
      };
      const backend = retained ? new Retained() : new HeadlessPlatform();
      await backend.connect();
      const win = new Window({ title: "Synthetic battery view", width, height });
      try {
        win.setContent(tree);
        win.mount(backend);
        win.tick();
        const native = backend.getWindows()[0];
        assert(native);
        let time = 0;
        const key = (code: number, key: string) => {
          for (const type of ["down", "up"] as const)
            native.injectKey({
              type,
              code,
              key,
              modifiers: { ctrl: false, shift: false, alt: false, meta: false },
              timeMs: ++time,
            });
          win.tick();
        };
        key(28, "Enter");
        assert.equal(opens, 1, "keyboard opens actual focused battery row");
        assert.equal(view, "battery");
        const beforeCharging = native.lastFrame?.slice();
        assert(beforeCharging);
        observation = state(variants.charging);
        win.requestRedraw();
        win.tick();
        assert(scene().text.includes("73%"));
        assert(native.lastFrame);
        assert.notDeepEqual(
          native.lastFrame,
          beforeCharging,
          "actual Window repaint changes the displayed battery frame",
        );
        observation = { kind: "error", message: "Service owner lost" };
        win.requestRedraw();
        win.tick();
        assert(!scene().text.includes("73%"));
        assert(scene().text.includes("Battery unavailable"));
        const back = scene().frame.hits.find(
          (h) => h.focusId === "quick:details:back" && h.focusable,
        );
        assert(back);
        for (const type of ["down", "up"] as const)
          native.injectPointer({
            type,
            x: back.x + back.width / 2,
            y: back.y + back.height / 2,
            button: "left",
            timeMs: ++time,
          });
        win.tick();
        assert.equal(backs, 1);
        observation = state(base);
        win.requestRedraw();
        win.tick();
        const row = scene().frame.hits.find((h) => h.focusId === "quick:battery" && h.focusable);
        assert(row);
        for (const type of ["down", "up"] as const)
          native.injectPointer({
            type,
            x: row.x + row.width / 2,
            y: row.y + row.height / 2,
            button: "left",
            timeMs: ++time,
          });
        win.tick();
        assert.equal(opens, 2);
        key(28, "Enter");
        assert.equal(backs, 2, "details keyboard Back remains reachable");
        assert(native.lastFrame);
        workflows++;
      } finally {
        win.destroy();
        await backend.disconnect();
      }
    }
  // Actual createShell controlled route and live status change while the panel stays open.
  setUiScaleFactor(1);
  setTheme(applyThemeFamily(getTheme(), "moire", true));
  let observation = state(base);
  const actions: DesktopControlActions = {
    async refreshWifi() {},
    async refreshBluetooth() {},
    async setBluetoothConnected() {},
    async connectWifi() {},
    async cancelWifi() {},
    async setVolume() {},
    async setMute() {},
    async setDoNotDisturb() {},
    async dismiss() {},
    async invokeAction() {},
    async dismissMany() {
      return { dismissed: 0, skipped: 0 };
    },
  };
  const shell = createShell(() => ({}), noop, actions),
    width = 1000,
    height = 900;
  shell.setPrimaryOutput({ x: 0, y: 0, width, height });
  shell.setDesktopStatus(observation);
  let view: "main" | "battery" = "main";
  const frame = () => {
    const r = createShellRoot();
    const anchor = panelStatusGeometry({
      screenW: width,
      screenH: height,
      clock: "12:00",
      onControlsClick: noop,
      onNotificationsClick: noop,
      status: observation,
    }).controls;
    assert(anchor);
    renderShell(
      r,
      <QuickSettings
        open
        screenW={width}
        screenH={height}
        anchor={anchor}
        state={observation}
        view={view}
        onViewChange={noop}
        onDismiss={noop}
        scrollY={0}
        onScroll={noop}
      />,
    );
    const f = rasterize(r.container, width, height);
    renderShell(r, null);
    return f;
  };
  const click = (x: number, y: number) => {
    for (const value of [1, 0]) {
      assert(shell.onPointerButton({ x, y, button: 0x110, value, timeMs: 1 }));
      assert(shell.chromeRaster(width, height));
    }
  };
  const anchor = panelStatusGeometry({
    screenW: width,
    screenH: height,
    clock: "12:00",
    onControlsClick: noop,
    onNotificationsClick: noop,
    status: observation,
  }).controls;
  assert(anchor);
  assert(shell.chromeRaster(width, height));
  click(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  const row = frame().hits.find((h) => h.focusId === "quick:battery" && h.focusable);
  assert(row);
  click(row.x + row.width / 2, row.y + row.height / 2);
  view = "battery";
  const before = shell.chromeRaster(width, height)?.pixels.slice();
  assert(before);
  observation = state(variants.ups);
  shell.setDesktopStatus(observation);
  const after = shell.chromeRaster(width, height)?.pixels;
  assert(after);
  assert.notDeepEqual(before, after, "actual shell updates open battery details");
  observation = { kind: "unavailable", message: "Owner disappeared" };
  shell.setDesktopStatus(observation);
  assert(shell.chromeRaster(width, height));
  const back = frame().hits.find((h) => h.focusId === "quick:details:back" && h.focusable);
  assert(back);
  click(back.x + back.width / 2, back.y + back.height / 2);
  view = "main";
  assert(shell.onKey({ code: 1, value: 1 }));
  shell.onKey({ code: 1, value: 0 });
  assert(shell.chromeRaster(width, height));
  workflows++;
  console.log(
    `Battery UI: ${frames} measured five-family scenes; ${workflows} public Window/createShell workflows; read-only synthetic observations only`,
  );
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
}
