import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
/** Production content/public Window workflows; device-free CPU proof, not native admission. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  createShellRoot,
  renderShell,
  rasterize,
  collectHits,
  type HitRegion,
  type SceneNode,
} from "@moire/react-host";
import { applyThemeFamily, getTheme, THEME_FAMILIES } from "@moire/theme";
import {
  Window,
  Surface,
  FocusScope,
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
import {
  QuickSettingsContent,
  measureQuickSettingsContent,
  type QuickSettingsContentProps,
} from "./QuickSettingsContent";

await installUiFonts();
const ready: DesktopStatusState = {
  kind: "ready",
  owner: ":1.42",
  snapshot: {
    revision: 1,
    updating: false,
    audio: { kind: "ready", name: "Observed default output", volume: 0.67, muted: false },
    network: [{ name: "eth0", transport: "wired", addresses: ["192.0.2.8"] }],
    wifi: WIFI_UNAVAILABLE,
    bluetooth: BLUETOOTH_UNAVAILABLE,
    battery: BATTERY_UNAVAILABLE,
    capabilities: {
      audio: true,
      brightness: true,
      battery: true,
      bluetooth: true,
      power: true,
      notifications: true,
    },
    notificationsAvailable: true,
    doNotDisturb: false,
    notices: [],
  },
};
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
let cases = 0,
  capabilityCases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const width of [420, 320])
          for (const retained of [false, true]) {
            setUiScaleFactor(scale);
            const theme = createPersonalizedWidgetTheme(
              discoverPersonalization("linux", {
                themeFamily: family,
                colorScheme,
                accent: applyThemeFamily(getTheme(), family, colorScheme === "dark").tokens.accent,
                contrast: "normal",
                reducedTransparency: false,
                fontScale: 1,
                reducedMotion: true,
              }),
            );
            const calls: Array<[string, number | boolean | undefined]> = [];
            const commits: number[] = [];
            let starts = 0,
              cancels = 0;
            let volumeDraft: QuickSettingsContentProps["volumeDraft"];
            let state: DesktopStatusState = ready;
            const props = (): QuickSettingsContentProps => ({
              width,
              state,
              cachedCapabilities: ready.snapshot.capabilities,
              onNetworkOpen: () => calls.push(["network", undefined]),
              onAudioOpen: () => calls.push(["audio", undefined]),
              onBluetoothOpen: () => calls.push(["bluetooth", undefined]),
              onPowerOpen: () => calls.push(["power", undefined]),
              onVolumeChange: (value) => calls.push(["volume", value]),
              onVolumeStart: () => {
                starts++;
              },
              onVolumeCommit: (value) => commits.push(value),
              onVolumeCancel: () => {
                cancels++;
              },
              volumeDraft,
              onMuteChange: (value) => calls.push(["mute", value]),
              onDoNotDisturbChange: (value) => calls.push(["dnd", value]),
              onSettings: () => calls.push(["settings", undefined]),
            });
            const unsupported: DesktopCapabilities = {
              audio: false,
              brightness: false,
              battery: false,
              bluetooth: false,
              power: false,
              notifications: false,
            };
            const subset = (extra: Partial<QuickSettingsContentProps>) => {
              const variant = { ...props(), ...extra };
              const metrics = measureQuickSettingsContent(variant, theme);
              const scope = createShellRoot();
              renderShell(
                scope,
                <WidgetThemeProvider theme={theme}>
                  <Surface
                    width={width}
                    height={Math.ceil(metrics.height)}
                    fill={theme.foundations.palette.panel}
                  >
                    <QuickSettingsContent {...variant} />
                  </Surface>
                </WidgetThemeProvider>,
              );
              const frame = rasterize(scope.container, width, Math.ceil(metrics.height));
              const text: string[] = [];
              const images: SceneNode[] = [];
              const walk = (node: SceneNode) => {
                if (node.kind === "text") text.push(node.text ?? "");
                if (node.kind === "image") images.push(node);
                for (const child of node.children) walk(child);
              };
              walk(scope.container);
              const ids = frame.hits.filter((hit) => hit.focusable).map((hit) => hit.focusId);
              renderShell(scope, null);
              capabilityCases++;
              return { metrics, text: text.join(" "), ids, pixels: frame.pixels, images };
            };
            const absent = subset({
              state: { ...ready, snapshot: { ...ready.snapshot, capabilities: unsupported } },
            });
            assert.deepEqual(absent.ids, ["quick:network", "quick:settings"]);
            for (const label of [
              "Volume",
              "Audio output",
              "Battery",
              "Brightness",
              "Bluetooth",
              "Do not disturb",
              "Power actions",
            ])
              assert(!absent.text.includes(label), `unsupported ${label} omitted`);
            assert(
              absent.text.includes("Wired network") &&
                absent.text.includes("Network status unavailable"),
            );
            assert(
              absent.metrics.height <
                measureQuickSettingsContent(props(), theme).height - 100 * scale,
              "unsupported groups close measured spacing",
            );
            for (const kind of ["loading", "error", "unavailable"] as const) {
              const transient = subset({
                state: { kind, message: "Actual service temporarily unavailable" },
                cachedCapabilities: { ...unsupported, audio: true },
                cachedNetworkPresentation: {
                  transport: "wired",
                  label: "Wired network",
                  icon: "ethernet",
                  detail: "Internet status unavailable",
                },
              });
              assert(transient.text.includes("Audio output") && transient.text.includes("Volume"));
              assert(
                transient.text.includes("Wired network") && !transient.text.includes("192.0.2.8"),
                "transport cache does not claim stale addresses",
              );
              assert.deepEqual(
                transient.ids,
                ["quick:network", "quick:audio", "quick:settings"],
                "cached support preserves read-only rows, never stale mutations",
              );
            }
            const supportedError = subset({
              state: {
                ...ready,
                snapshot: {
                  ...ready.snapshot,
                  capabilities: { ...unsupported, audio: true },
                  audio: { kind: "error", message: "Actual audio server unavailable" },
                },
              },
            });
            assert(
              supportedError.text.includes("Audio output") &&
                supportedError.text.includes("Actual audio server unavailable"),
            );
            assert.deepEqual(supportedError.ids, [
              "quick:network",
              "quick:audio",
              "quick:settings",
            ]);
            const uncached = subset({
              state: { kind: "loading", message: "Reading status" },
              cachedCapabilities: undefined,
            });
            assert.deepEqual(uncached.ids, ["quick:network", "quick:settings"]);
            const wifi = subset({
              state: {
                ...ready,
                snapshot: {
                  ...ready.snapshot,
                  capabilities: unsupported,
                  network: [{ name: "wlan0", transport: "wifi", addresses: ["198.51.100.2"] }],
                  wifi: {
                    kind: "ready",
                    policy: "readonly",
                    enabled: true,
                    hardwareEnabled: true,
                    canScan: false,
                    canConnect: false,
                    connection: { kind: "active", transport: "wifi", name: "Observed SSID" },
                    connectivity: "full",
                    accessPoints: [],
                    operation: { kind: "idle" },
                  },
                },
              },
            });
            assert(wifi.text.includes("Observed SSID") && wifi.text.includes("Internet connected"));
            assert(
              !wifi.text.includes("wlan0") && !wifi.text.includes("198.51.100.2"),
              "main shows daemon status; local addresses belong to details",
            );
            const mixed = subset({
              state: {
                ...ready,
                snapshot: {
                  ...ready.snapshot,
                  capabilities: unsupported,
                  network: [
                    ...ready.snapshot.network,
                    { name: "tun0", transport: "other", addresses: ["198.51.100.2"] },
                  ],
                },
              },
            });
            assert(mixed.text.includes("Network") && !mixed.text.includes("Wired network"));
            assert(
              !Buffer.from(absent.pixels).equals(Buffer.from(wifi.pixels)),
              "wired and Wi-Fi render distinctly",
            );
            assert.equal(
              absent.images.length,
              3,
              "wired icon, disclosure chevron and Settings use actual SVG image nodes, no generic geometric fallback",
            );
            assert.equal(wifi.images.length, 3, "Wi-Fi symbolic vector remains actual image node");
            assert.equal(
              mixed.images.length,
              3,
              "mixed transport globe uses actual SVG image node",
            );
            assert(
              absent.images[0]?.imagePixels &&
                wifi.images[0]?.imagePixels &&
                mixed.images[0]?.imagePixels,
            );
            assert(
              !Buffer.from(absent.images[0].imagePixels).equals(
                Buffer.from(wifi.images[0].imagePixels),
              ),
              "actual wired and Wi-Fi glyph pixels differ",
            );
            assert(
              !Buffer.from(absent.images[0].imagePixels).equals(
                Buffer.from(mixed.images[0].imagePixels),
              ),
              "actual wired and generic globe glyph pixels differ",
            );
            const available = subset({
              state: {
                ...ready,
                snapshot: {
                  ...ready.snapshot,
                  capabilities: { ...unsupported, audio: true, notifications: true },
                },
              },
            });
            const previewDirectory = process.env.MOIRE_QUICK_CONTENT_CAPTURE_DIR;
            if (previewDirectory && family === "moire" && colorScheme === "dark" && retained) {
              fs.mkdirSync(previewDirectory, { recursive: true });
              for (const [name, result] of [
                ["unsupported", absent],
                ["supported", available],
                ["audio-error", supportedError],
              ] as const) {
                const prefix = `${name}-${width}-scale${scale}`;
                fs.writeFileSync(path.join(previewDirectory, `${prefix}.bgra`), result.pixels);
                fs.writeFileSync(
                  path.join(previewDirectory, `${prefix}.json`),
                  JSON.stringify({
                    width,
                    height: Math.ceil(result.metrics.height),
                    format: "BGRA",
                    scope: "actual capability CPU layout; no native claim",
                  }),
                );
              }
            }
            const height = Math.ceil(measureQuickSettingsContent(props(), theme).height);
            assert.equal(
              measureQuickSettingsContent(
                {
                  ...props(),
                  volumeDraft: {
                    value: 0.25,
                    caption: "Requested 25%; waiting for actual readback",
                  },
                },
                theme,
              ).height,
              measureQuickSettingsContent(props(), theme).height,
              "natural main extent remains stable before/during draft at compact/scaled allocations",
            );
            assert(
              height > 350 && height < 1100,
              `bounded natural height ${family}/${scale}/${width}: ${height}`,
            );
            const element = () => (
              <WidgetThemeProvider theme={theme}>
                <Surface width={width} height={height} fill={theme.foundations.palette.panel}>
                  <FocusScope width={width} height={height} trap>
                    <QuickSettingsContent {...props()} />
                  </FocusScope>
                </Surface>
              </WidgetThemeProvider>
            );
            const root = createShellRoot();
            renderShell(root, element());
            let hits = collectHits(root.container);
            const stableIds = [
              "quick:network",
              "quick:audio",
              "quick:bluetooth",
              "quick:settings",
              "quick:power",
            ];
            const anchorBounds = () =>
              collectHits(root.container)
                .filter((hit) => stableIds.includes(hit.focusId ?? ""))
                .map((hit) => ({
                  id: hit.focusId,
                  x: hit.x,
                  y: hit.y,
                  width: hit.width,
                  height: hit.height,
                }));
            const idleBounds = anchorBounds();
            for (const variant of [
              { ...props(), volumeDraft: { value: 0.25, caption: "Requested 25%" } },
              {
                ...props(),
                busy: true,
                volumeDraft: { value: 0.25, caption: "Requested 25%; waiting for actual readback" },
              },
              {
                ...props(),
                busy: true,
                volumeDraft: { value: 0.25, caption: "Requested value unavailable; ".repeat(40) },
              },
            ]) {
              assert.equal(
                measureQuickSettingsContent(variant, theme).height,
                measureQuickSettingsContent(props(), theme).height,
                "idle/edit/pending/long draft measured main extent is stable",
              );
              renderShell(
                root,
                <WidgetThemeProvider theme={theme}>
                  <Surface width={width} height={height} fill={theme.foundations.palette.panel}>
                    <FocusScope width={width} height={height} trap>
                      <QuickSettingsContent {...variant} />
                    </FocusScope>
                  </Surface>
                </WidgetThemeProvider>,
              );
              assert.deepEqual(
                anchorBounds(),
                idleBounds,
                "actual main row/action bounds stay stationary during draft/pending",
              );
            }
            renderShell(root, element());
            hits = collectHits(root.container);
            const focusable = hits.filter((hit) => hit.focusable);
            assert.equal(
              focusable.length,
              8,
              "observed controls plus read-only disclosures; unsupported mutation controls never focus",
            );
            assert.deepEqual(
              focusable.map((hit) => hit.focusId?.split(":")[0]),
              ["quick", "quick", "slider", "quick", "quick", "toggle", "quick", "quick"],
            );
            for (const hit of focusable) {
              assert(
                hit.x >= 0 &&
                  hit.y >= 0 &&
                  hit.x + hit.width <= width + 0.02 &&
                  hit.y + hit.height <= height + 0.02,
                `actual hit bounded: ${hit.focusId}`,
              );
            }
            const settings = focusable.find((hit) => hit.focusId === "quick:settings");
            assert.ok(settings);
            const painted: Array<{ node: SceneNode; x: number; y: number }> = [];
            const walk = (node: SceneNode, parentX = 0, parentY = 0) => {
              const x = parentX + node.x,
                y = parentY + node.y;
              painted.push({ node, x, y });
              for (const child of node.children) walk(child, x, y);
            };
            walk(root.container);
            const title = painted.find((item) => item.node.text === "Settings");
            const artwork = painted.find(
              (item) =>
                item.node.kind === "image" &&
                item.x >= settings.x &&
                item.x < settings.x + settings.width &&
                item.y >= settings.y &&
                item.y < settings.y + settings.height,
            );
            assert.ok(title);
            assert.ok(artwork);
            assert(
              title.x >= artwork.x + artwork.node.width + 4 * scale,
              "actual Settings glyph allocation clears full artwork at every scale",
            );
            const backend = new HeadlessPlatform();
            await backend.connect();
            const window = new Window({
              title: "Quick settings draft",
              width,
              height,
              decorated: false,
            });
            window.setContent(element);
            window.mount(backend);
            await Promise.resolve();
            const native = backend.getWindows()[0];
            assert.ok(native);
            if (retained) {
              const platform: PlatformWindow = native;
              platform.presentScene = () => false;
            }
            const key = (code: number, value: string, shift = false) => {
              for (const type of ["down", "up"] as const)
                native.injectKey({
                  type,
                  code,
                  key: value,
                  modifiers: { ...modifiers, shift },
                  timeMs: 1,
                });
              window.tick();
            };
            const click = (hit: HitRegion) => {
              for (const type of ["down", "up"] as const)
                native.injectPointer({
                  type,
                  x: hit.x + hit.width / 2,
                  y: hit.y + hit.height / 2,
                  button: "left",
                  timeMs: 1,
                });
              window.tick();
            };
            try {
              window.tick();
              window.tick();
              assert.ok(native.lastFrame);
              const initial = native.lastFrame.slice();
              key(28, "Enter");
              assert.deepEqual(calls.at(-1), ["network", undefined]);
              key(15, "Tab");
              key(57, " ");
              assert.deepEqual(calls.at(-1), ["mute", true]);
              key(15, "Tab");
              const beforeFocus = native.lastFrame!.slice();
              key(106, "ArrowRight");
              assert.deepEqual(calls.at(-1), ["volume", 0.68]);
              key(102, "Home");
              assert.deepEqual(calls.at(-1), ["volume", 0]);
              key(107, "End");
              assert.deepEqual(calls.at(-1), ["volume", 1]);
              assert.deepEqual(commits, [0.68, 0, 1], "one keyboard commit per release");
              assert.equal(
                state.snapshot.audio.kind === "ready" && state.snapshot.audio.volume,
                0.67,
                "requests do not invent observed readback",
              );
              key(15, "Tab");
              key(28, "Enter");
              assert.deepEqual(calls.at(-1), ["audio", undefined]);
              key(15, "Tab");
              key(28, "Enter");
              assert.deepEqual(
                calls.at(-1),
                ["bluetooth", undefined],
                "disclosure only; no unsupported Bluetooth toggle",
              );
              key(15, "Tab");
              key(57, " ");
              assert.deepEqual(calls.at(-1), ["dnd", true]);
              key(15, "Tab");
              key(28, "Enter");
              assert.deepEqual(calls.at(-1), ["settings", undefined]);
              key(15, "Tab");
              key(28, "Enter");
              assert.deepEqual(
                calls.at(-1),
                ["power", undefined],
                "read-only power detail disclosure",
              );
              key(15, "Tab", true);
              key(15, "Tab", true);
              key(57, " ");
              assert.deepEqual(calls.at(-1), ["dnd", true]);
              assert(
                !Buffer.from(beforeFocus).equals(Buffer.from(initial)),
                "actual focus repaints controls",
              );
              click(focusable[3]!);
              assert.deepEqual(calls.at(-1), ["audio", undefined]);
              // Release endpoint remains useful; this content does not model RPC in-flight coalescing.
              const slider = focusable[2]!;
              native.injectPointer({
                type: "down",
                x: slider.x,
                y: slider.y + slider.height / 2,
                button: "left",
                timeMs: 1,
              });
              native.injectPointer({
                type: "up",
                x: slider.x + slider.width,
                y: slider.y + slider.height / 2,
                button: "left",
                timeMs: 2,
              });
              window.tick();
              assert.deepEqual(calls.at(-1), ["volume", 1]);
              assert.equal(commits.length, 4, "pointer draft emits one final commit");
              assert.equal(starts, 4);
              native.injectPointer({
                type: "down",
                x: slider.x,
                y: slider.y + slider.height / 2,
                button: "left",
                timeMs: 3,
              });
              window.tick();
              key(15, "Tab");
              assert.equal(cancels, 1, "focus loss cancels pending pointer draft");
              assert.equal(commits.length, 4);
              const directory = process.env.MOIRE_QUICK_CONTENT_CAPTURE_DIR;
              if (directory && family === "moire" && colorScheme === "dark" && retained) {
                fs.mkdirSync(directory, { recursive: true });
                const name = `${width}-scale${scale}`;
                fs.writeFileSync(path.join(directory, `${name}.bgra`), initial);
                fs.writeFileSync(
                  path.join(directory, `${name}.json`),
                  JSON.stringify({
                    width,
                    height,
                    format: "BGRA",
                    scope: "actual public Window retained CPU; not native",
                  }),
                );
              }
              state = { kind: "unavailable", message: "Session service disconnected" };
              window.setContent(element);
              window.tick();
              renderShell(root, element());
              hits = collectHits(root.container);
              assert.deepEqual(
                hits.filter((hit) => hit.focusable).map((hit) => hit.focusId),
                [
                  "quick:network",
                  "quick:audio",
                  "quick:bluetooth",
                  "quick:settings",
                  "quick:power",
                ],
                "unavailable backend leaves only read-only disclosures and independent Settings launch",
              );
              state = {
                ...ready,
                snapshot: {
                  ...ready.snapshot,
                  audio: { kind: "ready", name: "Observed muted output", volume: 1.2, muted: true },
                  updating: true,
                },
              };
              window.setContent(element);
              window.tick();
              renderShell(root, element());
              assert.equal(
                collectHits(root.container).filter((hit) => hit.focusable).length,
                5,
                "pending status disables mutations",
              );
              const natural = measureQuickSettingsContent(props(), theme);
              assert(
                natural.height > height,
                "above-100 observed volume has an honest range caption",
              );
              const observed = rasterize(
                root.container,
                width,
                Math.ceil(natural.height),
              ).pixels.slice();
              volumeDraft = { value: 0.25, caption: "Requested 25%; waiting for actual readback" };
              window.setContent(element);
              window.tick();
              renderShell(root, element());
              const requested = rasterize(root.container, width, Math.ceil(natural.height)).pixels;
              assert(
                !Buffer.from(requested).equals(Buffer.from(observed)),
                "pending draft paints distinct thumb/caption without substituting observed 120%",
              );
              // No notification rows/history are embedded in the main quick-settings model.
              const fresh = rasterize(root.container, width, Math.ceil(natural.height));
              assert(fresh.pixels.some((value) => value !== 0));
              state = { ...ready, snapshot: { ...ready.snapshot, capabilities: unsupported } };
              window.setContent(element);
              window.tick();
              renderShell(root, element());
              const unsupportedHits = collectHits(root.container).filter((hit) => hit.focusable);
              assert.deepEqual(
                unsupportedHits.map((hit) => hit.focusId),
                ["quick:network", "quick:settings"],
              );
              click(unsupportedHits[0]!);
              assert.deepEqual(calls.at(-1), ["network", undefined]);
              click(unsupportedHits[1]!);
              assert.deepEqual(calls.at(-1), ["settings", undefined]);
              cases++;
            } finally {
              window.destroy();
              await backend.disconnect();
              renderShell(root, null);
            }
          }
} finally {
  setUiScaleFactor(1);
}
console.log(
  `QuickSettingsContent: ${cases} real Window direct/retained CPU cases + ${capabilityCases} capability tree/raster cases passed; no native/backend integration claim.`,
);
