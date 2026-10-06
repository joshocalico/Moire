/** Synthetic Bluetooth states through public Window input; no service/device access. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { deflateSync } from "node:zlib";
import { createShellRoot, renderShell, rasterize, type SceneNode } from "@moire/react-host";
import {
  FocusScope,
  ScrollArea,
  Surface,
  WidgetThemeProvider,
  Window,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindowOpts,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import {
  BLUETOOTH_UNAVAILABLE,
  parseBluetoothId,
  type DesktopBluetooth,
  type BluetoothDevice,
  type BluetoothPairingState,
  type BluetoothNearbyDevice,
} from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import { QuickSettingsContent } from "./QuickSettingsContent";
import {
  QuickSettingsDetails,
  measureQuickSettingsDetails,
  type QuickSettingsDetailsProps,
} from "./QuickSettingsDetails";
import {
  bluetoothSummary,
  bluetoothInteractionScope,
  activeBluetoothTrust,
} from "./BluetoothDetailsContent";

const previews = process.env.MOIRE_BLUETOOTH_PREVIEW_DIR;
if (previews) fs.mkdirSync(previews, { recursive: true });
function writePng(file: string, pixels: Uint8Array, width: number, height: number) {
  const crc = (bytes: Buffer) => {
    let result = 0xffffffff;
    for (const byte of bytes) {
      result ^= byte;
      for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0);
    }
    return (result ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, bytes: Buffer) => {
    const type = Buffer.from(name),
      length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE(crc(Buffer.concat([type, bytes])));
    return Buffer.concat([length, type, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4,
        to = y * (width * 4 + 1) + x * 4 + 1;
      raw[to] = pixels[from + 2]!;
      raw[to + 1] = pixels[from + 1]!;
      raw[to + 2] = pixels[from]!;
      raw[to + 3] = pixels[from + 3]!;
    }
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-bluetooth-ui-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = directory;
process.env.XDG_CONFIG_HOME = path.join(directory, "config");
process.env.XDG_DATA_HOME = path.join(directory, "data");
const adapterId = parseBluetoothId("adapter-a");
const adapter = { id: adapterId, name: "Laptop Bluetooth", powered: true };
const pairingAdapterId = parseBluetoothId("pairing-adapter-a");
const pairingAdapter = { ...adapter, id: pairingAdapterId };
const devices: readonly BluetoothDevice[] = [
  {
    id: parseBluetoothId("device-a"),
    adapterId,
    name: "Studio headphones",
    address: "00:11:22:33:44:55",
    paired: true,
    trusted: true,
    connected: false,
  },
  {
    id: parseBluetoothId("device-b"),
    adapterId,
    name: "Studio headphones",
    address: "00:11:22:33:44:66",
    paired: true,
    trusted: true,
    connected: true,
  },
  {
    id: parseBluetoothId("device-c"),
    adapterId,
    name: "A long paired device name that must wrap within a compact popup without hiding its address",
    address: "00:11:22:33:44:77",
    paired: true,
    trusted: false,
    connected: false,
  },
];
const ready = (
  extra: Partial<Extract<DesktopBluetooth["status"], { kind: "ready" }>> = {},
): DesktopBluetooth => ({
  status: { kind: "ready", policy: "interactive", adapters: [adapter], devices, ...extra },
  operation: { kind: "idle" },
});
const nearby: BluetoothNearbyDevice = {
  id: parseBluetoothId("nearby-a"),
  adapterId: pairingAdapterId,
  name: "Nearby keyboard",
  address: "11:22:33:44:55:66",
  paired: false,
};
const lease = {
  id: parseBluetoothId("lease-a"),
  adapterId: pairingAdapterId,
  expiresAt: Date.now() + 30_000,
};
const attemptId = parseBluetoothId("attempt-a"),
  promptId = parseBluetoothId("prompt-a");
const pairingReady = (
  extra: Partial<Extract<BluetoothPairingState, { kind: "ready" }>> = {},
): Extract<BluetoothPairingState, { kind: "ready" }> => ({
  kind: "ready",
  adapters: [pairingAdapter],
  devices: [],
  lease: null,
  discovery: "idle",
  attempt: { kind: "idle" },
  prompt: null,
  message: "",
  ...extra,
});
const pairingState = (pairing: BluetoothPairingState): DesktopBluetooth => ({
  ...ready({ policy: "readonly", devices: [] }),
  pairing,
});
const searchingState = () =>
  pairingState(pairingReady({ lease, discovery: "scanning", devices: [nearby] }));
const promptState = (kind: "confirmation" | "authorization" | "display-code"): DesktopBluetooth =>
  pairingState(
    pairingReady({
      lease,
      discovery: "scanning",
      devices: [nearby],
      attempt: { kind: "pending", id: attemptId, device: nearby },
      prompt:
        kind === "authorization"
          ? { kind, id: promptId, attemptId, deviceId: nearby.id }
          : kind === "confirmation"
            ? {
                kind,
                id: promptId,
                attemptId,
                deviceId: nearby.id,
                code: "001234",
              }
            : { kind, id: promptId, attemptId, deviceId: nearby.id, code: "001234", entered: 2 },
    }),
  );
const entryState = (
  kind: "pin-entry" | "passkey-entry",
  id = promptId,
  inputEnabled = true,
): DesktopBluetooth =>
  pairingState(
    pairingReady({
      lease,
      discovery: "scanning",
      devices: [nearby],
      attempt: { kind: "pending", id: attemptId, device: nearby },
      prompt: { kind, id, attemptId, deviceId: nearby.id },
      inputEnabled,
    }),
  );
const challengeId = parseBluetoothId("trust-challenge-a");
const trustState = (
  operation: Extract<NonNullable<DesktopBluetooth["trust"]>, { kind: "ready" }>["operation"],
  trusted = false,
  connected = false,
): DesktopBluetooth => ({
  ...ready({ devices: [{ ...devices[0]!, trusted, connected }] }),
  trust: { kind: "ready", operation },
});
const variants: Record<string, DesktopBluetooth> = {
  observed: ready(),
  "no-callback": ready(),
  readonly: ready({ policy: "readonly" }),
  off: ready({ adapters: [{ ...adapter, powered: false }] }),
  empty: ready({ devices: [] }),
  pending: { ...ready(), operation: { kind: "pending", id: devices[0]!.id, connected: true } },
  unknown: {
    ...ready(),
    operation: {
      kind: "unknown",
      id: devices[0]!.id,
      connected: true,
      message: "Device disappeared before readback",
    },
  },
  error: {
    ...ready(),
    operation: {
      kind: "error",
      id: devices[0]!.id,
      connected: true,
      message: "Connection was denied",
    },
  },
  loading: {
    status: { kind: "loading", supported: true, message: "Reading device status" },
    operation: { kind: "idle" },
  },
  unavailable: BLUETOOTH_UNAVAILABLE,
  failed: {
    status: { kind: "error", supported: true, message: "Device status read failed" },
    operation: { kind: "idle" },
  },
  "pair-idle": pairingState(pairingReady()),
  "pair-no-callback": searchingState(),
  "pair-nearby": searchingState(),
  "pair-confirmation": promptState("confirmation"),
  "pair-authorization": promptState("authorization"),
  "pair-display": promptState("display-code"),
  "pair-pending": pairingState(
    pairingReady({
      lease,
      discovery: "scanning",
      attempt: { kind: "pending", id: attemptId, device: nearby },
    }),
  ),
  "pair-unknown": pairingState(
    pairingReady({
      discovery: "unknown",
      attempt: {
        kind: "unknown",
        id: attemptId,
        device: nearby,
        message: "BlueZ owner disappeared",
      },
    }),
  ),
  "pair-complete": pairingState(
    pairingReady({
      attempt: {
        kind: "complete",
        id: attemptId,
        device: nearby,
        message: "Paired. Trust was not changed.",
      },
    }),
  ),
  "pair-pin": entryState("pin-entry"),
  "pair-passkey": entryState("passkey-entry"),
  "pair-input-disabled": entryState("pin-entry", promptId, false),
  "pair-input-no-callback": entryState("passkey-entry"),
  "trust-idle": trustState({ kind: "idle" }),
  "trust-grant": trustState({
    kind: "confirmation",
    id: devices[0]!.id,
    challengeId,
    trusted: true,
    expiresAt: Date.now() + 30_000,
  }),
  "trust-remove": trustState(
    {
      kind: "confirmation",
      id: devices[0]!.id,
      challengeId,
      trusted: false,
      expiresAt: Date.now() + 30_000,
    },
    true,
    true,
  ),
  "trust-pending": trustState({ kind: "pending", id: devices[0]!.id, trusted: true }),
  "trust-unknown": trustState({
    kind: "unknown",
    id: devices[0]!.id,
    trusted: false,
    message: "Trust readback was lost",
  }),
  "trust-revoked": trustState({ kind: "idle" }, false, true),
};
const status = (bluetooth: DesktopBluetooth): DesktopStatusState => ({
  kind: "ready",
  owner: ":1.52",
  snapshot: {
    revision: 1,
    bluetooth,
    battery: BATTERY_UNAVAILABLE,
    wifi: WIFI_UNAVAILABLE,
    network: [],
    audio: { kind: "unavailable", message: "Audio unavailable" },
    capabilities: {
      audio: false,
      battery: false,
      bluetooth:
        bluetooth.status.kind === "ready" ||
        ((bluetooth.status.kind === "loading" || bluetooth.status.kind === "error") &&
          bluetooth.status.supported),
      brightness: false,
      power: false,
      notifications: false,
    },
    updating: false,
    doNotDisturb: false,
    notificationsAvailable: false,
    notices: [],
  },
});
const all = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(all)];
class Retained extends HeadlessPlatform {
  override createWindow(opts: PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), { presentScene: () => false });
  }
}
await installUiFonts();
let frames = 0,
  workflows = 0;
try {
  assert.equal(bluetoothSummary(ready()), "1 known device connected");
  assert.equal(bluetoothSummary(variants.off), "Bluetooth is off");
  assert.equal(bluetoothSummary(variants.empty), "No paired devices");
  assert.equal(bluetoothSummary(), "Bluetooth unavailable");
  for (const scale of [1, 1.5])
    for (const scheme of ["dark", "light"] satisfies ("dark" | "light")[])
      for (const width of [360, 520]) {
        if (
          process.env.MOIRE_BLUETOOTH_UI_CASE &&
          process.env.MOIRE_BLUETOOTH_UI_CASE !== `${scale}:${scheme}:${width}`
        )
          continue;
        setUiScaleFactor(scale);
        const theme = createPersonalizedWidgetTheme(
          discoverPersonalization("linux", {
            themeFamily: "moire",
            colorScheme: scheme,
            reducedMotion: true,
          }),
        );
        for (const [name, bluetooth] of Object.entries(variants)) {
          const props: QuickSettingsDetailsProps = {
            width,
            state: status(bluetooth),
            view: "bluetooth" satisfies "bluetooth",
            onBack() {},
            onBluetoothChange: name === "no-callback" ? undefined : () => {},
            onBluetoothRefresh() {},
            onBluetoothDiscoveryStart: name === "pair-no-callback" ? undefined : () => {},
            onBluetoothDiscoveryStop: name === "pair-no-callback" ? undefined : () => {},
            onBluetoothPair: name === "pair-no-callback" ? undefined : () => {},
            onBluetoothPairCancel: name === "pair-no-callback" ? undefined : () => {},
            onBluetoothPromptResponse: name === "pair-no-callback" ? undefined : () => {},
            onBluetoothInputResponse: name === "pair-input-no-callback" ? undefined : () => {},
            onBluetoothTrustRequest() {},
            onBluetoothTrustConfirm() {},
            onBluetoothTrustCancel() {},
          };
          const measured = measureQuickSettingsDetails(props, theme);
          assert.ok(measured.height > 0 && Number.isFinite(measured.height));
          const root = createShellRoot();
          renderShell(
            root,
            <WidgetThemeProvider theme={theme}>
              <QuickSettingsDetails {...props} />
            </WidgetThemeProvider>,
          );
          const frame = rasterize(root.container, width, Math.ceil(measured.height));
          const text = all(root.container)
            .filter((n) => n.kind === "text")
            .map((n) => n.text ?? "")
            .join(" ");
          assert.ok(!text.includes("Pairing and device selection are unavailable"));
          assert.ok(
            !all(root.container).some((n) => n.focusId?.startsWith("toggle:")),
            "no pretend radio toggle",
          );
          const changes = frame.hits.filter(
            (hit) => hit.focusId?.startsWith("quick:bluetooth:device:") && hit.focusable,
          );
          const actionable =
            name === "observed" || name === "error" ? 2 : name === "trust-revoked" ? 1 : 0;
          assert.equal(changes.length, actionable, name);
          assert.equal(
            new Set(changes.map((hit) => hit.focusId)).size,
            actionable,
            "same-name device actions remain distinct",
          );
          if (bluetooth.status.kind === "ready") {
            for (const device of bluetooth.status.devices)
              assert.ok(text.includes(device.address), "complete address retained");
            if (name === "readonly")
              assert.ok(text.includes("System policy allows Bluetooth status only"));
            if (name === "off") assert.ok(text.includes("Radio off"));
            if (name === "pending") assert.ok(text.includes("Connecting; waiting"));
            if (name === "unknown") assert.ok(text.includes("Connection outcome unknown"));
            if (name === "observed") assert.ok(text.includes("Not trusted"));
          } else
            assert.ok(
              !text.includes("00:11:22:33:44:"),
              "unavailable never retains prior device details",
            );
          if (name.startsWith("pair-")) {
            const hits = frame.hits.filter((hit) => hit.focusable);
            assert.equal(
              hits.filter(
                (hit) =>
                  hit.focusId?.startsWith("quick:bluetooth:discover:") &&
                  hit.focusId !== "quick:bluetooth:discover:stop",
              ).length,
              name === "pair-idle" || name === "pair-complete" ? 1 : 0,
            );
            assert.equal(
              hits.filter((hit) => hit.focusId === `quick:bluetooth:pair:${nearby.id}`).length,
              name === "pair-nearby" ? 1 : 0,
            );
            if (name === "pair-confirmation")
              assert.ok(text.includes("001234") && text.includes("both devices"));
            if (name === "pair-authorization") assert.ok(text.includes("does not grant trust"));
            if (name === "pair-display") assert.ok(text.includes("2 of 6 digits entered"));
            if (name === "pair-unknown") assert.ok(text.includes("Pairing outcome unknown"));
            if (
              ![
                "pair-confirmation",
                "pair-authorization",
                "pair-display",
                "pair-pin",
                "pair-passkey",
                "pair-input-disabled",
                "pair-input-no-callback",
              ].includes(name)
            )
              assert.ok(text.includes("PIN entry and service authorization are unsupported"));
            if (
              [
                "pair-pin",
                "pair-passkey",
                "pair-input-disabled",
                "pair-input-no-callback",
              ].includes(name)
            ) {
              assert.equal(
                hits.filter((hit) => hit.focusId?.startsWith("text-field:")).length,
                name === "pair-pin" || name === "pair-passkey" ? 1 : 0,
              );
              assert.equal(
                hits.filter((hit) => hit.focusId === `quick:bluetooth:prompt:submit:${promptId}`)
                  .length,
                0,
                "empty draft cannot submit",
              );
            }
          }
          if (name.startsWith("trust-")) {
            const hits = frame.hits.filter((hit) => hit.focusable);
            assert.equal(
              hits.filter((hit) => hit.focusId?.startsWith("quick:bluetooth:trust:request:"))
                .length,
              name === "trust-idle" || name === "trust-revoked" ? 1 : 0,
            );
            if (name === "trust-grant")
              assert.ok(text.includes("automatically") && text.includes("recognize"));
            if (name === "trust-remove") assert.ok(text.includes("does not disconnect"));
            if (name === "trust-unknown") assert.ok(text.includes("Trust outcome unknown"));
          }
          for (const hit of frame.hits.filter((h) => h.focusable))
            assert.ok(
              hit.x >= 0 &&
                hit.x + hit.width <= width + 1 &&
                hit.y >= 0 &&
                hit.y + hit.height <= measured.height + 1,
              "natural control geometry bounded",
            );
          if (
            previews &&
            scheme === "dark" &&
            ((width === 360 && scale === 1.5) || (width === 520 && scale === 1)) &&
            [
              "observed",
              "off",
              "unknown",
              "readonly",
              "pair-confirmation",
              "pair-nearby",
              "pair-display",
              "pair-pin",
              "pair-passkey",
              "trust-grant",
              "trust-remove",
              "trust-revoked",
            ].includes(name)
          )
            writePng(
              path.join(previews, `${name}-${width}-${scale}.png`),
              frame.pixels,
              width,
              Math.ceil(measured.height),
            );
          renderShell(root, null);
          frames++;
        }
        for (const retained of [false, true]) {
          const height = 460;
          let bluetooth = ready(),
            busy = false,
            backs = 0,
            refreshes = 0,
            scrollY = 0;
          const calls: { id: string; connected: boolean }[] = [];
          const pairingCalls: string[] = [];
          const inputCalls: { id: string; value: string }[] = [];
          const trustCalls: string[] = [];
          const props = (): QuickSettingsDetailsProps => ({
            width,
            state: status(bluetooth),
            view: "bluetooth" satisfies "bluetooth",
            busy,
            onBack() {
              backs++;
            },
            onSettings() {
              throw new Error("Settings must not steal a pairing prompt's focus");
            },
            onBluetoothRefresh() {
              refreshes++;
            },
            onBluetoothChange(device: BluetoothDevice, connected: boolean) {
              calls.push({ id: device.id, connected });
            },
            onBluetoothDiscoveryStart(id) {
              pairingCalls.push(`find:${id}`);
            },
            onBluetoothDiscoveryStop() {
              pairingCalls.push("stop");
            },
            onBluetoothPair(device) {
              pairingCalls.push(`pair:${device.id}`);
            },
            onBluetoothPairCancel() {
              pairingCalls.push("cancel");
              bluetooth = searchingState();
              window.setContent(tree);
            },
            onBluetoothPromptResponse(id, accepted) {
              pairingCalls.push(`${accepted ? "accept" : "reject"}:${id}`);
              busy = false;
              bluetooth = searchingState();
              window.setContent(tree);
            },
            onBluetoothInputResponse(id, value) {
              inputCalls.push({ id, value });
            },
            onBluetoothTrustRequest(device, trusted) {
              trustCalls.push(`request:${device.id}:${trusted}`);
            },
            onBluetoothTrustConfirm(id) {
              trustCalls.push(`confirm:${id}`);
              const confirmation = activeBluetoothTrust(bluetooth);
              assert.ok(confirmation);
              bluetooth = {
                ...bluetooth,
                trust: {
                  kind: "ready",
                  operation: {
                    kind: "pending",
                    id: confirmation.id,
                    trusted: confirmation.trusted,
                  },
                },
              };
              window.setContent(tree);
            },
            onBluetoothTrustCancel(id) {
              trustCalls.push(`cancel:${id}`);
              bluetooth = { ...bluetooth, trust: { kind: "ready", operation: { kind: "idle" } } };
              window.setContent(tree);
            },
          });
          const natural = () => measureQuickSettingsDetails(props(), theme).height;
          const tree = () => (
            <WidgetThemeProvider theme={theme}>
              <Surface width={width} height={height}>
                <FocusScope id="bluetooth-fixture" onEscape={() => {}}>
                  <FocusScope
                    id={bluetoothInteractionScope(bluetooth) ?? "bluetooth-fixture"}
                    onEscape={() => {
                      const confirmation = activeBluetoothTrust(bluetooth);
                      if (confirmation) props().onBluetoothTrustCancel?.(confirmation.challengeId);
                      else props().onBluetoothPairCancel?.();
                    }}
                  >
                    <ScrollArea
                      key={bluetoothInteractionScope(bluetooth) ?? "bluetooth-fixture"}
                      width={width}
                      height={height}
                      contentHeight={natural()}
                      scrollY={scrollY}
                      onScroll={(value) => {
                        scrollY = value;
                        window.setContent(tree);
                      }}
                      smooth={false}
                      keyboard={{ focusId: "bluetooth:scroll" }}
                    >
                      <QuickSettingsDetails {...props()} />
                    </ScrollArea>
                  </FocusScope>
                </FocusScope>
              </Surface>
            </WidgetThemeProvider>
          );
          const backend = retained ? new Retained() : new HeadlessPlatform();
          await backend.connect();
          const window = new Window({
            title: "Synthetic Bluetooth fixture",
            width,
            height,
            decorated: false,
          });
          try {
            window.setContent(tree);
            window.mount(backend);
            window.tick();
            const native = backend.getWindows()[0]!;
            const settle = async () => {
              for (let i = 0; i < 20; i++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                window.tick();
              }
            };
            const source = () => {
              const root = createShellRoot();
              renderShell(
                root,
                <WidgetThemeProvider theme={theme}>
                  <QuickSettingsDetails {...props()} />
                </WidgetThemeProvider>,
              );
              const result = rasterize(root.container, width, Math.ceil(natural()));
              renderShell(root, null);
              return result;
            };
            const click = (x: number, y: number) => {
              native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
              native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
              window.tick();
            };
            const key = (code: number, key: string) => {
              for (const type of ["down", "up"] satisfies ("down" | "up")[])
                native.injectKey({
                  type,
                  code,
                  key,
                  modifiers: { ctrl: false, alt: false, shift: false, meta: false },
                  timeMs: 3,
                });
              window.tick();
            };
            const typeText = async (text: string) => {
              for (const character of text) {
                native.injectKey({
                  type: "down",
                  code: 0,
                  key: character,
                  text: character,
                  modifiers: { ctrl: false, alt: false, shift: false, meta: false },
                  timeMs: 5,
                });
                window.tick();
                await new Promise((resolve) => setTimeout(resolve, 5));
              }
              await settle();
            };
            await settle();
            if (
              previews &&
              !retained &&
              scheme === "dark" &&
              ((width === 360 && scale === 1.5) || (width === 520 && scale === 1))
            ) {
              const pixels = native.lastFrame;
              assert.ok(pixels);
              writePng(path.join(previews, `window-${width}-${scale}.png`), pixels, width, height);
            }
            const first = source().hits.find(
              (h) => h.focusId === `quick:bluetooth:device:${devices[0]!.id}`,
            );
            assert.ok(
              first && first.y + first.height < height,
              "first action initially visible in compact viewport",
            );
            click(first.x + first.width / 2, first.y + first.height / 2);
            await settle();
            assert.deepEqual(calls, [{ id: devices[0]!.id, connected: true }]);
            assert.equal(
              bluetooth.status.kind === "ready" && bluetooth.status.devices[0]?.connected,
              false,
              "request does not optimistically repaint connected",
            );
            bluetooth = variants.pending!;
            window.setContent(tree);
            window.tick();
            click(first.x + first.width / 2, first.y + first.height / 2);
            assert.equal(calls.length, 1, "pending prevents duplicate request");
            bluetooth = variants.unknown!;
            window.setContent(tree);
            window.tick();
            click(first.x + first.width / 2, first.y + first.height / 2);
            assert.equal(calls.length, 1, "unknown prevents blind retry");
            bluetooth = ready({ devices: [{ ...devices[0]!, connected: true }] });
            window.setContent(tree);
            window.tick();
            await settle();
            const current = source().hits.find(
              (h) => h.focusId === `quick:bluetooth:device:${devices[0]!.id}`,
            )!;
            click(current.x + current.width / 2, current.y + current.height / 2);
            await settle();
            key(28, "Enter");
            assert.deepEqual(
              calls.slice(1),
              [
                { id: devices[0]!.id, connected: false },
                { id: devices[0]!.id, connected: false },
              ],
              "pointer and focused Enter dispatch observed Disconnect",
            );
            bluetooth = ready();
            busy = true;
            window.setContent(tree);
            window.tick();
            click(first.x + first.width / 2, first.y + first.height / 2);
            assert.equal(calls.length, 3);
            busy = false;
            bluetooth = variants.readonly!;
            window.setContent(tree);
            window.tick();
            click(first.x + first.width / 2, first.y + first.height / 2);
            assert.equal(calls.length, 3);
            // A long list is scrolled through the actual viewport, then its tail refresh is reached.
            bluetooth = ready({
              devices: Array.from({ length: 12 }, (_, index) => ({
                ...devices[0]!,
                id: parseBluetoothId(`tail-${index}`),
                name: `Paired device ${index + 1}`,
                address: `00:11:22:33:44:${index.toString(16).padStart(2, "0")}`,
              })),
            });
            window.setContent(tree);
            window.tick();
            await settle();
            const before = native.lastFrame?.slice();
            assert.ok(before);
            native.injectPointer({
              type: "wheel",
              x: width / 2,
              y: height / 2,
              deltaY: natural(),
              timeMs: 4,
            });
            window.tick();
            await settle();
            assert.notDeepEqual(native.lastFrame, before, "actual wheel moves long device rows");
            // End on the viewport establishes an exact tail rather than guessed wheel extent.
            click(2, height / 2);
            key(107, "End");
            await settle();
            const refresh = source().hits.find((h) => h.focusId === "quick:bluetooth:refresh")!;
            const offset = natural() - height;
            click(refresh.x + refresh.width / 2, refresh.y - offset + refresh.height / 2);
            assert.equal(refreshes, 1);
            click(2, height / 2);
            key(102, "Home");
            await settle();
            const back = source().hits.find((h) => h.focusId === "quick:details:back")!;
            click(back.x + back.width / 2, back.y + back.height / 2);
            assert.equal(backs, 1);
            bluetooth = BLUETOOTH_UNAVAILABLE;
            window.setContent(tree);
            window.tick();
            await settle();
            assert.equal(
              source().hits.some(
                (h) => h.focusable && h.focusId?.startsWith("quick:bluetooth:device:"),
              ),
              false,
            );
            // Pairing is independent from the read-only connection policy. All
            // consent is entered through the actual Window's focus/input path.
            bluetooth = variants["pair-idle"]!;
            window.setContent(tree);
            window.tick();
            const hit = (id: string) => {
              const result = source().hits.find(
                (candidate) => candidate.focusId === id && candidate.focusable,
              );
              assert.ok(result, `missing actionable ${id}`);
              return result;
            };
            const press = async (id: string) => {
              click(2, height / 2);
              key(102, "Home");
              await settle();
              const target = hit(id);
              let offset = 0;
              if (target.y + target.height > height) {
                click(2, height / 2);
                key(107, "End");
                await settle();
                offset = Math.max(0, natural() - height);
              }
              click(target.x + target.width / 2, target.y - offset + target.height / 2);
            };
            await settle();
            await press(`quick:bluetooth:discover:${pairingAdapterId}`);
            assert.deepEqual(
              pairingCalls,
              [`find:${pairingAdapterId}`],
              "pairing-owned adapter identity differs from the known-device backend",
            );
            bluetooth = searchingState();
            window.setContent(tree);
            window.tick();
            await settle();
            await press(`quick:bluetooth:pair:${nearby.id}`);
            assert.equal(pairingCalls.at(-1), `pair:${nearby.id}`);
            bluetooth = promptState("confirmation");
            busy = true; // The pending Pair promise must not lock prompt responses.
            window.setContent(tree);
            window.tick();
            await settle();
            key(28, "Enter");
            assert.equal(
              pairingCalls.at(-1),
              `reject:${promptId}`,
              "default Enter rejects, never confirms",
            );
            busy = false;
            window.setContent(tree);
            window.tick();
            await settle();
            key(28, "Enter");
            assert.equal(
              pairingCalls.at(-1),
              `pair:${nearby.id}`,
              "dismissed prompt restores initiating Pair focus",
            );
            bluetooth = promptState("authorization");
            window.setContent(tree);
            window.tick();
            await settle();
            key(15, "Tab");
            key(28, "Enter");
            assert.equal(
              pairingCalls.at(-1),
              `accept:${promptId}`,
              "authorization requires explicit focus change and Enter",
            );
            bluetooth = promptState("display-code");
            busy = true;
            window.setContent(tree);
            window.tick();
            await settle();
            key(1, "Escape");
            assert.equal(
              pairingCalls.at(-1),
              "cancel",
              "prompt Escape dispatches cancellation during pending Pair",
            );
            busy = false;
            bluetooth = searchingState();
            window.setContent(tree);
            window.tick();
            await settle();
            await press("quick:bluetooth:discover:stop");
            assert.equal(pairingCalls.at(-1), "stop");
            bluetooth = variants["pair-unknown"]!;
            window.setContent(tree);
            window.tick();
            await settle();
            assert.equal(
              source().hits.some(
                (candidate) =>
                  candidate.focusable && candidate.focusId?.startsWith("quick:bluetooth:pair:"),
              ),
              false,
              "unknown pairing cannot retry blindly",
            );
            bluetooth = {
              ...ready({ devices: [{ ...devices[0]!, trusted: false }] }),
              pairing: pairingReady({
                attempt: {
                  kind: "complete",
                  id: attemptId,
                  device: nearby,
                  message: "Paired. Trust was not changed.",
                },
              }),
            };
            window.setContent(tree);
            window.tick();
            await settle();
            assert.equal(
              source().hits.some(
                (candidate) =>
                  candidate.focusable &&
                  candidate.focusId === `quick:bluetooth:device:${devices[0]!.id}`,
              ),
              false,
              "paired without trust remains ineligible for Connect",
            );
            // PIN drafts live only in the keyed entry component. The existing
            // masked field is driven by actual key events, never shared state.
            bluetooth = entryState("pin-entry");
            window.setContent(tree);
            window.tick();
            await settle();
            key(28, "Enter");
            assert.equal(pairingCalls.at(-1), "cancel", "entry defaults to Cancel");
            const replacementPromptId = parseBluetoothId("prompt-replacement");
            bluetooth = entryState("pin-entry", replacementPromptId);
            window.setContent(tree);
            window.tick();
            await settle();
            key(15, "Tab");
            await typeText("1234");
            const firstMaskedFrame = native.lastFrame?.slice();
            assert.ok(firstMaskedFrame);
            native.injectKey({
              type: "down",
              code: 30,
              key: "a",
              modifiers: { ctrl: true, alt: false, shift: false, meta: false },
              timeMs: 6,
            });
            window.tick();
            await typeText("ABCD");
            const secondMaskedFrame = native.lastFrame?.slice();
            assert.ok(secondMaskedFrame);
            const field = source().hits.find((candidate) =>
              candidate.focusId?.startsWith("text-field:"),
            );
            assert.ok(field);
            const maskedRegion = (pixels: Uint8Array) => {
              const result: number[] = [];
              // First two bullets exclude the caret and fixed surrounding copy.
              const startX = Math.floor(field.x + 12 * scale),
                startY = Math.floor(field.y + 8 * scale);
              for (let y = startY; y < Math.min(height, startY + 18 * scale); y++)
                for (let x = startX; x < Math.min(width, startX + 14 * scale); x++)
                  result.push(...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
              return result;
            };
            assert.deepEqual(
              maskedRegion(firstMaskedFrame),
              maskedRegion(secondMaskedFrame),
              "different four-character secrets paint the same masked bullets",
            );
            assert.ok(
              new Set(maskedRegion(firstMaskedFrame)).size > 2,
              "mask comparison includes painted field pixels",
            );
            if (
              previews &&
              !retained &&
              scheme === "dark" &&
              ((width === 520 && scale === 1) || (width === 360 && scale === 1.5))
            )
              writePng(
                path.join(previews, `window-masked-pin-${width}-${scale}.png`),
                secondMaskedFrame,
                width,
                height,
              );
            key(28, "Enter");
            await settle();
            key(28, "Enter");
            assert.deepEqual(
              inputCalls,
              [{ id: replacementPromptId, value: "ABCD" }],
              "validated entry submits once without storing the draft in observed state",
            );
            assert.ok(!JSON.stringify(bluetooth).includes("ABCD"));
            bluetooth = entryState("passkey-entry", parseBluetoothId("prompt-passkey"));
            window.setContent(tree);
            window.tick();
            await settle();
            key(15, "Tab");
            await typeText("a");
            key(28, "Enter");
            assert.equal(inputCalls.length, 1, "non-numeric passkey cannot submit");
            // Replacing the prompt unmounts the old private draft.
            bluetooth = entryState("passkey-entry", parseBluetoothId("prompt-passkey-new"));
            window.setContent(tree);
            window.tick();
            await settle();
            key(15, "Tab");
            key(28, "Enter");
            assert.equal(inputCalls.length, 1, "replacement starts empty");
            await typeText("000007");
            key(28, "Enter");
            await settle();
            assert.deepEqual(inputCalls.at(-1), { id: "prompt-passkey-new", value: "000007" });
            bluetooth = entryState("pin-entry", parseBluetoothId("prompt-cancel"));
            window.setContent(tree);
            window.tick();
            await settle();
            key(15, "Tab");
            await typeText("discarded");
            key(1, "Escape");
            await settle();
            assert.equal(pairingCalls.at(-1), "cancel");
            assert.equal(inputCalls.length, 2, "Escape never submits the private draft");
            // Trust is an independently observed service challenge, never a
            // side effect of entry, Pair, or connection actions.
            bluetooth = trustState({ kind: "idle" });
            window.setContent(tree);
            window.tick();
            await settle();
            await press(`quick:bluetooth:trust:request:${devices[0]!.id}`);
            assert.equal(trustCalls.at(-1), `request:${devices[0]!.id}:true`);
            bluetooth = variants["trust-grant"]!;
            window.setContent(tree);
            window.tick();
            await settle();
            if (
              previews &&
              !retained &&
              scheme === "dark" &&
              ((width === 520 && scale === 1) || (width === 360 && scale === 1.5))
            ) {
              assert.ok(native.lastFrame);
              writePng(
                path.join(previews, `window-trust-confirmation-${width}-${scale}.png`),
                native.lastFrame,
                width,
                height,
              );
            }
            key(28, "Enter");
            await settle();
            assert.equal(
              trustCalls.at(-1),
              `cancel:${challengeId}`,
              "trust modal defaults to Cancel",
            );
            await press(`quick:bluetooth:trust:request:${devices[0]!.id}`);
            assert.equal(
              trustCalls.at(-1),
              `request:${devices[0]!.id}:true`,
              "cancel releases the modal and makes the scrolled Trust row actionable again",
            );
            bluetooth = variants["trust-grant"]!;
            window.setContent(tree);
            window.tick();
            await settle();
            key(15, "Tab");
            key(28, "Enter");
            await settle();
            assert.equal(trustCalls.at(-1), `confirm:${challengeId}`);
            const trustCount = trustCalls.length;
            key(28, "Enter");
            assert.equal(
              trustCalls.length,
              trustCount,
              "pending trust prevents duplicate confirmation",
            );
            assert.equal(
              bluetooth.status.kind === "ready" && bluetooth.status.devices[0]?.trusted,
              false,
              "confirmation does not optimistically repaint trust",
            );
            bluetooth = trustState({ kind: "idle" }, true, true);
            window.setContent(tree);
            window.tick();
            await settle();
            await press(`quick:bluetooth:trust:request:${devices[0]!.id}`);
            assert.equal(trustCalls.at(-1), `request:${devices[0]!.id}:false`);
            bluetooth = variants["trust-remove"]!;
            window.setContent(tree);
            window.tick();
            await settle();
            key(1, "Escape");
            await settle();
            assert.equal(
              trustCalls.at(-1),
              `cancel:${challengeId}`,
              "trust Escape cancels the service challenge",
            );
            bluetooth = variants["trust-remove"]!;
            window.setContent(tree);
            window.tick();
            await settle();
            key(15, "Tab");
            key(28, "Enter");
            await settle();
            bluetooth = variants["trust-revoked"]!;
            window.setContent(tree);
            window.tick();
            await settle();
            await press(`quick:bluetooth:device:${devices[0]!.id}`);
            assert.deepEqual(
              calls.at(-1),
              { id: devices[0]!.id, connected: false },
              "observed untrusted connected device can explicitly Disconnect",
            );
            bluetooth = variants["trust-unknown"]!;
            window.setContent(tree);
            window.tick();
            await settle();
            assert.equal(
              source().hits.some(
                (candidate) =>
                  candidate.focusable &&
                  candidate.focusId?.startsWith("quick:bluetooth:trust:request:"),
              ),
              false,
              "unknown trust cannot retry blindly",
            );
            workflows++;
          } finally {
            window.destroy();
            backend.disconnect();
          }
        }
        // Main disclosure derives live status; outer loss cannot retain a connected caption.
        for (const state of [
          status(ready()),
          { kind: "unavailable", message: "Service disappeared" } satisfies DesktopStatusState,
        ]) {
          const root = createShellRoot();
          renderShell(
            root,
            <WidgetThemeProvider theme={theme}>
              <QuickSettingsContent
                width={width}
                state={state}
                cachedCapabilities={
                  status(ready()).kind === "ready"
                    ? {
                        audio: false,
                        battery: false,
                        bluetooth: true,
                        brightness: false,
                        power: false,
                        notifications: false,
                      }
                    : undefined
                }
                onBluetoothOpen={() => {}}
              />
            </WidgetThemeProvider>,
          );
          const text = all(root.container)
            .filter((n) => n.kind === "text")
            .map((n) => n.text ?? "")
            .join(" ");
          assert.equal(text.includes("1 known device connected"), state.kind === "ready");
          assert.equal(text.includes("Bluetooth unavailable"), state.kind !== "ready");
          renderShell(root, null);
          frames++;
        }
      }
  process.stdout.write(
    `${JSON.stringify({ actualCode: 0, frames, publicWindowWorkflows: workflows, selectedCase: process.env.MOIRE_BLUETOOTH_UI_CASE ?? "all", scope: "Synthetic known/discovery/pairing/PIN/passkey/trust state; CPU direct/retained public Window input. Automatic Window restoration to a scrolled Trust row remains unqualified; the shell owns restoration. No Bluetooth calls, device actions or native acceptance." })}\n`,
  );
} finally {
  setUiScaleFactor(1);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
