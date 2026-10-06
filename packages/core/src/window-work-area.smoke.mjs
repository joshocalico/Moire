/* eslint-disable import/no-relative-parent-imports -- Integration fixture imports shipped Screenshot app source; production library imports use package APIs. */
import assert from "node:assert/strict";
import React from "react";
import { PNG } from "pngjs";
import { ScreenshotApp } from "../../../apps/bundled/screenshot/src/main";
import { screenshotLayout } from "../../../apps/bundled/screenshot/src/layout";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wlDisplay, wlRegistry, wlCompositor, xdgToplevel } from "@moire/protocol/generated";
import { applyThemeFamily, loadTheme, setTheme, panelGeometry } from "@moire/theme";
import { Window, installUiFonts, setUiScaleFactor } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { desktopWorkArea, fitWindowToWorkArea } from "./window-work-area";
const captureRoot = process.env.MOIRE_TEST_WORK_AREA_CAPTURE_DIRECTORY;
if (captureRoot) fs.mkdirSync(captureRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-work-area-"));
const old = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, ClientSession } = await import("./server");
// Load actual production methods; typed source is checked before deterministic generation.
const theme = applyThemeFamily(loadTheme(), "moire", true);
setTheme(theme);
class Connection extends EventEmitter {
  peerPid = null;
  sent = [];
  send(bytes) {
    this.sent.push(Buffer.from(bytes));
    return true;
  }
  close() {
    this.emit("close");
  }
  request(message) {
    this.emit("message", message);
  }
  configured() {
    return this.sent
      .filter((bytes) => bytes.readUInt32LE(0) === 20)
      .map((bytes) => xdgToplevel.events.configure.decode(bytes))
      .at(-1);
  }
}
function output(width, height) {
  const noNative = () => {
    throw new Error("No native/device operation allowed");
  };
  return {
    availability: "unavailable",
    fd: -1,
    ownsFd: false,
    cardPath: "fixture",
    connectorId: 1,
    connectorName: "fixture",
    identity: { id: "fixture", make: "fixture", model: "fixture", serial: "" },
    physicalWidthMm: 0,
    physicalHeightMm: 0,
    crtcId: 0,
    width,
    height,
    pitch: width * 4,
    handle: 0,
    fbId: 0,
    size: width * height * 4,
    map: null,
    modePtr: null,
    modes: [],
    currentModeId: "fixture",
    connectorsPtr: null,
    setCrtc: noNative,
    drmIoctl: noNative,
    addFb: noNative,
    rmFb: noNative,
    getConnector: noNative,
    freeConnector: noNative,
    getEncoder: noNative,
    freeEncoder: noNative,
    getResources: noNative,
    freeResources: noNative,
    modeData: new Map(),
  };
}
function makeServer(width, height, scale120, ssd, geometryPadding, radius) {
  const server = new CompositorServer(fixture);
  // Actual existing portable output-owner seam; no KMS start.
  Object.assign(server, {
    outputs: [{ kms: output(width, height), x: 0, y: 0, scale120, primary: true }],
  });
  server.setShell({
    paint() {},
    onKey() {
      return false;
    },
    onPointerButton() {
      return false;
    },
    isLauncherOpen() {
      return false;
    },
  });
  setTheme({ ...theme, tokens: { ...theme.tokens, radiusWindow: radius } });
  const conn = new Connection(),
    session = new ClientSession(server, conn, 1);
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  conn.request(wlRegistry.requests.bind.encode(2, 1, "wl_compositor", 4, 3));
  conn.request(wlCompositor.requests.createSurface.encode(3, 10));
  const surface = session.surfaceById(10);
  assert(surface);
  Object.assign(surface, {
    role: "toplevel",
    mapped: true,
    decoration: ssd ? "server" : "client",
    xdgToplevelId: 20,
    xdgSurfaceId: 21,
    x: 156,
    y: 144,
    width: 980 + geometryPadding * 2,
    height: 720 + geometryPadding * 2,
    geomX: geometryPadding,
    geomY: geometryPadding,
    geomW: 980,
    geomH: 720,
  });
  return { server, conn, session, surface };
}
function captureClientFrame(pixels, width, height, name) {
  if (!captureRoot) return;
  const png = new PNG({ width, height });
  for (let index = 0; index < pixels.length; index += 4) {
    png.data[index] = pixels[index + 2];
    png.data[index + 1] = pixels[index + 1];
    png.data[index + 2] = pixels[index];
    png.data[index + 3] = pixels[index + 3];
  }
  fs.writeFileSync(path.join(captureRoot, name + ".png"), PNG.sync.write(png));
}
function applyConfigure(f) {
  const event = f.conn.configured();
  if (event) {
    if (event.width > 0) f.surface.geomW = event.width;
    if (event.height > 0) f.surface.geomH = event.height;
  }
  return event;
}
function assertVisible(f, width, height) {
  const frame = f.server.frameBox(f.surface),
    top = panelGeometry(width, height, theme).y;
  assert(frame.x >= 0 && frame.y >= 0);
  assert(frame.x + frame.w <= width);
  assert(
    frame.y + frame.h <= top,
    `interactive frame bottom${frame.y + frame.h} exceeds actual panel top${top}`,
  );
}
let cases = 0,
  publicWindows = 0;
