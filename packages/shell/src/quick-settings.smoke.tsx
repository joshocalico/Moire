import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
/** Actual shell/controller interactions with callback-only backend fixtures; no native/audio claim. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import React from "react";
import {
  createShellRoot,
  rasterize,
  renderShell,
  Rect,
  type HitRegion,
  type SceneNode,
  measureTextBounds,
} from "@moire/react-host";
import { installUiFonts, Window, setUiScaleFactor } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { getTheme, setTheme, applyThemeFamily, THEME_FAMILIES } from "@moire/theme";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import {
  QuickSettings,
  QUICK_SETTINGS_SCOPE,
  NOTIFICATIONS_SCOPE,
  type DesktopControlActions,
} from "./QuickSettings";
import { NotificationsTray } from "./NotificationsTray";
import { panelStatusGeometry } from "./Panel";
import { createShell, type ShellScrollObservation } from "./controller";
import { networkPresentation } from "./network-presentation";
import { TaskOverflow, TASK_WINDOWS_SCOPE } from "./TaskOverflow";
import type { TaskWindowInfo, TaskWindowAction } from "./ssd";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-popup-"));
const keys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_DATA_DIRS",
  "MOIRE_SHELL_START_OPEN",
];
const saved = keys.map((key) => [key, process.env[key]] as const);
const baseTheme = getTheme();
const now = Date.now();
function ready(
  revision = 7,
  volume = 0.4,
  owner = ":1.4",
): Extract<DesktopStatusState, { kind: "ready" }> {
  return {
    kind: "ready",
    owner,
    snapshot: {
      revision,
      updating: false,
      audio: { kind: "ready", volume, muted: false, name: "Fixture observed output" },
      network: [{ name: "eth0", transport: "wired", addresses: ["192.0.2.3"] }],
      wifi: WIFI_UNAVAILABLE,
      bluetooth: BLUETOOTH_UNAVAILABLE,
      battery: BATTERY_UNAVAILABLE,
      capabilities: {
        audio: true,
        brightness: false,
        battery: false,
        bluetooth: false,
        power: false,
        notifications: true,
      },
      notificationsAvailable: true,
      doNotDisturb: false,
      notices: Array.from({ length: 9 }, (_, index) => ({
        id: index + 1,
        revision: 2,
        appName: "Editor",
        summary: `Fixture notice ${index + 1}`,
        body:
          `Fixture complete body ${index + 1}. ` + "Long body data remains reachable. ".repeat(12),
        createdAt: now - index * 60_000,
        closedAt: index === 8 ? now - 5000 : null,
        closed: index === 8,
        actions: [{ key: "view", label: "View fixture" }],
      })),
    },
  };
}
function clock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const inert = () => {};
function png(width: number, height: number, bgra: Uint8Array): Buffer {
  const rgba = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4,
        target = y * (width * 4 + 1) + 1 + x * 4;
      rgba[target] = bgra[source + 2]!;
      rgba[target + 1] = bgra[source + 1]!;
      rgba[target + 2] = bgra[source]!;
      rgba[target + 3] = bgra[source + 3]!;
    }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffff_ffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
    const header = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0);
    return Buffer.concat([header, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rgba)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
let frames = 0,
  cases = 0;
try {
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, "config");
  process.env.XDG_DATA_HOME = path.join(home, "data");
  process.env.XDG_DATA_DIRS = path.join(home, "system");
  delete process.env.MOIRE_SHELL_START_OPEN;
  await installUiFonts();
  // Wrapper allocation, scope separation and alternate views across all current families.
  for (const family of THEME_FAMILIES)
    for (const dark of [false, true])
      for (const scale of [1, 1.5]) {
        setTheme(applyThemeFamily(baseTheme, family, dark));
        setUiScaleFactor(scale);
        const width = 360 * scale,
          height = 640 * scale,
          observed = ready();
        const anchors = panelStatusGeometry({
          screenW: width,
          screenH: height,
          clock: clock(),
          onControlsClick: inert,
          onNotificationsClick: inert,
          notificationCount: 8,
          status: observed,
          onTaskOverflowClick: inert,
          taskCount: 0,
        });
        assert(anchors.controls && anchors.notifications);
        assert(
          anchors.controls.x + anchors.controls.width <= anchors.notifications.x,
          "bell is a separate panel control",
        );
        const scene = createShellRoot();
        const render = (
          view: "main" | "audio" | "network" | "bluetooth" | "power",
          state: DesktopStatusState = observed,
        ) => {
          renderShell(
            scene,
            <QuickSettings
              open
              screenW={width}
              screenH={height}
              anchor={anchors.controls!}
              state={state}
              busy={false}
              error=""
              view={view}
              onViewChange={inert}
              scrollY={0}
              onScroll={inert}
              onDismiss={inert}
              onVolumeChange={inert}
              onVolumeStart={inert}
              onVolumeCommit={inert}
              onMuteChange={inert}
              onDoNotDisturbChange={inert}
              onSettings={inert}
            />,
          );
          frames++;
          return rasterize(scene.container, width, height);
        };
        const main = render("main");
        assert(
          main.hits.some(
            (hit) =>
              hit.focusScopeId === QUICK_SETTINGS_SCOPE && hit.focusId?.startsWith("slider:"),
          ),
        );
        assert(
          !main.hits.some((hit) => hit.focusScopeId === NOTIFICATIONS_SCOPE),
          "status popup has no embedded notification tray",
        );
        for (const view of ["audio", "network", "bluetooth", "power"] as const) {
          const detail = render(view);
          assert(detail.hits.some((hit) => hit.focusId === "quick:details:back"));
          assert(
            !detail.hits.some((hit) => hit.focusId === "quick:network"),
            "disclosure replaces main content rather than stacking another popup",
          );
        }
        const unavailable = render("main", {
          kind: "unavailable",
          message: "Fixture disconnected",
        });
        assert(
          !unavailable.hits.some(
            (hit) =>
              hit.focusable &&
              (hit.focusId?.startsWith("slider:") ||
                hit.focusId === "quick:mute" ||
                hit.focusId?.startsWith("toggle:")),
          ),
        );
        renderShell(
          scene,
          <NotificationsTray
            open
            screenW={width}
            screenH={height}
            anchor={anchors.notifications}
            state={observed}
            now={now}
            view="active"
            onViewChange={inert}
            scrollY={0}
            onScroll={inert}
            busy={false}
            error=""
            onClearAll={inert}
            onDismiss={inert}
            onInvokeAction={inert}
            onClose={inert}
          />,
        );
        const tray = rasterize(scene.container, width, height);
        frames++;
        assert(tray.hits.some((hit) => hit.focusScopeId === NOTIFICATIONS_SCOPE));
        assert(!tray.hits.some((hit) => hit.focusScopeId === QUICK_SETTINGS_SCOPE));
        const history = tray.hits.find((hit) => hit.focusId === "notifications:history")!;
        assert(
          history.pointerClip &&
            history.y >= history.pointerClip.y &&
            history.y + history.height <= history.pointerClip.y + history.pointerClip.height + 0.01,
          "history stays inside measured popup",
        );
        renderShell(scene, null);
      }
  // Production shell owns focus, slider gestures, pending intents, popup routing and client continuity.
  for (const [width, height] of [
    [1024, 768],
    [360, 640],
  ] as const) {
    setTheme(applyThemeFamily(baseTheme, "moire", true));
    setUiScaleFactor(1);
    let observed: DesktopStatusState = ready();
    let cachedCapabilities = ready().snapshot.capabilities;
    let cachedNetworkPresentation = networkPresentation(ready().snapshot.network);
    let tasks: TaskWindowInfo[] = [];
    const taskActions: TaskWindowAction[] = [];
    let sequence = 7;
    const calls: unknown[][] = [];
    let volumeFailure = false;
    const actions: DesktopControlActions = {
      async refreshWifi() {},
      async refreshBluetooth() {},
      async setBluetoothConnected() {},
      async connectWifi() {},
      async cancelWifi() {},
      async setVolume(value) {
        calls.push(["volume", value]);
        if (volumeFailure) throw new Error("Fixture volume outcome unknown");
      },
      async setMute(value) {
        calls.push(["mute", value]);
      },
      async setDoNotDisturb(value) {
        calls.push(["dnd", value]);
      },
      async dismiss(id, revision) {
        calls.push(["dismiss", id, revision]);
      },
      async dismissMany(pairs) {
        calls.push(["clear", pairs]);
        return { dismissed: pairs.length, skipped: 0 };
      },
      async invokeAction(id, key, revision) {
        calls.push(["action", id, key, revision]);
      },
    };
    const spawned: unknown[] = [];
    const scrollObservations: ShellScrollObservation[] = [];
    const shell = createShell(
      (args) => {
        spawned.push(args);
        return {};
      },
      (action) => taskActions.push(action),
      actions,
      (event) => scrollObservations.push(event),
    );
    function observe(next: DesktopStatusState) {
      if (next.kind === "ready") {
        cachedCapabilities = next.snapshot.capabilities;
        cachedNetworkPresentation = networkPresentation(next.snapshot.network);
      }
      shell.setDesktopStatus(next);
    }
    shell.setPrimaryOutput({ x: 0, y: 0, width, height });
    observe(observed);
    const backend = new HeadlessPlatform();
    await backend.connect();
    const client = new Window({ title: "Fixture client keys", width: 240, height: 100 });
    const delivered: Array<[number, string]> = [];
    client.setContent(
      <Rect
        width={240}
        height={100}
        focusable
        autoFocus
        focusId="client:keys"
        onKeyDown={(event) => delivered.push([event.code, "down"])}
        onKeyUp={(event) => delivered.push([event.code, "up"])}
      />,
    );
    client.mount(backend);
    await Promise.resolve();
    client.tick();
    const native = backend.getWindows()[0]!;
    const paint = () => {
      const frame = shell.chromeRaster(width, height);
      assert(frame);
      frames++;
      return frame.pixels.slice();
    };
    const capture = (name: string) => {
      const directory = process.env.MOIRE_SHELL_CAPTURE_DIR;
      if (!directory) return;
      fs.mkdirSync(directory, { recursive: true });
      const basename = path.join(directory, `${width}-${height}-${name}`),
        pixels = paint();
      fs.writeFileSync(`${basename}.png`, png(width, height, pixels));
      fs.writeFileSync(
        `${basename}.json`,
        JSON.stringify({
          width,
          height,
          format: "RGBA PNG converted from actual returned BGRA",
          scope:
            "Actual createShell CPU overlay + panel; fixture backend callbacks; no native compositor/backdrop/service claim",
        }),
      );
    };
    const edge = (code: number, value: number) => {
      const consumed = shell.onKey({ code, value });
      if (!consumed) {
        native.injectKey({
          type: value === 0 ? "up" : "down",
          code,
          modifiers: { ctrl: false, shift: false, alt: false, meta: false },
          timeMs: 0,
        });
        client.tick();
      }
      paint();
      return consumed;
    };
    const key = (code: number) => {
      edge(code, 1);
      edge(code, 0);
    };
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      paint();
    };
    const readback = (volume = 0.4) => {
      observed = ready(++sequence, volume);
      observe(observed);
      paint();
    };
    const anchors = () =>
      panelStatusGeometry({
        screenW: width,
        screenH: height,
        clock: clock(),
        onControlsClick: inert,
        onNotificationsClick: inert,
        status: observed,
        cachedCapabilities,
        taskCount: tasks.length,
        onTaskOverflowClick: inert,
        notificationCount:
          observed.kind === "ready"
            ? observed.snapshot.notices.filter((item) => !item.closed).length
            : 0,
      });
    const pointer = (
      hit: Pick<HitRegion, "x" | "y" | "width" | "height">,
      value: number,
      fraction = 0.5,
    ) => {
      const x = hit.x + hit.width * fraction,
        y = hit.y + hit.height / 2;
      const consumed = shell.onPointerButton({ x, y, button: 0x110, value, timeMs: 1 });
      paint();
      return consumed;
    };
    const click = (hit: Pick<HitRegion, "x" | "y" | "width" | "height">) => {
      pointer(hit, 1);
      pointer(hit, 0);
    };
    const controlsOpen = () => click(anchors().controls!);
    const bellOpen = () => click(anchors().notifications!);
    const scene = createShellRoot();
    function controlsHits(view: "main" | "audio" | "network" = "main", scrollY = 0) {
      renderShell(
        scene,
        <QuickSettings
          open
          screenW={width}
          screenH={height}
          anchor={anchors().controls!}
          state={observed}
          cachedCapabilities={cachedCapabilities}
          cachedNetworkPresentation={cachedNetworkPresentation}
          busy={false}
          error=""
          view={view}
          onViewChange={inert}
          scrollY={scrollY}
          onScroll={inert}
          onDismiss={inert}
          onVolumeChange={inert}
          onVolumeStart={inert}
          onVolumeCommit={inert}
          onMuteChange={inert}
          onDoNotDisturbChange={inert}
          onSettings={inert}
        />,
      );
      return rasterize(scene.container, width, height).hits;
    }
    const descendants = (node: SceneNode): SceneNode[] => [
      node,
      ...node.children.flatMap(descendants),
    ];
    function assertActualLabel(
      text: string,
      viewport?: Pick<HitRegion, "x" | "y" | "width" | "height">,
    ) {
      const node = descendants(scene.container).find(
        (node) => node.kind === "text" && node.text === text,
      );
      assert(node, `actual production wrapper contains ${text}`);
      let x = 0,
        y = 0;
      for (let current: SceneNode | null = node; current; current = current.parent) {
        x +=
          current.x +
          (typeof current.translateX === "number"
            ? current.translateX
            : (current.translateX?.get() ?? 0));
        y +=
          current.y +
          (typeof current.translateY === "number"
            ? current.translateY
            : (current.translateY?.get() ?? 0));
      }
      const bounds = measureTextBounds(text, {
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        scale: node.scale,
      });
      const expected = rasterize(scene.container, width, height).pixels;
      const actual = paint();
      assert(x >= 0 && y >= 0 && x + bounds.width <= width && y + bounds.height <= height);
      if (viewport)
        assert(
          x >= viewport.x &&
            y >= viewport.y &&
            x + bounds.width <= viewport.x + viewport.width &&
            y + bounds.height <= viewport.y + viewport.height,
          "full label bounds are inside body viewport",
        );
      const glyphColors = new Set<number>();
      const packed = new Uint32Array(actual.buffer, actual.byteOffset, actual.byteLength / 4);
      for (let row = Math.ceil(y); row < Math.floor(y + bounds.height); row++) {
        const start = (row * width + Math.ceil(x)) * 4;
        const end = (row * width + Math.floor(x + bounds.width)) * 4;
        for (let col = Math.ceil(x); col < Math.floor(x + bounds.width); col++)
          glyphColors.add(packed[row * width + col]!);
        assert.deepEqual(
          actual.slice(start, end),
          expected.slice(start, end),
          `${text} actual shell pixels match production wrapper`,
        );
      }
      assert(glyphColors.size > 2, `${text} has visible glyph ink, not only background`);
    }
    function notificationHits(view: "active" | "history" = "active", scrollY = 0) {
      renderShell(
        scene,
        <NotificationsTray
          open
          screenW={width}
          screenH={height}
          anchor={anchors().notifications!}
          state={observed}
          now={now}
          view={view}
          onViewChange={inert}
          scrollY={scrollY}
          onScroll={inert}
          busy={false}
          error=""
          onClearAll={inert}
          onDismiss={inert}
          onInvokeAction={inert}
          onClose={inert}
        />,
      );
      return rasterize(scene.container, width, height).hits;
    }
    edge(29, 1);
    controlsOpen();
    capture("main");
    click(controlsHits().find((hit) => hit.focusId === "quick:audio")!);
    capture("audio");
    key(28);
    assert.equal(edge(29, 0), false, "client's pre-popup modifier release is forwarded");
    assert.deepEqual(
      delivered.filter((item) => item[0] === 29),
      [
        [29, "down"],
        [29, "up"],
      ],
    );
    const first = paint();
    key(15);
    assert.notDeepEqual(paint(), first, "actual shell Tab paints focus");
    key(15); // network -> mute -> generated volume slider
    let before = calls.length;
    edge(103, 1);
    assert.equal(calls.length, before, "ArrowUp down only edits requested thumb");
    edge(103, 0);
    await flush();
    assert.equal(calls[before]?.[0], "volume");
    assert.equal(typeof calls[before]?.[1], "number");
    assert(Math.abs(Number(calls[before]![1]) - 0.41) < 1e-12);
    assert.equal(calls.length, before + 1, "press/release commits exactly once");
    readback(0.41);
    key(108);
    await flush();
    assert.deepEqual(calls[before + 1], ["volume", 0.4]);
    readback();
    // Explicit traversal during a pending write blurs the remembered slider,
    // even while the disabled widget contributes no HitRegion.
    before = calls.length;
    key(103);
    key(15);
    assert.equal(calls.length, before + 1);
    await flush();
    readback(0.41);
    const plainHits = controlsHits();
    const plainFrame = rasterize(scene.container, width, height);
    const unfocusedSlider = plainHits.find(
      (hit) => hit.focusable && hit.focusId?.startsWith("slider:"),
    )!;
    const afterPendingTab = paint();
    for (
      let y = Math.ceil(unfocusedSlider.y);
      y < Math.floor(unfocusedSlider.y + unfocusedSlider.height);
      y++
    ) {
      const start = (y * width + Math.ceil(unfocusedSlider.x)) * 4;
      const end = (y * width + Math.floor(unfocusedSlider.x + unfocusedSlider.width)) * 4;
      assert.deepEqual(
        afterPendingTab.slice(start, end),
        plainFrame.pixels.slice(start, end),
        "Tab away during pending leaves no stale slider focus pixels after readback",
      );
    }
    const afterPending = paint();
    key(28);
    assert.notDeepEqual(paint(), afterPending, "pending Tab selected active Network disclosure");
    key(28);
    // Pointer moves never write; one final release commits the last thumb position.
    const slider = controlsHits().find(
      (hit) => hit.focusable && hit.focusId?.startsWith("slider:"),
    )!;
    assert(slider && slider.pointerClip);
    before = calls.length;
    pointer(slider, 1, 0.2);
    for (const fraction of [0.3, 0.5, 0.7, 0.8]) {
      shell.onPointerMotion?.({
        x: slider.x + slider.width * fraction,
        y: slider.y + slider.height / 2,
      });
      paint();
    }
    assert.equal(calls.length, before, "many pointer moves make no backend call");
    pointer(slider, 0, 0.8);
    await flush();
    assert.equal(calls.length, before + 1);
    assert.equal(calls[before]?.[0], "volume");
    readback();
    // Boundary changes revoke an in-flight draft instead of redirecting it to a new backend.
    for (const reason of ["owner", "revision", "updating", "unavailable"] as const) {
      observed = ready(++sequence);
      observe(observed);
      paint();
      const current = controlsHits().find(
        (hit) => hit.focusable && hit.focusId?.startsWith("slider:"),
      )!;
      before = calls.length;
      pointer(current, 1, 0.3);
      const next = ready(++sequence);
      const replacement: DesktopStatusState =
        reason === "owner"
          ? ready(sequence, 0.2, ":1.9")
          : reason === "unavailable"
            ? { kind: "unavailable", message: "Fixture owner vanished" }
            : reason === "updating"
              ? { ...next, snapshot: { ...next.snapshot, updating: true } }
              : next;
      observed = replacement;
      observe(replacement);
      paint();
      pointer(current, 0, 0.8);
      await flush();
      assert.equal(
        calls.length,
        before,
        "changed owner/revision/unavailable/updating cannot commit stale draft",
      );
    }
    readback();
    key(1);
    assert.equal(edge(30, 1), false, "Escape restores client key delivery");
    edge(30, 0);
    // Main -> one disclosure -> Back uses the real controller, not another overlay stack.
    controlsOpen();
    const mainPixels = paint();
    key(28);
    const networkPixels = paint();
    assert.notDeepEqual(networkPixels, mainPixels);
    key(28);
    assert.notDeepEqual(paint(), networkPixels, "Back replaces the same popup content");
    // Missing actual audio readback cannot retire an unknown volume outcome,
    // but it must not disable an idle service's unrelated policy/notifications.
    const failureSlider = controlsHits().find(
      (hit) => hit.focusable && hit.focusId?.startsWith("slider:"),
    )!;
    volumeFailure = true;
    before = calls.length;
    pointer(failureSlider, 1, 0.7);
    pointer(failureSlider, 0, 0.7);
    await flush();
    volumeFailure = false;
    assert.equal(calls.length, before + 1);
    const idle = ready(++sequence);
    observed = {
      ...idle,
      snapshot: {
        ...idle.snapshot,
        audio: { kind: "unavailable", message: "Fixture audio readback unavailable" },
      },
    };
    observe(observed);
    paint();
    capture("audio-unknown");
    const volumeCalls = calls.filter((call) => call[0] === "volume").length;
    key(103);
    key(108);
    await flush();
    assert.equal(
      calls.filter((call) => call[0] === "volume").length,
      volumeCalls,
      "unknown volume does not retry without actual audio readback",
    );
    // Generated Toggle remains part of the same focus scope; reveal occurs before activation.
    const focusable = controlsHits().filter(
      (hit) => hit.focusable && hit.focusScopeId === QUICK_SETTINGS_SCOPE,
    );
    const toggleIndex = focusable.findIndex((hit) => hit.focusId?.startsWith("toggle:"));
    assert(toggleIndex >= 0);
    for (let index = 0; index <= toggleIndex; index++) key(15); // remembered disabled slider -> first active -> DND
    before = calls.length;
    key(57);
    await flush();
    assert.deepEqual(calls[before], ["dnd", true]);
    const toggledPixels = paint();
    edge(42, 1);
    key(15);
    edge(42, 0);
    assert.notDeepEqual(
      paint(),
      toggledPixels,
      "ShiftTab moves scope focus and reveals clipped controls",
    );
    // Switching from the system tray to the independent bell gives only notification actions.
    bellOpen();
    capture("active-tray");
    before = calls.length;
    key(28);
    await flush();
    assert.deepEqual(calls[before], [
      "clear",
      ready()
        .snapshot.notices.filter((item) => !item.closed)
        .map(({ id, revision }) => ({ id, revision })),
    ]);
    key(15);
    key(57);
    await flush();
    assert.deepEqual(calls[before + 1], ["dismiss", 1, 2]);
    key(15);
    key(28);
    await flush();
    assert.deepEqual(calls[before + 2], ["action", 1, "view", 2]);
    assert.equal(
      calls.filter((call) => call[0] === "volume").length,
      volumeCalls,
      "idle DND/notification actions never retry unknown audio",
    );
    const stillIdle = observed;
    assert(stillIdle.kind === "ready");
    observed = {
      ...stillIdle,
      snapshot: { ...stillIdle.snapshot, revision: ++sequence, updating: true },
    };
    observe(observed);
    paint();
    before = calls.length;
    key(28);
    key(57);
    await flush();
    assert.equal(calls.length, before, "actual updating state still blocks notification mutations");
    observed = { ...stillIdle, snapshot: { ...stillIdle.snapshot, revision: ++sequence } };
    observe(observed);
    paint();
    const history = notificationHits().find((hit) => hit.focusId === "notifications:history")!;
    click(history);
    const passive = paint();
    before = calls.length;
    key(57);
    await flush();
    assert.equal(calls.length, before, "history never invokes old producer actions");
    assert.deepEqual(paint(), passive, "Space in passive history cannot navigate or mutate");
    key(15); // Reading body -> Back.
    key(57);
    assert.notDeepEqual(paint(), passive, "history Back is real content navigation");
    key(1);
    bellOpen();
    // Follow every generated focused notification action, including below the long body viewport.
    const entries = notificationHits().filter(
      (hit) => hit.focusable && hit.focusScopeId === NOTIFICATIONS_SCOPE,
    );
    for (let index = 0; index < entries.length - 1; index++) key(15);
    const scrolled = paint();
    key(28);
    assert.notDeepEqual(
      paint(),
      scrolled,
      "history footer remains reachable after keyboard traversal through scrolled notices",
    );
    assert.equal(shell.onPointerMotion?.({ x: 1, y: 1 }), true);
    assert.equal(shell.onPointerAxis?.({ x: 1, y: 1, deltaY: 1 }), true);
    shell.onClientFocus?.();
    assert.equal(edge(48, 1), false, "client focus closes whichever popup was open");
    edge(48, 0);
    const empty = ready(++sequence);
    observed = { ...empty, snapshot: { ...empty.snapshot, notices: [] } };
    observe(observed);
    bellOpen();
    capture("quiet-empty");
    key(1);
    // Production createShell, not a standalone Window or a consumed-only axis assertion.
    const scrollState = ready(++sequence);
    const scrollNotice = {
      ...scrollState.snapshot.notices[8]!,
      summary: "SCROLL_BEGIN",
      body:
        Array.from(
          { length: 72 },
          (_, index) => `Reading line ${String(index + 1).padStart(2, "0")}`,
        ).join("\n") + "\nSCROLL_END",
      closed: true,
      closedAt: now,
    };
    observed = { ...scrollState, snapshot: { ...scrollState.snapshot, notices: [scrollNotice] } };
    observe(observed);
    bellOpen();
    click(notificationHits().find((hit) => hit.focusId === "notifications:history")!);
    const historyHits = notificationHits("history");
    const bodyHit = historyHits.find((hit) => hit.focusId === "notifications:history-body")!;
    const backHit = historyHits.find((hit) => hit.focusId === "notifications:history")!;
    assert(
      bodyHit && backHit,
      "overflowing passive history has separate body and Back focus stops",
    );
    const crop = (frame: Uint8Array, hit: Pick<HitRegion, "x" | "y" | "width" | "height">) => {
      const left = Math.ceil(hit.x),
        right = Math.floor(hit.x + hit.width);
      const top = Math.ceil(hit.y),
        bottom = Math.floor(hit.y + hit.height);
      const result = new Uint8Array((right - left) * (bottom - top) * 4);
      for (let row = top; row < bottom; row++)
        result.set(
          frame.subarray((row * width + left) * 4, (row * width + right) * 4),
          (row - top) * (right - left) * 4,
        );
      return result;
    };
    const beforeWheel = paint();
    scrollObservations.length = 0;
    assert.equal(
      shell.onPointerAxis?.({
        x: bodyHit.x + bodyHit.width / 2,
        y: bodyHit.y + bodyHit.height / 2,
        deltaY: -3,
      }),
      true,
    );
    const afterWheel = paint();
    const wheelHit = scrollObservations.find((event) => event.stage === "hit");
    assert(wheelHit?.stage === "hit" && wheelHit.bounds && wheelHit.after > wheelHit.before);
    const wheelOffset = scrollObservations.find((event) => event.stage === "offset");
    assert(wheelOffset?.stage === "offset" && wheelOffset.maxScroll && wheelOffset.maxScroll > 0);
    assert.equal(
      wheelOffset.offset,
      132,
      "three raw wheel notches change production controlled offset",
    );
    const wheelPaint = scrollObservations.find((event) => event.stage === "paint");
    assert(
      wheelPaint?.stage === "paint" &&
        wheelPaint.offset === 132 &&
        wheelPaint.bodyChecksum !== null,
    );
    assert.notDeepEqual(
      crop(afterWheel, {
        ...bodyHit,
        x: bodyHit.x + 32,
        width: bodyHit.width - 64,
        y: bodyHit.y + 32,
        height: bodyHit.height - 64,
      }),
      crop(beforeWheel, {
        ...bodyHit,
        x: bodyHit.x + 32,
        width: bodyHit.width - 64,
        y: bodyHit.y + 32,
        height: bodyHit.height - 64,
      }),
      "wheel paints changed actual shell body pixels",
    );
    assert.deepEqual(
      crop(afterWheel, backHit),
      crop(beforeWheel, backHit),
      "wheel keeps footer pixels fixed",
    );
    capture("history-wheel");
    key(102); // History reading body has initial focus.
    scrollObservations.length = 0;
    key(109);
    const pageOffset = scrollObservations.find((event) => event.stage === "offset");
    assert(
      pageOffset?.stage === "offset" &&
        pageOffset.offset > 0 &&
        pageOffset.offset <= pageOffset.maxScroll!,
    );
    assert.equal(
      pageOffset.offset,
      Math.max(44, bodyHit.height * 0.8),
      "code-only PageDown reaches shared viewport",
    );
    key(107);
    const endOffset = [...scrollObservations].reverse().find((event) => event.stage === "offset");
    assert(endOffset?.stage === "offset" && endOffset.offset === endOffset.maxScroll);
    const expectedEnd = notificationHits("history", endOffset.offset);
    assert(expectedEnd.find((hit) => hit.focusId === "notifications:history")!.y === backHit.y);
    assertActualLabel("SCROLL_END", bodyHit);
    capture("history-keyboard-end");
    before = calls.length;
    key(28);
    key(57);
    assert.equal(
      calls.length,
      before,
      "Enter/Space in passive reading body never activate a producer",
    );
    key(15); // Body -> fixed Back.
    key(28);
    assert.notDeepEqual(paint(), afterWheel, "Back returns to the empty active view");
    key(1);
    // Support is retained through transient service observations, never fabricated as a ready value.
    readback();
    controlsOpen();
    for (const transient of [
      { kind: "error", message: "Fixture service error" },
      { kind: "loading", message: "Fixture loading" },
    ] satisfies DesktopStatusState[]) {
      observed = transient;
      observe(observed);
      paint();
      controlsHits();
      assertActualLabel("Volume");
      assertActualLabel("Unavailable");
      assert(!descendants(scene.container).some((node) => node.text === "40%"));
      before = calls.length;
      key(103);
      key(108);
      await flush();
      assert.equal(calls.length, before, "transient state does not write cached audio values");
      capture(`service-${transient.kind}-supported`);
    }
    const unsupported = ready(++sequence);
    observed = {
      ...unsupported,
      snapshot: {
        ...unsupported.snapshot,
        capabilities: { ...unsupported.snapshot.capabilities, audio: false },
      },
    };
    observe(observed);
    paint();
    const unsupportedHits = controlsHits();
    assert(!descendants(scene.container).some((node) => node.text === "Volume"));
    assert(
      !unsupportedHits.some(
        (hit) =>
          hit.focusId === "quick:audio" ||
          hit.focusId === "quick:mute" ||
          hit.focusId?.startsWith("slider:"),
      ),
    );
    assert(unsupportedHits.some((hit) => hit.focusId === "quick:network"));
    assert(
      !unsupportedHits.some((hit) => hit.focusId === "quick:power"),
      "unsupported power is hidden",
    );
    click(unsupportedHits.find((hit) => hit.focusId === "quick:network")!);
    controlsHits("network");
    assertActualLabel(cachedNetworkPresentation.label);
    key(1);
    // Minimized windows hidden by panel capacity can be restored through the real overflow scope.
    tasks = Array.from({ length: 30 }, (_, index) => ({
      clientId: 12,
      surfaceId: index + 1,
      title: `Fixture hidden window ${index + 1}`,
      appId: "Editor",
      focused: false,
      minimized: true,
    }));
    shell.setTasks?.(tasks);
    paint();
    const taskGeometry = anchors();
    assert(taskGeometry.overflow && taskGeometry.visibleTaskCount < tasks.length);
    const hidden = tasks.slice(taskGeometry.visibleTaskCount);
    click(taskGeometry.overflow);
    renderShell(
      scene,
      <TaskOverflow
        open
        screenW={width}
        screenH={height}
        anchor={taskGeometry.overflow}
        tasks={hidden}
        onTaskPress={inert}
        onDismiss={inert}
      />,
    );
    const taskHits = rasterize(scene.container, width, height).hits;
    assert(taskHits.some((hit) => hit.focusScopeId === TASK_WINDOWS_SCOPE));
    capture("hidden-windows");
    const firstHidden = hidden[0]!;
    click(
      taskHits.find(
        (hit) =>
          hit.focusId ===
          `${TASK_WINDOWS_SCOPE}:row:${firstHidden.clientId}:${firstHidden.surfaceId}`,
      )!,
    );
    assert.deepEqual(taskActions, [
      { clientId: firstHidden.clientId, surfaceId: firstHidden.surfaceId },
    ]);
    assert.equal(edge(30, 1), false, "actual restore closes overflow and returns client input");
    edge(30, 0);
    tasks = tasks.map((task) =>
      task.surfaceId === firstHidden.surfaceId
        ? { ...task, minimized: false, title: "Fixture restored metadata" }
        : task,
    );
    shell.setTasks?.(tasks);
    paint();
    click(anchors().overflow!);
    key(15); // auto-focused collection -> close
    key(15); // close -> generated collection keyboard owner
    key(28);
    assert.deepEqual(
      taskActions[1],
      { clientId: firstHidden.clientId, surfaceId: firstHidden.surfaceId },
      "keyboard activation uses current captured task identity",
    );
    click(anchors().overflow!);
    tasks = tasks.slice(0, taskGeometry.visibleTaskCount);
    shell.setTasks?.(tasks);
    paint();
    before = taskActions.length;
    key(28);
    assert.equal(taskActions.length, before, "retired captured tasks never activate replacements");
    assert.equal(edge(48, 1), false, "retiring last hidden task dismisses popup");
    edge(48, 0);
    // A retained pointer gesture owns the notice identities present at press time.
    tasks = [];
    shell.setTasks?.(tasks);
    function twoNotices(owner = ":1.4"): Extract<DesktopStatusState, { kind: "ready" }> {
      const next = ready(++sequence, 0.4, owner);
      return {
        ...next,
        snapshot: {
          ...next.snapshot,
          notices: next.snapshot.notices.slice(0, 2).map((notice) => ({
            ...notice,
            body: "Fixture press-time identity",
            summary: "Fixture notice",
          })),
        },
      };
    }
    observed = twoNotices();
    observe(observed);
    paint();
    bellOpen();
    const clearDown = notificationHits().find((hit) => hit.focusId === "notifications:clear")!;
    before = calls.length;
    pointer(clearDown, 1);
    assert(observed.kind === "ready");
    const originalPairs = observed.snapshot.notices.map(({ id, revision }) => ({ id, revision }));
    observed = {
      ...observed,
      snapshot: {
        ...observed.snapshot,
        revision: ++sequence,
        notices: observed.snapshot.notices.map((notice, index) =>
          index === 1 ? { ...notice, id: 3 } : notice,
        ),
      },
    };
    observe(observed);
    paint();
    const clearUp = notificationHits().find((hit) => hit.focusId === "notifications:clear")!;
    assert.deepEqual(
      [clearUp.x, clearUp.y, clearUp.width, clearUp.height],
      [clearDown.x, clearDown.y, clearDown.width, clearDown.height],
      "replacement preserves count and control geometry",
    );
    shell.onPointerMotion?.({
      x: clearUp.x + clearUp.width / 2,
      y: clearUp.y + clearUp.height / 2,
    });
    paint();
    pointer(clearUp, 0);
    await flush();
    assert.deepEqual(
      calls.slice(before),
      [["clear", originalPairs]],
      "release dispatches original1/2 pairs, never replacement1/3",
    );
    key(1);
    for (const focusId of [
      "notifications:clear",
      "notifications:dismiss:1:2",
      "notifications:action:1:2:view",
    ]) {
      observed = twoNotices();
      observe(observed);
      paint();
      bellOpen();
      const down = notificationHits().find((hit) => hit.focusId === focusId)!;
      assert(down);
      before = calls.length;
      pointer(down, 1);
      assert(observed.kind === "ready");
      observed = {
        ...observed,
        owner: ":1.9",
        snapshot: { ...observed.snapshot, revision: ++sequence },
      };
      observe(observed);
      paint();
      const up = notificationHits().find((hit) => hit.focusId === focusId)!;
      assert(up, "new owner exposes same producer id/revision/key for race regression");
      shell.onPointerMotion?.({ x: up.x + up.width / 2, y: up.y + up.height / 2 });
      paint();
      pointer(up, 0);
      await flush();
      assert.equal(calls.length, before, `stale owner cannot retarget ${focusId}`);
      key(1);
    }
    // ShiftTab from a remembered now-disabled slider selects the last eligible control.
    readback();
    controlsOpen();
    const downSlider = controlsHits().find(
      (hit) => hit.focusable && hit.focusId?.startsWith("slider:"),
    )!;
    pointer(downSlider, 1);
    pointer(downSlider, 0);
    await flush();
    const updating = ready(++sequence);
    observed = { ...updating, snapshot: { ...updating.snapshot, updating: true } };
    observe(observed);
    paint();
    const eligible = controlsHits().filter(
      (hit) => hit.focusable && hit.focusScopeId === QUICK_SETTINGS_SCOPE,
    );
    assert(eligible.length > 1 && !eligible.some((hit) => hit.focusId?.startsWith("slider:")));
    const last = eligible.at(-1)!;
    assert.equal(last.focusId, "quick:settings");
    const beforeBackward = paint();
    edge(42, 1);
    key(15);
    edge(42, 0);
    const afterBackward = paint();
    let changedLastControlPixels = 0;
    for (let y = Math.ceil(last.y); y < Math.floor(last.y + last.height); y++)
      for (let x = Math.ceil(last.x); x < Math.floor(last.x + last.width); x++) {
        const offset = (y * width + x) * 4;
        if (
          afterBackward
            .slice(offset, offset + 4)
            .some((value, index) => value !== beforeBackward[offset + index])
        )
          changedLastControlPixels++;
      }
    assert(
      changedLastControlPixels > 0,
      "actual last eligible Settings control paints backward focus from missing slider",
    );
    capture("shift-tab-disabled-slider");
    key(1);
    readback();
    assert.equal(spawned.length, 0, "fixture actions do not launch arbitrary apps");
    renderShell(scene, null);
    client.destroy();
    backend.disconnect();
    cases++;
  }
  console.log(
    `[shell/quick-settings] ${frames} actual wrapper/controller CPU frames, ${cases} live createShell workflows: separate bell/status+alternate popup, generated slider/toggle keys, one-release intent, drag coalescing, stale-boundary revocation, client modifier continuity, notification clear/actions/history/scroll, cached support/transient state, unsupported controls and hidden-window restore/retirement, press-time notice pairs/stale owner and disabled-focus ShiftTab passed; native/private daemon acceptance separate`,
  );
} finally {
  setTheme(baseTheme);
  setUiScaleFactor(1);
  for (const [key, value] of saved)
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  fs.rmSync(home, { recursive: true, force: true });
}
