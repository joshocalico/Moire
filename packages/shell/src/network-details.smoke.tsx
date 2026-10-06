import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
/** Observed Wi-Fi scenes and actual public Window callbacks; no network service is contacted. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { deflateSync } from "node:zlib";
import React from "react";
import { createShellRoot, renderShell, rasterize, type SceneNode } from "@moire/react-host";
import {
  Surface,
  WidgetThemeProvider,
  Window,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  writeClipboardText,
  type PlatformWindowOpts,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { THEME_FAMILIES } from "@moire/theme";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import {
  WIFI_UNAVAILABLE,
  type DesktopWifi,
  type WifiAccessPoint,
} from "@moire/system-management/network-status";
import {
  QuickSettingsDetails,
  measureQuickSettingsDetails,
  type QuickSettingsDetailsProps,
} from "./QuickSettingsDetails";
import { networkPresentation } from "./network-presentation";
const all = (n: SceneNode): SceneNode[] => [n, ...n.children.flatMap(all)];
function absoluteY(node: SceneNode) {
  let y = 0;
  for (let n: SceneNode | null = node; n; n = n.parent)
    y += n.y + (typeof n.translateY === "number" ? n.translateY : (n.translateY?.get() ?? 0));
  return y;
}
const ap: WifiAccessPoint = {
  id: "/ap/1",
  ssid: "Observed studio Wi-Fi",
  strength: 67,
  security: "wpa-psk",
  connected: false,
};
const base: Extract<DesktopWifi, { kind: "ready" }> = {
  kind: "ready",
  policy: "interactive",
  enabled: true,
  hardwareEnabled: true,
  canConnect: true,
  canScan: true,
  connectivity: "portal",
  connection: { kind: "active", name: "Observed wired profile", transport: "wired" },
  accessPoints: [
    ap,
    { ...ap, id: "/ap/open", ssid: "Observed guest network", security: "open" },
    { ...ap, id: "/ap/enterprise", ssid: "Observed enterprise", security: "unsupported" },
  ],
  operation: { kind: "idle" },
};
const state = (wifi: DesktopWifi): DesktopStatusState => ({
  kind: "ready",
  owner: ":1.40",
  snapshot: {
    revision: 1,
    wifi,
    bluetooth: BLUETOOTH_UNAVAILABLE,
    battery: BATTERY_UNAVAILABLE,
    network: [{ name: "eth0", transport: "wired", addresses: ["192.0.2.9"] }],
    audio: { kind: "unavailable", message: "No audio fixture" },
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
});
class Retained extends HeadlessPlatform {
  override createWindow(opts: PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), { presentScene: () => false });
  }
}
const previews =
  process.env.MOIRE_NETWORK_PREVIEW_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "moire-network-preview-"));
fs.mkdirSync(previews, { recursive: true });
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
await installUiFonts();
let frames = 0,
  workflows = 0;
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
            accent: "#b794f4",
          }),
        );
        const variants: readonly {
          name: string;
          wifi: DesktopWifi;
          selection?: WifiAccessPoint;
          password?: string;
        }[] = [
          { name: "observed", wifi: base },
          { name: "password", wifi: base, selection: ap, password: "Synthetic8" },
          {
            name: "readonly",
            wifi: { ...base, policy: "readonly", canConnect: false, canScan: false },
            selection: ap,
          },
          { name: "off", wifi: { ...base, enabled: false } },
          { name: "blocked", wifi: { ...base, hardwareEnabled: false } },
          {
            name: "pending",
            wifi: { ...base, operation: { kind: "connecting", ssid: ap.ssid, cancellable: true } },
            selection: ap,
            password: "Synthetic8",
          },
          {
            name: "error",
            wifi: { ...base, operation: { kind: "error", message: "Observed connection failed" } },
            selection: ap,
            password: "Synthetic8",
          },
          {
            name: "unknown",
            wifi: {
              ...base,
              operation: { kind: "unknown", message: "Connection outcome unknown" },
            },
          },
          {
            name: "long",
            wifi: { ...base, accessPoints: [{ ...ap, ssid: "Long observed network ".repeat(10) }] },
          },
          { name: "unavailable", wifi: WIFI_UNAVAILABLE },
        ];
        for (const v of variants) {
          const props: QuickSettingsDetailsProps = {
            width,
            view: "network",
            state: state(v.wifi),
            wifiSelection: v.selection,
            wifiPassword: v.password,
            onBack() {},
            onWifiSelect() {},
            onWifiPasswordChange() {},
            onWifiConnect() {},
            onWifiCancel() {},
            onWifiRefresh() {},
            onWifiSelectionCancel() {},
          };
          const height = Math.ceil(measureQuickSettingsDetails(props, theme).height);
          assert(height > 0 && Number.isFinite(height));
          const root = createShellRoot();
          renderShell(
            root,
            <WidgetThemeProvider theme={theme}>
              <Surface width={width} height={height} fill={theme.foundations.palette.panel}>
                <QuickSettingsDetails {...props} />
              </Surface>
            </WidgetThemeProvider>,
          );
          const nodes = all(root.container),
            texts = nodes
              .filter((n) => n.kind === "text")
              .map((n) => n.text ?? "")
              .join(" ")
              .replace(/\s+/g, " ");
          assert(!texts.includes("Synthetic8"), "secret never enters rendered text nodes");
          const frame = rasterize(root.container, width, height);
          assert(frame.pixels.some((v) => v !== 0));
          for (const hit of frame.hits.filter((h) => h.focusable)) {
            assert(hit.x >= 0 && hit.x + hit.width <= width + 1);
            assert(hit.y >= 0 && hit.y + hit.height <= height + 1);
          }
          if (v.name === "readonly") {
            assert(texts.includes("System policy allows network status only"));
            assert(!frame.hits.some((h) => h.focusable && h.focusId === "quick:wifi:connect"));
            assert(!texts.includes("•"));
          }
          if (v.name === "password") {
            assert(texts.includes("•".repeat(10)));
            const localHeading = nodes.find(
              (n) => n.kind === "text" && n.text === "LOCAL ADDRESSES",
            );
            assert(localHeading);
            for (const [id, label] of [
              ["quick:wifi:selection-cancel", "Cancel"],
              ["quick:wifi:connect", "Connect"],
            ]) {
              const hit = frame.hits.find((h) => h.focusId === id);
              const glyph = nodes.find((n) => n.kind === "text" && n.text === label);
              assert(hit && glyph);
              assert(
                absoluteY(glyph) >= hit.y &&
                  absoluteY(glyph) + glyph.height <= hit.y + hit.height + 1,
                "action label fully contained before following card",
              );
              assert(
                hit.y + hit.height <= absoluteY(localHeading),
                "stationary actions cannot overlap local address card",
              );
            }
          }
          if (v.name === "pending")
            assert(!frame.hits.some((h) => h.focusable && h.focusId === "quick:wifi:connect"));
          if (v.name === "observed") {
            assert(texts.includes("Sign-in required for Internet access"));
            assert(texts.includes("eth0: 192.0.2.9"));
          }
          if (
            family === "moire" &&
            scheme === "dark" &&
            ((width === 320 && scale === 1.5) || (width === 520 && scale === 1)) &&
            ["observed", "password", "readonly", "pending", "error"].includes(v.name)
          )
            fs.writeFileSync(
              path.join(previews, `${v.name}-${width}-${scale}.png`),
              png(frame.pixels, width, height),
            );
          renderShell(root, null);
          frames++;
        }
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
    let wifi: DesktopWifi = base,
      selection: WifiAccessPoint | undefined,
      password = "",
      connects = 0,
      cancels = 0,
      refreshes = 0,
      backs = 0;
    const width = 360,
      height = 1000;
    const backend = retained ? new Retained() : new HeadlessPlatform();
    await backend.connect();
    const win = new Window({ title: "Synthetic Wi-Fi workflow", width, height });
    const props = (): QuickSettingsDetailsProps => ({
      width,
      view: "network",
      state: state(wifi),
      wifiSelection: selection,
      wifiPassword: password,
      onBack() {
        backs++;
      },
      onWifiSelect(next) {
        selection = next;
        password = "";
        win.requestRedraw();
      },
      onWifiPasswordChange(next) {
        password = next;
      },
      onWifiConnect() {
        connects++;
      },
      onWifiCancel() {
        cancels++;
      },
      onWifiRefresh() {
        refreshes++;
      },
      onWifiSelectionCancel() {
        selection = undefined;
        password = "";
        win.requestRedraw();
      },
    });
    const tree = () => (
      <WidgetThemeProvider theme={theme}>
        <Surface width={width} height={height}>
          <QuickSettingsDetails {...props()} />
        </Surface>
      </WidgetThemeProvider>
    );
    const paint = () => {
      const root = createShellRoot();
      renderShell(root, tree());
      const frame = rasterize(root.container, width, height);
      renderShell(root, null);
      return frame;
    };
    try {
      win.setContent(tree);
      win.mount(backend);
      await Promise.resolve();
      win.tick();
      const native = backend.getWindows()[0];
      assert(native);
      let time = 0;
      const click = (id: string) => {
        const hit = paint().hits.find((h) => h.focusable && h.focusId === id);
        assert(hit, `reachable ${id}`);
        const x = hit.x + hit.width / 2,
          y = hit.y + hit.height / 2;
        for (const type of ["down", "up"] as const)
          native.injectPointer({ type, x, y, button: "left", timeMs: ++time });
        win.tick();
      };
      const key = (code: number, name: string, text?: string, ctrl = false) => {
        for (const type of ["down", "up"] as const)
          native.injectKey({
            type,
            code,
            key: name,
            text,
            modifiers: { ctrl, shift: false, alt: false, meta: false },
            timeMs: ++time,
          });
        win.tick();
      };
      click(`quick:wifi:ap:${ap.id}`);
      assert.equal(selection?.id, ap.id);
      const field = paint().hits.find((h) => h.focusable && h.focusId?.startsWith("text-field:"));
      assert(field);
      for (const type of ["down", "up"] as const)
        native.injectPointer({
          type,
          button: "left",
          x: field.x + 10,
          y: field.y + field.height / 2,
          timeMs: ++time,
        });
      for (const c of "Synthetic8") key(30, c, c);
      assert.equal(password, "Synthetic8");
      key(28, "Enter");
      assert.equal(connects, 1);
      // Paste is allowed to edit the ephemeral secret, but unsupported backend values never submit.
      for (const invalid of ["synthetíc8", "synthetic\u0001"]) {
        await writeClipboardText(invalid);
        key(30, "a", undefined, true);
        key(47, "v", undefined, true);
        await new Promise<void>((resolve) => setImmediate(resolve));
        win.tick();
        assert.equal(password, invalid);
        assert(!paint().hits.some((h) => h.focusable && h.focusId === "quick:wifi:connect"));
        key(28, "Enter");
        assert.equal(connects, 1, "unsupported pasted value cannot clear/submit the draft");
        assert.equal(password, invalid);
      }
      wifi = { ...base, operation: { kind: "connecting", ssid: ap.ssid, cancellable: true } };
      win.requestRedraw();
      win.tick();
      click("quick:wifi:selection-cancel");
      assert.equal(cancels, 1);
      wifi = { ...base, operation: { kind: "connecting", ssid: ap.ssid, cancellable: false } };
      win.requestRedraw();
      win.tick();
      assert(!paint().hits.some((h) => h.focusable && h.focusId === "quick:wifi:selection-cancel"));
      wifi = { ...base, policy: "readonly", canScan: false, canConnect: false };
      selection = undefined;
      password = "";
      win.requestRedraw();
      win.tick();
      click("quick:wifi:refresh");
      assert.equal(refreshes, 1);
      selection = ap;
      win.requestRedraw();
      win.tick();
      assert(!paint().hits.some((h) => h.focusable && h.focusId === "quick:wifi:connect"));
      click("quick:wifi:selection-cancel");
      assert.equal(selection, undefined);
      assert.equal(password, "");
      click("quick:details:back");
      assert.equal(backs, 1);
      assert(native.lastFrame);
      workflows++;
    } finally {
      win.destroy();
      await backend.disconnect();
    }
  }
assert.equal(
  networkPresentation([{ name: "eth0", transport: "wired", addresses: ["192.0.2.9"] }], base)
    .detail,
  "Sign-in required for Internet access",
);
console.log(
  `Network details: ${frames} measured CPU scenes; ${workflows} direct/retained public Window workflows; previews ${previews}`,
);
