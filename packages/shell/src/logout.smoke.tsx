import assert from "node:assert/strict";
import React from "react";
import { createShellRoot, renderShell, rasterize, type HitRegion } from "@moire/react-host";
import { installUiFonts } from "@moire/ui";
import { createShell } from "./controller";
import { QuickSettings } from "./QuickSettings";
import { panelStatusGeometry } from "./Panel";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";

async function main() {
  await installUiFonts();
  const state: DesktopStatusState = { kind: "unavailable", message: "No management service" };
  const width = 1280,
    height = 800;
  let logouts = 0;
  const noop = () => {};
  const shell = createShell(
    () => ({}),
    noop,
    undefined,
    undefined,
    () => {
      logouts++;
    },
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
  const paint = () => {
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
  const root = createShellRoot();
  const hits = (view: "main" | "power") => {
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
      />,
    );
    return rasterize(root.container, width, height).hits;
  };
  paint();
  click(anchor);
  const power = hits("main").find((hit) => hit.focusId === "quick:power");
  assert(power, "session actions must be available without management power capabilities");
  click(power);
  assert.equal(logouts, 0);
  const logout = hits("power").find((hit) => hit.focusId === "quick:logout");
  assert(logout);
  click(logout);
  assert.equal(logouts, 1, "actual shell controller dispatches exactly one logout on release");
  console.log(
    "Logout: actual shell popup → session actions → logout dispatch passed; no native/PAM claim.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
