import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
/** Exact popup-frame CPU pixels; no native, audio or hardware qualification. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import React, { type ReactNode } from "react";
import {
  createShellRoot,
  renderShell,
  rasterize,
  Group,
  Rect,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
} from "@moire/react-host";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
} from "@moire/ui";
import { THEME_FAMILIES } from "@moire/theme";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import { QuickSettings, DesktopPopup, desktopPopupGeometry } from "./QuickSettings";
import { measureQuickSettingsContent } from "./QuickSettingsContent";
import { measureQuickSettingsDetails } from "./QuickSettingsDetails";
import { NotificationsTray } from "./NotificationsTray";
import { measureNotificationTrayContent } from "./NotificationTrayContent";

const directory =
  process.env.MOIRE_POPUP_FRAME_CAPTURE_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "moire-popup-frame-"));
fs.mkdirSync(directory, { recursive: true });
const background = 0xff173841;
const noop = () => {};
const state: DesktopStatusState = {
  kind: "ready",
  owner: ":1.42",
  snapshot: {
    revision: 7,
    updating: false,
    audio: { kind: "ready", name: "Observed local output", volume: 0.67, muted: false },
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
    network: Array.from({ length: 12 }, (_, index) => ({
      name: `interface${index}`,
      transport: "wired",
      addresses: [`192.0.2.${index + 1}`, `2001:db8::${index + 1}`],
    })),
    notificationsAvailable: true,
    doNotDisturb: false,
    notices: Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      revision: 1,
      appName: "Owned fixture",
      summary: "Observed completed work",
      body: "Actual local fixture detail. ".repeat(12),
      closed: false,
      createdAt: 1_790_000_000_000,
      closedAt: null,
      actions: [{ key: "open", label: "Open" }],
    })),
  },
};

function png(bytes: Uint8Array, width: number, height: number): Buffer {
  const crc = (data: Buffer) => {
    let value = 0xffff_ffff;
    for (const byte of data) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffff_ffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const lines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4,
        to = y * (width * 4 + 1) + x * 4 + 1;
      lines[to] = bytes[from + 2]!;
      lines[to + 1] = bytes[from + 1]!;
      lines[to + 2] = bytes[from]!;
      lines[to + 3] = bytes[from + 3]!;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(lines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await installUiFonts();
let frames = 0,
  samples = 0,
  mismatchCount = 0;
const findings: Array<{
  case: string;
  backend: string;
  x: number;
  y: number;
  region: string;
  actual: number;
  expected: number;
}> = [];
const capturePins: Array<{ name: string; width: number; height: number }> = [];
const byView: Record<string, { frames: number; samples: number; corners: number; border: number }> =
  {};
try {
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const) {
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { themeFamily: family, colorScheme, reducedMotion: true }),
      );
      for (const scale of [1, 1.5])
        for (const [width, height] of [
          [1024, 768],
          [360, 640],
        ] as const) {
          setUiScaleFactor(scale);
          const anchor = { x: width - 90, y: height - 40, width: 30, height: 30 };
          const popupWidth = desktopPopupGeometry(width, height, anchor, 0).width;
          const common = {
            width: popupWidth,
            state,
            onBack: noop,
            onSettings: noop,
            onVolumeChange: noop,
            onMuteChange: noop,
            onDoNotDisturbChange: noop,
          };
          for (const view of [
            "main",
            "audio",
            "network",
            "bluetooth",
            "power",
            "notifications",
          ] as const) {
            const notificationProps = {
              state,
              width: popupWidth,
              height: 0,
              now: 1_790_000_100_000,
              view: "active" as const,
              scrollY: 0,
              onScroll: noop,
              busy: false,
              error: "",
              onViewChange: noop,
              onClearAll: noop,
              onDismiss: noop,
              onInvokeAction: noop,
            };
            const natural =
              view === "main"
                ? measureQuickSettingsContent(common, theme).height
                : view === "notifications"
                  ? Math.max(
                      240 * scale,
                      measureNotificationTrayContent(notificationProps, theme).height,
                    )
                  : measureQuickSettingsDetails({ ...common, view }, theme).height;
            const geometry = desktopPopupGeometry(width, height, anchor, natural);
            const wrap = (children: ReactNode) => (
              <WidgetThemeProvider theme={theme}>
                <Group width={width} height={height}>
                  <Rect width={width} height={height} fill={background} />
                  {children}
                </Group>
              </WidgetThemeProvider>
            );
            const referenceRoot = createShellRoot(),
              root = createShellRoot();
            renderShell(
              referenceRoot,
              wrap(
                <DesktopPopup
                  screenW={width}
                  screenH={height}
                  anchor={anchor}
                  naturalHeight={natural}
                  scope="frame-reference"
                  onDismiss={noop}
                >
                  {null}
                </DesktopPopup>,
              ),
            );
            const referenceDirect = rasterize(referenceRoot.container, width, height).pixels;
            const referenceRetained = new RetainedSoftwareRenderer().render(
              new RetainedSceneRenderer().render(referenceRoot.container, { width, height }),
            ).pixels;
            const retainedScene = new RetainedSceneRenderer(),
              retained = new RetainedSoftwareRenderer();
            const radius = 16 * scale;
            const borderWidth = 1;
            const maxScroll = Math.max(0, natural - geometry.height);
            for (const [position, scrollY] of [
              ["top", 0],
              ["middle", maxScroll / 2],
              ["end", maxScroll],
            ] as const) {
              const caseName = `${family}-${colorScheme}-${width}x${height}-scale${scale}-${view}-${position}`;
              renderShell(
                root,
                wrap(
                  view === "notifications" ? (
                    <NotificationsTray
                      {...notificationProps}
                      screenW={width}
                      screenH={height}
                      anchor={anchor}
                      open
                      onClose={noop}
                      scrollY={scrollY}
                    />
                  ) : (
                    <QuickSettings
                      {...common}
                      open
                      screenW={width}
                      screenH={height}
                      anchor={anchor}
                      view={view}
                      onViewChange={noop}
                      scrollY={scrollY}
                      onScroll={noop}
                      onDismiss={noop}
                    />
                  ),
                ),
              );
              const direct = rasterize(root.container, width, height).pixels;
              const retainedPixels = retained.render(
                retainedScene.render(root.container, { width, height }),
              ).pixels;
              const mismatchBefore = mismatchCount;
              for (const [backend, actualBytes, referenceBytes] of [
                ["direct", direct, referenceDirect],
                ["retained", retainedPixels, referenceRetained],
              ] as const) {
                const counts = (byView[`${view}/${backend}`] ??= {
                  frames: 0,
                  samples: 0,
                  corners: 0,
                  border: 0,
                });
                const actual = new Uint32Array(
                  actualBytes.buffer,
                  actualBytes.byteOffset,
                  actualBytes.byteLength / 4,
                );
                const expected = new Uint32Array(
                  referenceBytes.buffer,
                  referenceBytes.byteOffset,
                  referenceBytes.byteLength / 4,
                );
                let testedCorners = 0,
                  testedBorder = 0;
                for (
                  let y = Math.floor(geometry.y);
                  y < Math.ceil(geometry.y + geometry.height);
                  y++
                )
                  for (
                    let x = Math.floor(geometry.x);
                    x < Math.ceil(geometry.x + geometry.width);
                    x++
                  ) {
                    const localX = x + 0.5 - geometry.x,
                      localY = y + 0.5 - geometry.y;
                    const horizontalEdge = Math.min(localX, geometry.width - localX),
                      verticalEdge = Math.min(localY, geometry.height - localY);
                    const corner =
                      horizontalEdge < radius &&
                      verticalEdge < radius &&
                      Math.hypot(radius - horizontalEdge, radius - verticalEdge) > radius + 0.5;
                    const border =
                      (horizontalEdge >= radius + 1 && verticalEdge < borderWidth) ||
                      (verticalEdge >= radius + 1 && horizontalEdge < borderWidth);
                    if (!corner && !border) continue;
                    if (corner) testedCorners++;
                    else testedBorder++;
                    samples++;
                    counts.samples++;
                    const offset = y * width + x;
                    if (actual[offset] !== expected[offset]) {
                      mismatchCount++;
                      if (corner) counts.corners++;
                      else counts.border++;
                      if (mismatchCount === 1)
                        console.error(
                          `[popup-frame] first mismatch ${caseName} ${backend} at ${x},${y} outside=${corner} actual=${actual[offset]?.toString(16)} expected=${expected[offset]?.toString(16)}`,
                        );
                      if (findings.length < 20)
                        findings.push({
                          case: caseName,
                          backend,
                          x,
                          y,
                          region: corner ? "outside-rounded-corner" : "straight-frame-border",
                          actual: actual[offset]!,
                          expected: expected[offset]!,
                        });
                    }
                  }
                assert(testedCorners > 8 && testedBorder > 20, "nonempty corner and border oracle");
                frames++;
                counts.frames++;
              }
              if (
                (family === "moire" && colorScheme === "dark" && position === "top") ||
                (mismatchCount > mismatchBefore && capturePins.length < 30)
              ) {
                fs.writeFileSync(
                  path.join(directory, `${caseName}.png`),
                  png(direct, width, height),
                );
                fs.writeFileSync(
                  path.join(directory, `${caseName}-reference.png`),
                  png(referenceDirect, width, height),
                );
                capturePins.push({ name: caseName, width, height });
              }
            }
            renderShell(root, null);
            renderShell(referenceRoot, null);
          }
        }
    }
} finally {
  setUiScaleFactor(1);
  fs.writeFileSync(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        frames,
        samples,
        mismatchCount,
        byView,
        findings,
        captures: capturePins,
        scope:
          "actual popup CPU scene/direct+retained pixels against same production rounded frame; no native or hardware qualification",
      },
      null,
      2,
    ),
  );
}
assert.equal(
  mismatchCount,
  0,
  `popup content altered ${mismatchCount} corner/border pixels; bounded findings ${path.join(directory, "result.json")}`,
);
console.log(
  `[popup-frame] ${frames} actual direct/retained CPU frames, ${samples} corner/border samples passed; captures ${directory}`,
);
