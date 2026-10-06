import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
/** Actual content tree/raster and public Window input; no native/device/backend acceptance. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import React from "react";
import { createShellRoot, renderShell, rasterize, type SceneNode } from "@moire/react-host";
import {
  Column,
  FocusScope,
  Surface,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { THEME_FAMILIES } from "@moire/theme";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import {
  QuickSettingsDetails,
  measureQuickSettingsDetails,
  type QuickSettingsDetailsProps,
  type QuickSettingsDetailsView,
} from "./QuickSettingsDetails";
import { createVolumeIntent, type VolumeDispatchIntent } from "./volume-intent";

const previews =
  process.env.MOIRE_QUICK_DETAILS_PREVIEW_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "moire-quick-details-"));
fs.mkdirSync(previews, { recursive: true });
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
function painted(node: SceneNode): boolean {
  for (let item: SceneNode | null = node; item; item = item.parent)
    if ((typeof item.opacity === "number" ? item.opacity : (item.opacity?.get() ?? 1)) <= 0)
      return false;
  return true;
}
function absolute(node: SceneNode) {
  let x = 0,
    y = 0;
  for (let item: SceneNode | null = node; item; item = item.parent) {
    x +=
      item.x +
      (typeof item.translateX === "number" ? item.translateX : (item.translateX?.get() ?? 0));
    y +=
      item.y +
      (typeof item.translateY === "number" ? item.translateY : (item.translateY?.get() ?? 0));
  }
  return { x, y };
}
// Dependency-free PNG publication for actual BGRA software frames.
function crc(bytes: Buffer): number {
  let value = 0xffff_ffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}
function png(pixels: Uint8Array, width: number, height: number): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4,
        dst = y * (width * 4 + 1) + 1 + x * 4;
      scanlines[dst] = pixels[src + 2]!;
      scanlines[dst + 1] = pixels[src + 1]!;
      scanlines[dst + 2] = pixels[src]!;
      scanlines[dst + 3] = pixels[src + 3]!;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const ready: DesktopStatusState = {
  kind: "ready",
  owner: ":1.40",
  snapshot: {
    revision: 7,
    updating: false,
    audio: { kind: "ready", volume: 0.67, muted: false, name: "Observed studio headphones" },
    network: [{ name: "eth0", transport: "wired", addresses: ["192.0.2.6", "2001:db8::6"] }],
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
    doNotDisturb: false,
    notificationsAvailable: true,
    notices: [],
  },
};
const views: readonly QuickSettingsDetailsView[] = ["network", "audio", "bluetooth", "power"];
await installUiFonts();
let frames = 0,
  windowCases = 0;
const dimensions: {
  family: string;
  colorScheme: string;
  scale: number;
  width: number;
  view: QuickSettingsDetailsView;
  height: number;
}[] = [];
try {
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const) {
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { themeFamily: family, colorScheme, reducedMotion: true }),
      );
      for (const scale of [1, 1.5])
        for (const width of [320, 520])
          for (const view of views) {
            setUiScaleFactor(scale);
            const root = createShellRoot();
            const props: QuickSettingsDetailsProps = {
              width,
              view,
              state: ready,
              onBack() {},
              onSettings() {},
              onVolumeStart() {},
              onVolumeChange() {},
              onVolumeCommit() {},
              onVolumeCancel() {},
              onMuteChange() {},
            };
            function paint(extra: Partial<QuickSettingsDetailsProps> = {}) {
              const current = { ...props, ...extra };
              const metrics = measureQuickSettingsDetails(current, theme);
              assert.ok(Number.isFinite(metrics.height) && metrics.height > 80);
              assert.equal(metrics.width, width);
              const height = Math.ceil(metrics.height);
              renderShell(
                root,
                <WidgetThemeProvider theme={theme}>
                  <Surface
                    width={width}
                    height={height}
                    fill={theme.foundations.palette.panel}
                    radius={theme.foundations.palette.radiusLg}
                    stroke={theme.foundations.palette.accentLine}
                    strokeWidth={1}
                  >
                    <Column width={width}>
                      <QuickSettingsDetails {...current} />
                    </Column>
                  </Surface>
                </WidgetThemeProvider>,
              );
              const frame = rasterize(root.container, width, height);
              const all = nodes(root.container).filter(painted);
              for (const node of all.filter((item) => item.kind === "text")) {
                const pos = absolute(node);
                assert.ok(
                  pos.x >= -0.01 && pos.x + node.width <= width + 0.01,
                  `${family}/${view}/${scale}/${width}: text ${node.text} width escaped`,
                );
                assert.ok(
                  pos.y >= -0.01 && pos.y + node.height <= height + 0.01,
                  `${family}/${view}/${scale}/${width}: text ${node.text} height escaped natural extent`,
                );
              }
              const text = all
                .filter((item) => item.kind === "text")
                .map((item) => item.text)
                .join(" ");
              assert.ok(
                !text.includes("Home network") &&
                  !text.includes("Ready to pair") &&
                  !text.includes("Connected · secured"),
              );
              const focus = frame.hits.filter((hit) => hit.focusable).map((hit) => hit.focusId);
              assert.ok(
                focus.includes("quick:details:back") && focus.includes("quick:details:settings"),
              );
              assert.ok(
                !focus.some((id) => id?.startsWith("power:") || id?.startsWith("bluetooth:")),
              );
              frames++;
              return { frame, metrics, height, text, focus };
            }
            const unsupported = {
              audio: false,
              brightness: false,
              battery: false,
              bluetooth: false,
              power: false,
              notifications: false,
            };
            const omitted = paint({
              state: { ...ready, snapshot: { ...ready.snapshot, capabilities: unsupported } },
              cachedCapabilities: ready.snapshot.capabilities,
            });
            assert.deepEqual(omitted.focus, ["quick:details:back", "quick:details:settings"]);
            if (view === "audio")
              assert(
                !omitted.text.includes("Output volume") &&
                  !omitted.text.includes("Observed volume"),
              );
            if (view === "power")
              for (const label of ["Log out", "Suspend", "Restart", "Shut down"])
                assert(!omitted.text.includes(label));
            if (view === "audio") {
              for (const kind of ["loading", "error", "unavailable"] as const) {
                const cached = paint({
                  state: { kind, message: "Actual service unavailable" },
                  cachedCapabilities: { ...unsupported, audio: true },
                });
                assert(cached.text.includes("Output volume"));
                assert.deepEqual(cached.focus, ["quick:details:back", "quick:details:settings"]);
              }
              const error = paint({
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
                error.text.includes("Output volume") &&
                  error.text.includes("Actual audio server unavailable"),
              );
            }
            if (view === "network") {
              for (const [transport, name] of [
                ["wifi", "wlan0"],
                ["other", "tun0"],
              ] as const) {
                const typed = paint({
                  state: {
                    ...ready,
                    snapshot: {
                      ...ready.snapshot,
                      network: [{ name, transport, addresses: ["198.51.100.7"] }],
                    },
                  },
                });
                assert(typed.text.includes(name) && typed.text.includes("198.51.100.7"));
              }
              const cached = paint({
                state: { kind: "loading", message: "Reading status" },
                cachedNetworkPresentation: {
                  transport: "wired",
                  label: "Wired network",
                  icon: "ethernet",
                  detail: "Internet status unavailable",
                },
              });
              assert(cached.text.includes("Wired network") && !cached.text.includes("192.0.2.6"));
            }
            if (
              family === "moire" &&
              colorScheme === "dark" &&
              ((width === 520 && scale === 1) || (width === 320 && scale === 1.5))
            )
              fs.writeFileSync(
                path.join(previews, `${view}-unsupported-${width}-scale${scale}.png`),
                png(omitted.frame.pixels, width, omitted.height),
              );
            const normal = paint();
            dimensions.push({
              family,
              colorScheme,
              scale,
              width,
              view,
              height: normal.metrics.height,
            });
            if (view === "network")
              assert.ok(normal.text.includes("eth0") && normal.text.includes("192.0.2.6"));
            if (view === "audio") {
              assert.ok(
                normal.text.includes("Current output") &&
                  normal.text.includes("Observed volume: 67%"),
              );
              assert.ok(
                normal.focus.includes("quick:details:volume") &&
                  normal.focus.includes("quick:details:mute"),
              );
            }
            if (view === "audio" && ready.kind === "ready") {
              const amplified = paint({
                state: {
                  ...ready,
                  snapshot: {
                    ...ready.snapshot,
                    audio: {
                      kind: "ready",
                      volume: 1.4,
                      muted: true,
                      name: "Long observed output description with several words that must wrap beside the selected check without clipping",
                    },
                  },
                },
              });
              assert.ok(amplified.text.includes("Observed volume: 140% · Muted"));
              assert.ok(amplified.text.includes("Observed above 100%"));
              assert.ok(amplified.metrics.height > normal.metrics.height);
            }
            const pending = paint({
              busy: true,
              volumeDraft: { value: 0.9, caption: "Requested 90% · Updating" },
            });
            assert.deepEqual(pending.focus, ["quick:details:back", "quick:details:settings"]);
            if (view === "audio")
              assert.ok(
                pending.text.includes("Requested 90% · Updating") &&
                  pending.text.includes("Observed volume: 67%"),
              );
            if (view === "audio") {
              const editing = paint({ volumeDraft: { value: 0.2, caption: "Requested 20%" } });
              const longCaption = paint({
                volumeDraft: { value: 0.8, caption: "Outcome unknown; ".repeat(40) },
              });
              assert.equal(
                editing.metrics.height,
                normal.metrics.height,
                "draft begins without changing natural panel extent",
              );
              assert.equal(
                pending.metrics.height,
                normal.metrics.height,
                "pending draft owns its status caption without changing extent",
              );
              assert.equal(
                longCaption.metrics.height,
                normal.metrics.height,
                "long draft caption stays in typography-sized slot",
              );
            }
            const unavailable = paint({
              state: { kind: "unavailable", message: "Desktop controls disconnected" },
            });
            assert.deepEqual(unavailable.focus, ["quick:details:back", "quick:details:settings"]);
            const error = paint({ error: "Actual backend error; retry after status refresh" });
            assert.ok(error.text.includes("Actual backend error"));
            if (
              family === "moire" &&
              colorScheme === "dark" &&
              ((width === 520 && scale === 1) || (width === 320 && scale === 1.5))
            ) {
              const result = paint();
              fs.writeFileSync(
                path.join(previews, `${view}-${width}-scale${scale}.png`),
                png(result.frame.pixels, width, result.height),
              );
            }
            renderShell(root, null);
          }
    }

  setUiScaleFactor(1);
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: "dark",
      reducedMotion: true,
    }),
  );
  const brief = measureQuickSettingsDetails(
    { width: 340, view: "network", state: ready, onBack() {} },
    theme,
  );
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") throw new Error("Fixture state");
  const many: DesktopStatusState = {
    ...ready,
    snapshot: {
      ...ready.snapshot,
      network: Array.from({ length: 64 }, (_, index) => ({
        name: `interface${index}`,
        transport: "other",
        addresses: [`2001:db8:${index}::1234`],
      })),
    },
  };
  const extended = measureQuickSettingsDetails(
    { width: 340, view: "network", state: many, onBack() {} },
    theme,
  );
  assert.ok(extended.height > brief.height * 3, "actual address count must grow natural extent");
  const long: DesktopStatusState = {
    ...ready,
    snapshot: {
      ...ready.snapshot,
      audio: {
        kind: "ready",
        volume: 1.4,
        muted: true,
        name: "A very long observed output description that must flow naturally rather than overlap the check or following volume controls",
      },
    },
  };
  assert.ok(
    measureQuickSettingsDetails({ width: 320, view: "audio", state: long, onBack() {} }, theme)
      .height >
      measureQuickSettingsDetails({ width: 520, view: "audio", state: long, onBack() {} }, theme)
        .height,
  );

  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({
    title: "Quick settings details fixture",
    width: 420,
    height: 650,
    decorated: false,
  });
  const model = createVolumeIntent(ready);
  let view: QuickSettingsDetailsView = "audio",
    backs = 0,
    settings = 0,
    starts = 0,
    changes = 0,
    cancels = 0;
  const dispatches: VolumeDispatchIntent[] = [];
  const render = () => {
    const status = model.state;
    const draft =
      status.kind === "editing"
        ? { value: status.value, caption: `Requested ${Math.round(status.value * 100)}%` }
        : status.kind === "pending" || status.kind === "unknown"
          ? {
              value: status.intent.value,
              caption:
                status.kind === "pending"
                  ? `Updating to ${Math.round(status.intent.value * 100)}%…`
                  : "Outcome unknown",
            }
          : undefined;
    return (
      <WidgetThemeProvider theme={theme}>
        <FocusScope id="details" width={420} height={650}>
          <Surface width={420} height={650} fill={theme.foundations.palette.panel}>
            <QuickSettingsDetails
              width={420}
              state={model.observed}
              view={view}
              volumeDraft={draft}
              busy={status.kind === "pending" || status.kind === "unknown"}
              onBack={() => {
                backs++;
                view = "network";
                win.requestRedraw();
              }}
              onSettings={() => {
                settings++;
              }}
              onVolumeStart={() => {
                starts++;
                model.begin();
              }}
              onVolumeChange={(value) => {
                changes++;
                model.change(value);
                win.requestRedraw();
              }}
              onVolumeCommit={() => {
                const intent = model.commit();
                if (intent) dispatches.push(intent);
                win.requestRedraw();
              }}
              onVolumeCancel={() => {
                cancels++;
                model.cancel();
              }}
              onMuteChange={() => {}}
            />
          </Surface>
        </FocusScope>
      </WidgetThemeProvider>
    );
  };
  try {
    win.setContent(render);
    win.mount(backend);
    await Promise.resolve();
    win.tick();
    const native = backend.getWindows()[0];
    assert.ok(native);
    let timeMs = 0;
    const key = (code: number, name: string) => {
      const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
      native.injectKey({ type: "down", code, key: name, modifiers, timeMs: ++timeMs });
      native.injectKey({ type: "up", code, key: name, modifiers, timeMs: ++timeMs });
      win.tick();
    };
    // Public focus traversal reaches Back, actual Mute, then actual volume Slider.
    key(15, "Tab");
    key(15, "Tab");
    key(106, "ArrowRight");
    assert.equal(starts, 1);
    assert.ok(changes >= 1);
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0]?.value, 0.68);
    windowCases++;
    const intent = dispatches[0];
    assert.ok(intent);
    model.observe({
      ...ready,
      snapshot: {
        ...ready.snapshot,
        revision: 8,
        updating: true,
        audio: { kind: "loading", message: "Reading sound" },
      },
    });
    win.requestRedraw();
    win.tick();
    assert.equal(model.state.kind, "pending");
    assert.ok(native.lastFrame && native.lastFrame.some((byte) => byte !== 0));
    // Busy state retains working Back/Settings, with no sound mutations.
    key(15, "Tab");
    key(28, "Enter");
    assert.equal(settings, 1);
    key(15, "Tab");
    key(28, "Enter");
    assert.equal(backs, 1);
    assert.equal(view, "network");
    windowCases++;
    model.result(intent, { kind: "succeeded" });
    model.observe({
      ...ready,
      snapshot: {
        ...ready.snapshot,
        revision: 9,
        audio: { kind: "ready", volume: 0.64, muted: false, name: "Observed studio headphones" },
      },
    });
    view = "audio";
    win.requestRedraw();
    win.tick();
    assert.equal(model.state.kind, "idle");
    assert.equal(dispatches.length, 1);
    assert.equal(cancels, 0);
    windowCases++;
  } finally {
    win.destroy();
    backend.disconnect();
  }
  fs.writeFileSync(
    path.join(previews, "metrics.json"),
    JSON.stringify(
      {
        frames,
        windowCases,
        dimensions,
        scope:
          "actual CPU widget tree/raster and public Window injected keys; native anchoring/backend acceptance pending",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[quick-settings/details] ${frames} theme/scale/size/state frames; ${windowCases} actual Window workflows passed; previews ${previews}`,
  );
} finally {
  setUiScaleFactor(1);
}
