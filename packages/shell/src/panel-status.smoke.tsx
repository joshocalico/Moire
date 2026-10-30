import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
/** Actual Panel/public Window geometry and separate status/bell routes; no native display claim. */
import assert from "node:assert/strict";
import React from "react";
import {
  collectHits,
  createShellRoot,
  renderShell,
  rasterize,
  type SceneNode,
} from "@moire/react-host";
import { applyThemeFamily, getTheme, setTheme, THEME_FAMILIES } from "@moire/theme";
import {
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindow,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import type {
  DesktopCapabilities,
  DesktopStatusState,
} from "@moire/system-management/desktop-status";
import { Panel, panelStatusGeometry, type PanelProps } from "./Panel";
import { networkPresentation, type NetworkPresentation } from "./network-presentation";

await installUiFonts();
const originalTheme = getTheme();
let cases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const dark of [false, true])
      for (const scale of [1, 1.5])
        for (const width of [320, 640, 1280])
          for (const count of [1, 128]) {
            setUiScaleFactor(scale);
            setTheme(applyThemeFamily(originalTheme, family, dark));
            const theme = createPersonalizedWidgetTheme(
              discoverPersonalization("linux", {
                themeFamily: family,
                colorScheme: dark ? "dark" : "light",
                accent: getTheme().tokens.accent,
                reducedMotion: true,
                fontScale: 1,
              }),
            );
            const height = 240;
            const calls: string[] = [];
            let status: DesktopStatusState = {
              kind: "ready",
              owner: ":1.8",
              snapshot: {
                revision: 1,
                updating: false,
                audio: { kind: "ready", name: "Observed sink", volume: 0.3, muted: false },
                network: [{ name: "eth0", transport: "wired", addresses: ["192.0.2.9"] }],
                wifi: WIFI_UNAVAILABLE,
                bluetooth: BLUETOOTH_UNAVAILABLE,
                battery: BATTERY_UNAVAILABLE,
                capabilities: {
                  audio: true,
                  battery: false,
                  brightness: false,
                  bluetooth: false,
                  power: false,
                  notifications: true,
                },
                notificationsAvailable: true,
                doNotDisturb: false,
                notices: [],
              },
            };
            const readySnapshot = status.snapshot;
            let cachedCapabilities: DesktopCapabilities | undefined;
            let cachedNetworkPresentation: NetworkPresentation | undefined;
            const props = (): PanelProps => ({
              screenW: width,
              screenH: height,
              clock: "10:24 · 3 Oct",
              status,
              cachedCapabilities,
              cachedNetworkPresentation,
              notificationCount: count,
              onControlsClick: () => calls.push("controls"),
              onNotificationsClick: () => calls.push("notifications"),
              onLauncherClick: () => calls.push("apps"),
              onTaskOverflowClick: () => calls.push("windows"),
              onTaskPress: (task) => calls.push(`task:${task.surfaceId}`),
              tasks: Array.from({ length: 10 }, (_, index) => ({
                clientId: 1,
                surfaceId: index + 1,
                title: `Window ${index + 1}`,
                // Distinct applications, so each window keeps its own slot.
                appId: `moire.fixture${index + 1}`,
                focused: index === 0,
                minimized: false,
              })),
            });
            const panelGeometryForProps = () =>
              panelStatusGeometry({ ...props(), taskCount: props().tasks?.length ?? 0 });
            const element = () => (
              <WidgetThemeProvider theme={theme}>
                <Panel {...props()} />
              </WidgetThemeProvider>
            );
            const root = createShellRoot();
            renderShell(root, element());
            const geometry = panelGeometryForProps();
            const hits = collectHits(root.container);
            for (const [id, bounds] of [
              ["panel:controls", geometry.controls],
              ["panel:notifications", geometry.notifications],
            ] as const) {
              assert.ok(bounds);
              const hit = hits.find((hit) => hit.focusId === id);
              assert.ok(hit);
              for (const key of ["x", "y", "width", "height"] as const)
                assert.equal(hit[key], bounds[key], `${id} render/helper ${key}`);
              assert(
                bounds.x >= geometry.panel.x &&
                  bounds.x + bounds.width <= geometry.panel.x + geometry.panel.width &&
                  bounds.y >= geometry.panel.y &&
                  bounds.y + bounds.height <= geometry.panel.y + geometry.panel.height,
              );
            }
            const findNode = (
              node: SceneNode,
              predicate: (node: SceneNode) => boolean,
            ): SceneNode | undefined => {
              if (predicate(node)) return node;
              for (const child of node.children) {
                const found = findNode(child, predicate);
                if (found) return found;
              }
              return undefined;
            };
            const controlNode = findNode(
              root.container,
              (node) => node.focusId === "panel:controls",
            );
            assert.ok(controlNode);
            assert.ok(controlNode.parent);
            const networkArtwork = findNode(controlNode.parent, (node) => node.kind === "image");
            assert.ok(networkArtwork?.imagePixels);
            assert.ok(networkArtwork.imageWidth);
            assert.ok(networkArtwork.imageHeight);
            assert(
              networkArtwork.width >= 18 && networkArtwork.height >= 18,
              `Network keeps its readable 18px paint allocation: ${family}/${dark}/${scale}/${width}/${count}: control=${geometry.controls?.width} image=${networkArtwork.width}x${networkArtwork.height}`,
            );
            let left = networkArtwork.imageWidth,
              right = -1,
              top = networkArtwork.imageHeight,
              bottom = -1;
            for (let y = 0; y < networkArtwork.imageHeight; y++)
              for (let x = 0; x < networkArtwork.imageWidth; x++)
                if (
                  networkArtwork.imagePixels[(y * networkArtwork.imageWidth + x) * 4 + 3]! >= 32
                ) {
                  left = Math.min(left, x);
                  right = Math.max(right, x);
                  top = Math.min(top, y);
                  bottom = Math.max(bottom, y);
                }
            assert(
              right - left + 1 >= 10 && bottom - top + 1 >= 12,
              "actual Network ink remains a recognizable glyph, not a compressed line",
            );
            assert(
              geometry.controls!.width >= 36,
              "Network control has usable hit and paint width",
            );
            assert(geometry.controls!.x + geometry.controls!.width <= geometry.notifications!.x);
            assert(geometry.notifications!.x + geometry.notifications!.width <= geometry.clock.x);
            const ordered = hits.filter((hit) => hit.focusable).sort((a, b) => a.x - b.x);
            for (let i = 1; i < ordered.length; i++)
              assert(
                ordered[i - 1]!.x + ordered[i - 1]!.width <= ordered[i]!.x + 0.01,
                "tasks/Apps/status/bell never overlap",
              );
            const initial = rasterize(root.container, width, height).pixels.slice();
            const backend = new HeadlessPlatform();
            await backend.connect();
            const window = new Window({ title: "Panel status", width, height, decorated: false });
            window.setContent(element);
            window.mount(backend);
            await Promise.resolve();
            const native = backend.getWindows()[0];
            assert.ok(native);
            // Both CPU paths are exercised across count cohorts, with the same actual wire-facing Window.
            if (count === 128) {
              const platform: PlatformWindow = native;
              platform.presentScene = () => false;
            }
            try {
              window.tick();
              window.tick();
              for (const [name, bounds] of [
                ["controls", geometry.controls],
                ["notifications", geometry.notifications],
              ] as const) {
                assert.ok(bounds);
                for (const type of ["down", "up"] as const)
                  native.injectPointer({
                    type,
                    x: bounds.x + bounds.width / 2,
                    y: bounds.y + bounds.height / 2,
                    button: "left",
                    timeMs: 1,
                  });
                window.tick();
                assert.equal(calls.at(-1), name);
              }
              assert.deepEqual(
                calls,
                ["controls", "notifications"],
                "bell and system controls are independent routes",
              );
              const apps = {
                x: geometry.panel.x + geometry.launcherX,
                y: geometry.panel.y,
                width: geometry.launcherW,
                height: geometry.panel.height,
              };
              for (const type of ["down", "up"] as const)
                native.injectPointer({
                  type,
                  x: apps.x + apps.width / 2,
                  y: apps.y + apps.height / 2,
                  button: "left",
                  timeMs: 1,
                });
              window.tick();
              assert.equal(calls.at(-1), "apps", "compact and standard Apps remain actionable");
              const task = hits.find(
                (hit) =>
                  hit.focusable &&
                  !hit.focusId?.startsWith("panel:") &&
                  hit.x === geometry.panel.x + geometry.taskX,
              );
              if (task) {
                for (const type of ["down", "up"] as const)
                  native.injectPointer({
                    type,
                    x: task.x + task.width / 2,
                    y: task.y + task.height / 2,
                    button: "left",
                    timeMs: 1,
                  });
                window.tick();
                assert.equal(calls.at(-1), "task:1", "bounded task slots retain activation");
              }
              status = {
                kind: "ready",
                owner: ":1.8",
                snapshot: {
                  ...status.snapshot,
                  audio: { kind: "ready", name: "Observed sink", volume: 0.3, muted: true },
                },
              };
              renderShell(root, element());
              const muted = rasterize(root.container, width, height).pixels.slice();
              if (geometry.controls!.width >= 56)
                assert.notDeepEqual(muted, initial, "actual mute changes visible audio artwork");
              else
                assert.deepEqual(
                  muted,
                  initial,
                  "compact summary reserves Network instead of squeezing audio",
                );
              status = { kind: "unavailable", message: "Service disconnected" };
              renderShell(root, element());
              const unavailable = rasterize(root.container, width, height).pixels.slice();
              assert.notDeepEqual(unavailable, muted, "unavailable status revokes ready tint");
              assert.equal(
                collectHits(root.container).find((hit) => hit.focusId === "panel:notifications")!
                  .width,
                geometry.notifications!.width,
                "unavailable service does not conflate count or anchors",
              );
              cachedCapabilities = readySnapshot.capabilities;
              cachedNetworkPresentation = networkPresentation(readySnapshot.network);
              let transientPixels: Uint8Array | null = null;
              for (const kind of ["loading", "unavailable", "error"] as const) {
                status = { kind, message: "Observed service unavailable" };
                renderShell(root, element());
                const transientGeometry = panelGeometryForProps();
                assert.deepEqual(
                  transientGeometry.controls,
                  geometry.controls,
                  "cached capabilities preserve the status anchor during outer transients",
                );
                const pixels = rasterize(root.container, width, height).pixels.slice();
                if (transientPixels) assert.deepEqual(pixels, transientPixels);
                transientPixels = pixels;
              }
              assert.notDeepEqual(
                transientPixels,
                muted,
                "cached transport does not retain observed mute or local-address tint",
              );
              status = {
                kind: "ready",
                owner: ":1.8",
                snapshot: {
                  ...readySnapshot,
                  network: [{ name: "wlan0", transport: "wifi", addresses: ["192.0.2.9"] }],
                },
              };
              renderShell(root, element());
              assert.notDeepEqual(
                rasterize(root.container, width, height).pixels,
                initial,
                "wired and Wi-Fi have distinct actual artwork",
              );
              assert.deepEqual(panelGeometryForProps().controls, geometry.controls);
              status = {
                kind: "ready",
                owner: ":1.8",
                snapshot: {
                  ...readySnapshot,
                  capabilities: { ...readySnapshot.capabilities, audio: false },
                },
              };
              renderShell(root, element());
              const unsupportedGeometry = panelGeometryForProps();
              assert.ok(unsupportedGeometry.controls);
              assert(unsupportedGeometry.controls.width <= geometry.controls!.width);
              if (width >= 640)
                assert(
                  unsupportedGeometry.controls.width < geometry.controls!.width,
                  "unsupported audio is omitted; only Network remains",
                );
              assert.deepEqual(unsupportedGeometry.notifications, geometry.notifications);
              const unsupportedPixels = rasterize(root.container, width, height).pixels.slice();
              status = {
                ...status,
                snapshot: {
                  ...status.snapshot,
                  audio: {
                    kind: "ready",
                    name: "Ignored unsupported sink",
                    volume: 0.9,
                    muted: true,
                  },
                },
              };
              renderShell(root, element());
              assert.deepEqual(
                rasterize(root.container, width, height).pixels,
                unsupportedPixels,
                "unsupported audio values cannot paint an audio symbol",
              );
              const noStatus = panelStatusGeometry({
                screenW: width,
                screenH: height,
                clock: "10:24",
              });
              assert.equal(noStatus.controls, null);
              assert.equal(noStatus.notifications, null);
              renderShell(
                root,
                <WidgetThemeProvider theme={theme}>
                  <Panel
                    screenW={width}
                    screenH={height}
                    clock="10:24"
                    onLauncherClick={() => calls.push("apps")}
                  />
                </WidgetThemeProvider>,
              );
              assert(
                !collectHits(root.container).some((hit) => hit.focusId?.startsWith("panel:")),
                "old caller needs no new groups",
              );
              cases++;
            } finally {
              window.destroy();
              await backend.disconnect();
              renderShell(root, null);
            }
          }
} finally {
  setUiScaleFactor(1);
  setTheme(originalTheme);
}
console.log(
  `Panel status: ${cases} five-family geometry/public Window cases passed; no native claim.`,
);
