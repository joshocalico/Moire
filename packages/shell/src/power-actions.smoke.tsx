/**
 * Quick Settings › Power with a fake power session: the Suspend, Restart and Shut down rows follow
 * the capabilities (the same source as the lock screen's menu), Suspend runs at once and closes
 * the popup, Restart and Shut down count down with Cancel, and Escape, Cancel, leaving the view,
 * closing the popup and locking all drop a pending action. No logind or native claim: the
 * compositor's lock-session smoke covers the lock-before-suspend path behind `run("suspend")`.
 */
import assert from "node:assert/strict";
import React from "react";
import { createShellRoot, renderShell, rasterize, type HitRegion } from "@moire/react-host";
import { installUiFonts, tickAllMotions } from "@moire/ui";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import { createShell, type ShellPowerControls } from "./controller";
import { QuickSettings } from "./QuickSettings";
import { panelStatusGeometry } from "./Panel";
import type {
  QuickSettingsPower,
  QuickSettingsPowerAction,
  QuickSettingsPowerConfirm,
} from "./QuickSettingsDetails";

await installUiFonts();
const state: DesktopStatusState = { kind: "unavailable", message: "No management service" };
const width = 1280,
  height = 800;
const noop = () => {};
const KEY_ESC = 1;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let cases = 0;

const anchor = panelStatusGeometry({
  screenW: width,
  screenH: height,
  clock: "12:00",
  status: state,
  onControlsClick: noop,
  onNotificationsClick: noop,
}).controls;
assert(anchor);

/** Where the popup's controls are, from the same component the shell renders. */
function layout(
  view: "main" | "power",
  sessionPower: QuickSettingsPower,
  powerConfirm?: QuickSettingsPowerConfirm,
): HitRegion[] {
  const root = createShellRoot();
  renderShell(
    root,
    <QuickSettings
      open
      screenW={width}
      screenH={height}
      anchor={anchor!}
      state={state}
      view={view}
      onViewChange={noop}
      scrollY={0}
      onScroll={noop}
      onDismiss={noop}
      onLock={noop}
      onLogout={noop}
      onSettings={noop}
      sessionPower={sessionPower}
      onPowerAction={noop}
      powerConfirm={powerConfirm}
      onPowerConfirm={noop}
      onPowerCancel={noop}
    />,
  );
  tickAllMotions(1);
  return rasterize(root.container, width, height).hits;
}
const ids = (hits: HitRegion[]) =>
  hits.map((hit) => hit.focusId).filter((id): id is string => !!id?.startsWith("quick:"));

// Rows by capability: each row only when logind allows it; the rest are named as unavailable.
{
  const all = ids(layout("power", { suspend: true, reboot: true, powerOff: true }));
  for (const id of [
    "quick:lock",
    "quick:logout",
    "quick:suspend",
    "quick:reboot",
    "quick:power-off",
  ])
    assert.ok(all.includes(id), `${id} with every capability`);
  const suspendOnly = ids(layout("power", { suspend: true, reboot: false, powerOff: false }));
  assert.ok(suspendOnly.includes("quick:suspend"));
  assert.ok(!suspendOnly.includes("quick:reboot") && !suspendOnly.includes("quick:power-off"));
  const none = ids(layout("power", { suspend: false, reboot: false, powerOff: false }));
  assert.ok(!none.some((id) => ["quick:suspend", "quick:reboot", "quick:power-off"].includes(id)));
  assert.ok(none.includes("quick:lock"), "session actions stay");
  // The countdown replaces the rows with Cancel and the action itself.
  const confirm = ids(
    layout(
      "power",
      { suspend: true, reboot: true, powerOff: true },
      { action: "reboot", secondsLeft: 10 },
    ),
  );
  assert.ok(confirm.includes("quick:power:cancel") && confirm.includes("quick:power:confirm"));
  assert.ok(!confirm.includes("quick:reboot"), "no second request while one is pending");
  cases++;
}

// The real controller with a fake power session.
const calls: QuickSettingsPowerAction[] = [];
let capabilities: QuickSettingsPower = { suspend: true, reboot: true, powerOff: true };
const power: ShellPowerControls = {
  capabilities: () => capabilities,
  run: (action) => calls.push(action),
  confirmSeconds: 1,
};
const shell = createShell(() => ({}), noop, undefined, undefined, noop, noop, power);
shell.setPrimaryOutput({ x: 0, y: 0, width, height });
shell.setDesktopStatus(state);
const paint = () => {
  tickAllMotions(1);
  assert(shell.chromeRaster(width, height));
};
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
const find = (hits: HitRegion[], id: string) => {
  const hit = hits.find((candidate) => candidate.focusId === id);
  assert(hit, `${id} is on screen`);
  return hit;
};
/** Open Quick Settings (closed before) and go to its power view. */
const openPower = () => {
  paint();
  click(anchor);
  click(find(layout("main", capabilities), "quick:power"));
};
const powerRow = (id: string) => find(layout("power", capabilities), id);
const confirmButton = (action: "reboot" | "power-off", id: string) =>
  find(layout("power", capabilities, { action, secondsLeft: 1 }), id);

// Suspend: runs at once, through the session (which locks first), and closes the popup.
openPower();
click(powerRow("quick:suspend"));
assert.deepEqual(calls, ["suspend"]);
cases++;

// Restart: asks first; Cancel drops it and nothing runs, even after the countdown would end.
openPower();
click(powerRow("quick:reboot"));
assert.deepEqual(calls, ["suspend"], "restart waits for its countdown");
click(confirmButton("reboot", "quick:power:cancel"));
await delay(1300);
paint();
assert.deepEqual(calls, ["suspend"], "cancelled restart never runs");
cases++;

// Restart now: the confirm button runs it at once (Cancel left the power view open).
click(powerRow("quick:reboot"));
click(confirmButton("reboot", "quick:power:confirm"));
assert.deepEqual(calls, ["suspend", "reboot"]);
cases++;

// Shut down: the countdown runs out and it goes ahead.
openPower();
click(powerRow("quick:power-off"));
await delay(1300);
paint();
assert.deepEqual(calls, ["suspend", "reboot", "power-off"], "shut down after the countdown");
cases++;

// Escape cancels the countdown and keeps the popup.
openPower();
click(powerRow("quick:power-off"));
shell.onKey({ code: KEY_ESC, value: 1 });
shell.onKey({ code: KEY_ESC, value: 0 });
await delay(1300);
paint();
assert.equal(calls.length, 3, "escape cancelled the shut down");
cases++;

// Locking (or the popup closing) drops a pending action (Escape left the power view open).
click(powerRow("quick:reboot"));
shell.setLocked(true);
await delay(1300);
assert.equal(calls.length, 3, "locking cancelled the restart");
shell.setLocked(false);
cases++;

// A capability that went away between showing the row and pressing it is not run.
openPower();
click(powerRow("quick:power-off"));
capabilities = { suspend: true, reboot: true, powerOff: false };
await delay(1300);
paint();
assert.equal(calls.length, 3, "power off no longer allowed");
cases++;

console.log(`[power-actions] ${cases} cases PASS`);
process.exit(0);
