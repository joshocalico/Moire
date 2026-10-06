import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
/** Actual createShell owner-scoped Wi-Fi draft and dispatch lifecycle, synthetic inputs only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { createShellRoot, renderShell, rasterize } from "@moire/react-host";
import { installUiFonts, setUiScaleFactor } from "@moire/ui";
import { getTheme, applyThemeFamily, setTheme } from "@moire/theme";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import type { DesktopWifi, WifiAccessPoint } from "@moire/system-management/network-status";
import { createShell } from "./controller";
import { QuickSettings, type DesktopControlActions } from "./QuickSettings";
import { panelStatusGeometry } from "./Panel";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-network-controller-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "config");
process.env.XDG_DATA_HOME = path.join(home, "data");
await installUiFonts();
setUiScaleFactor(1);
setTheme(applyThemeFamily(getTheme(), "moire", true));
const ap: WifiAccessPoint = {
  id: "/fixture/ap",
  ssid: "Observed fixture network",
  strength: 80,
  security: "wpa-psk",
  connected: false,
};
const ready: Extract<DesktopWifi, { kind: "ready" }> = {
  kind: "ready",
  policy: "interactive",
  enabled: true,
  hardwareEnabled: true,
  canConnect: true,
  canScan: true,
  connectivity: "none",
  connection: { kind: "none" },
  accessPoints: [ap],
  operation: { kind: "idle" },
};
let observation: DesktopStatusState = {
  kind: "ready",
  owner: ":1.40",
  snapshot: {
    revision: 1,
    wifi: ready,
    bluetooth: BLUETOOTH_UNAVAILABLE,
    battery: BATTERY_UNAVAILABLE,
    audio: { kind: "unavailable", message: "Unavailable" },
    network: [],
    capabilities: {
      audio: false,
      brightness: false,
      battery: false,
      bluetooth: false,
      power: false,
      notifications: false,
    },
    doNotDisturb: false,
    notificationsAvailable: false,
    updating: false,
    notices: [],
  },
};
let calls = 0,
  submittedId = "",
  submittedCorrect = false,
  submittedLength = 0;
const actions: DesktopControlActions = {
  async refreshWifi() {},
  async refreshBluetooth() {},
  async setBluetoothConnected() {},
  async connectWifi(id, password) {
    calls++;
    submittedId = id;
    submittedLength = password.length;
    submittedCorrect = password === "synthetic8";
  },
  async cancelWifi() {},
  async setVolume() {},
  async setMute() {},
  async setDoNotDisturb() {},
  async dismiss() {},
  async dismissMany() {
    return { dismissed: 0, skipped: 0 };
  },
  async invokeAction() {},
};
const shell = createShell(
  () => ({}),
  () => {},
  actions,
);
const width = 1000,
  height = 900;
shell.setPrimaryOutput({ x: 0, y: 0, width, height });
shell.setDesktopStatus(observation);
let selection: WifiAccessPoint | undefined,
  view: "main" | "network" = "main";
const scene = createShellRoot();
const noop = () => {};
const anchor = () =>
  panelStatusGeometry({
    screenW: width,
    screenH: height,
    clock: "12:00",
    onControlsClick: noop,
    onNotificationsClick: noop,
    status: observation,
  }).controls;
const paint = () => {
  const frame = shell.chromeRaster(width, height);
  assert(frame);
  return frame;
};
const hits = () => {
  const a = anchor();
  assert(a);
  renderShell(
    scene,
    <QuickSettings
      open
      screenW={width}
      screenH={height}
      anchor={a}
      state={observation}
      view={view}
      wifiSelection={selection}
      wifiPassword=""
      onViewChange={noop}
      onDismiss={noop}
      scrollY={0}
      onScroll={noop}
      onWifiSelect={noop}
      onWifiPasswordChange={noop}
      onWifiConnect={noop}
      onWifiCancel={noop}
      onWifiRefresh={noop}
      onWifiSelectionCancel={noop}
    />,
  );
  return rasterize(scene.container, width, height).hits;
};
const click = (id: string) => {
  const h = hits().find(
    (h) =>
      h.focusable && (id === "field" ? h.focusId?.startsWith("text-field:") : h.focusId === id),
  );
  assert(h, `fixture geometry for ${id}`);
  const x = h.x + h.width / 2,
    y = h.y + h.height / 2;
  for (const value of [1, 0]) {
    assert(shell.onPointerButton({ x, y, button: 0x110, value, timeMs: 1 }));
    paint();
  }
};
const key = (code: number) => {
  for (const value of [1, 0]) {
    shell.onKey({ code, value });
    paint();
  }
};
const open = () => {
  // Normalize through the actual Escape route, whether the previous case is open or closed.
  shell.onKey({ code: 1, value: 1 });
  shell.onKey({ code: 1, value: 0 });
  paint();
  const a = anchor();
  assert(a);
  for (const value of [1, 0])
    shell.onPointerButton({
      x: a.x + a.width / 2,
      y: a.y + a.height / 2,
      button: 0x110,
      value,
      timeMs: 1,
    });
  paint();
  view = "main";
  click("quick:network");
  view = "network";
  click(`quick:wifi:ap:${ap.id}`);
  selection = ap;
  click("field");
};
const type = () => {
  for (const code of [31, 21, 49, 20, 35, 18, 20, 23, 46, 9]) key(code);
};
const clearObservation = (
  owner = ":1.40",
  accessPoints: readonly WifiAccessPoint[] = [ap],
  operation: Extract<DesktopWifi, { kind: "ready" }>["operation"] = { kind: "idle" },
) => {
  assert(observation.kind === "ready");
  observation = {
    ...observation,
    owner,
    snapshot: {
      ...observation.snapshot,
      revision: observation.snapshot.revision + 1,
      wifi: { ...ready, accessPoints, operation },
    },
  };
  shell.setDesktopStatus(observation);
  paint();
};
try {
  open();
  type();
  key(28);
  await new Promise<void>((r) => setImmediate(r));
  paint();
  console.log(
    JSON.stringify({ calls, idExpected: submittedId === ap.id, submittedCorrect, submittedLength }),
  );
  assert(
    calls === 1 && submittedId === ap.id && submittedCorrect,
    "connect dispatches exact synthetic identity/value once",
  );
  key(28);
  assert(calls === 1, "submitted draft was cleared, no repeated secret submission");
  selection = undefined;
  // Separate draft disposal paths. Reopen main after each closed/returned view.
  for (const reason of ["back", "close", "owner", "withdrawal"]) {
    if (reason !== "back") {
      key(1);
    }
    view = "main";
    selection = undefined;
    clearObservation();
    open();
    type();
    if (reason === "back") {
      click("quick:details:back");
      selection = undefined;
    } else if (reason === "close") {
      key(1);
      view = "main";
    } else if (reason === "owner") {
      clearObservation(":1.41");
      selection = undefined;
    } else {
      clearObservation(":1.40", []);
      selection = undefined;
    }
    key(28);
    assert(calls === 1, `${reason} cannot submit previous secret`);
  }
  clearObservation();
  key(1);
  open();
  type();
  clearObservation(":1.40", [ap], { kind: "connecting", ssid: ap.ssid, cancellable: false });
  key(28);
  assert(calls === 1, "pending operation cannot submit twice");
  console.log(
    "Network controller: connect once; submitted/back/close/owner-loss/AP-withdrawal/pending draft guards passed",
  );
} finally {
  renderShell(scene, null);
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
}