try {
  // Exact production first-map order, including the subsequent focus configure.
  const initial = makeServer(1280, 800, 120, true, 0, 14);
  initial.server.fitToplevelToOutput(initial.session, 10);
  const fitConfigure = initial.conn.configured();
  assert(fitConfigure);
  assert.equal(fitConfigure.height, 704);
  initial.server.registerToplevel(initial.session, 10);
  initial.server.focusClient(initial.session, 10);
  const focusConfigure = initial.conn.configured();
  assert(focusConfigure);
  assert.equal(focusConfigure.height, 704, "focus must not restore pre-fit720 allocation");
  const otherConnection = new Connection(),
    otherSession = new ClientSession(initial.server, otherConnection, 2);
  otherConnection.request(wlDisplay.requests.getRegistry.encode(1, 2));
  otherConnection.request(wlRegistry.requests.bind.encode(2, 1, "wl_compositor", 4, 3));
  otherConnection.request(wlCompositor.requests.createSurface.encode(3, 10));
  const otherSurface = otherSession.surfaceById(10);
  assert(otherSurface);
  Object.assign(otherSurface, {
    role: "toplevel",
    mapped: true,
    width: 300,
    height: 200,
    geomW: 300,
    geomH: 200,
    xdgToplevelId: 20,
    xdgSurfaceId: 21,
  });
  initial.server.focusClient(otherSession, 10);
  assert.equal(
    initial.conn.configured()?.height,
    704,
    "deactivation before resize acknowledgement must retain work-area allocation",
  );
  applyConfigure(initial);
  assertVisible(initial, 1280, 800);
  cases++;
  // Exact known shared baseline failure, separate from unassigned native Screenshot overlap.
  const max = makeServer(1280, 800, 120, false, 0, 14);
  max.server.toggleMaximized(max.session, 10, true);
  applyConfigure(max);
  assertVisible(max, 1280, 800);
  cases++;
  await installUiFonts();
  for (const physical of [
    { width: 1280, height: 800 },
    { width: 1020, height: 700 },
    { width: 700, height: 700 },
  ])
    for (const scale120 of [120, 180])
      for (const uiScale of [1, 1.5])
        for (const ssd of [false, true])
          for (const radius of [0, 14]) {
            const width = Math.round((physical.width * 120) / scale120),
              height = Math.round((physical.height * 120) / scale120);
            const f = makeServer(
              physical.width,
              physical.height,
              scale120,
              ssd,
              ssd ? 0 : 12,
              radius,
            );
            f.surface.geomW = Math.round(980 * uiScale);
            f.surface.geomH = Math.round(720 * uiScale);
            f.server.fitToplevelToOutput(f.session, 10);
            applyConfigure(f);
            assertVisible(f, width, height);
            cases++;
            const before = f.server.frameBox(f.surface);
            f.server.toggleMaximized(f.session, 10, true);
            applyConfigure(f);
            assertVisible(f, width, height);
            cases++;
            assert.equal(f.server.frameBox(f.surface).y, 0);
            assert.equal(f.server.frameBox(f.surface).x, 0);
            if (radius === 14 && scale120 === 120) {
              const backend = new HeadlessPlatform();
              await backend.connect();
              const win = new Window({
                title: "Work-area footer allocation",
                width: 980,
                height: 720,
                decorated: ssd,
              });
              setUiScaleFactor(uiScale);
              win.setContent((size) =>
                React.createElement(ScreenshotApp, {
                  ...size,
                  window: win,
                  initialOutput: "private-fixture.png",
                }),
              );
              win.mount(backend);
              await Promise.resolve();
              win.tick();
              const native = backend.getWindows()[0];
              assert(native);
              native.emitConfigure(before.w, before.h - (ssd ? theme.tokens.titlebarHeight : 0));
              win.tick();
              assert(native.lastFrame);
              const defaultLayout = screenshotLayout(
                { width: win.getWidth(), height: win.getHeight() },
                uiScale,
              );
              assert(defaultLayout.footer.y + defaultLayout.footer.height <= win.getHeight());
              assert(
                before.y + win.getHeight() + (ssd ? theme.tokens.titlebarHeight : 0) <=
                  panelGeometry(width, height, theme).y,
              );
              captureClientFrame(
                native.lastFrame,
                win.getWidth(),
                win.getHeight(),
                `screenshot-default-${physical.width}x${physical.height}-ui${uiScale}-${ssd ? "ssd" : "csd"}`,
              );
              native.emitConfigure(f.surface.geomW, f.surface.geomH);
              win.tick();
              assert.equal(
                win.getHeight() +
                  f.server.frameBox(f.surface).y +
                  (ssd ? theme.tokens.titlebarHeight : 0) <=
                  panelGeometry(width, height, theme).y,
                true,
              );
              assert.equal(native.lastFrame?.length, win.getWidth() * win.getHeight() * 4);
              const layout = screenshotLayout(
                { width: win.getWidth(), height: win.getHeight() },
                uiScale,
              );
              assert(
                layout.footer.y + layout.footer.height <= win.getHeight(),
                "actual Screenshot footer allocation fits configured client viewport",
              );
              assert(native.lastFrame);
              captureClientFrame(
                native.lastFrame,
                win.getWidth(),
                win.getHeight(),
                `screenshot-${physical.width}x${physical.height}-ui${uiScale}-${ssd ? "ssd" : "csd"}`,
              );
              publicWindows++;
              win.destroy();
              backend.disconnect();
            }
            f.server.toggleFullscreen(f.session, 10, true);
            applyConfigure(f);
            assert.equal(f.surface.geomW, width);
            assert.equal(f.surface.geomH, height);
            assert.equal(f.server.usesSsd(f.surface), false);
            cases++;
            f.server.toggleFullscreen(f.session, 10, false);
            applyConfigure(f);
            assertVisible(f, width, height);
            cases++;
            f.server.toggleMaximized(f.session, 10, false);
            applyConfigure(f);
            assert.equal(f.server.frameBox(f.surface).x, before.x);
            assert.equal(f.server.frameBox(f.surface).y, before.y);
            f.server.fitToplevelToOutput(f.session, 10);
            applyConfigure(f);
            assertVisible(f, width, height);
            cases++;
          }
  const area = desktopWorkArea({ x: 100, y: 200, width: 700, height: 700 }, 844);
  const largeMin = fitWindowToWorkArea({
    area,
    preferred: { width: 980, height: 720 },
    position: { x: 500, y: 500 },
    chromeHeight: 40,
    minimum: { width: 900, height: 800 },
    maximum: { width: 0, height: 0 },
  });
  assert.equal(largeMin.status, "minimum-exceeds-work-area");
  assert.equal(largeMin.width, 900);
  assert.equal(largeMin.height, 800);
  assert.equal(largeMin.x, 100);
  assert.equal(largeMin.y, 200);
  cases++;
  const tiny = fitWindowToWorkArea({
    area,
    preferred: { width: 8, height: 8 },
    position: { x: 100, y: 200 },
    chromeHeight: 0,
    minimum: { width: 1, height: 1 },
    maximum: { width: 8, height: 8 },
  });
  assert.equal(tiny.width, 8);
  assert.equal(tiny.height, 8);
  assert.equal(tiny.status, "fits");
  const maxLimit = fitWindowToWorkArea({
    area,
    preferred: { width: 980, height: 720 },
    position: { x: 500, y: 500 },
    chromeHeight: 40,
    minimum: { width: 200, height: 100 },
    maximum: { width: 500, height: 400 },
  });
  assert.equal(maxLimit.width, 500);
  assert.equal(maxLimit.height, 400);
  assert.equal(maxLimit.status, "fits");
  cases++;
  const changed = makeServer(1280, 800, 120, false, 12, 14);
  changed.server.registerToplevel(changed.session, 10);
  changed.server.toggleMaximized(changed.session, 10, true);
  applyConfigure(changed);
  changed.server.beginDisplayLayoutChange([
    { id: "fixture", x: 0, y: 0, scale120: 180, primary: true },
  ]);
  applyConfigure(changed);
  assertVisible(changed, 853, 533);
  changed.server.stop();
  cases++;
  const secondary = makeServer(1280, 800, 120, false, 12, 14);
  const primaryOutput = output(1280, 800),
    secondaryOutput = output(1280, 800);
  secondaryOutput.connectorId = 2;
  secondaryOutput.identity = { ...secondaryOutput.identity, id: "second" };
  Object.assign(secondary.server, {
    outputs: [
      { kms: primaryOutput, x: 0, y: 0, scale120: 120, primary: true },
      { kms: secondaryOutput, x: 1280, y: 300, scale120: 120, primary: false },
    ],
  });
  secondary.surface.x = 1500;
  secondary.surface.y = 500;
  secondary.server.fitToplevelToOutput(secondary.session, 10);
  applyConfigure(secondary);
  const secondaryFrame = secondary.server.frameBox(secondary.surface);
  assert(
    secondaryFrame.x >= 1280 &&
      secondaryFrame.y >= 300 &&
      secondaryFrame.x + secondaryFrame.w <= 2560 &&
      secondaryFrame.y + secondaryFrame.h <= 1100,
  );
  secondary.server.toggleMaximized(secondary.session, 10, true);
  applyConfigure(secondary);
  assert.equal(
    secondary.server.frameBox(secondary.surface).h,
    800,
    "secondary output without panel uses whole height",
  );
  cases++;
  const noShell = makeServer(1280, 800, 120, false, 0, 14);
  noShell.server.setShell(null);
  noShell.server.toggleMaximized(noShell.session, 10, true);
  applyConfigure(noShell);
  assert.equal(noShell.server.frameBox(noShell.surface).h, 800);
  cases++;
  setUiScaleFactor(1);
  console.log(
    JSON.stringify({
      status: "passed",
      cases,
      publicWindows,
      deviceCalls: 0,
      fixedRegression: "first-map focus preserves work-area allocation",
      scope:
        "Actual compositor geometry/configure methods with portable output fixture plus public Window footer allocation; no native output",
    }),
  );
} finally {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}
