/** Actual createShell input/activation, with synthetic observed devices and RPC callbacks only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { createShellRoot, renderShell, rasterize } from "@moire/react-host";
import {
  TextBlock,
  getWidgetTheme,
  installUiFonts,
  setUiScaleFactor,
  tickAllMotions,
} from "@moire/ui";
import { getTheme, applyThemeFamily, setTheme } from "@moire/theme";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import {
  parseBluetoothId,
  type BluetoothActionRequest,
  type DesktopBluetooth,
  type BluetoothPairingState,
} from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
import { createShell } from "./controller";
import { QuickSettings, type DesktopControlActions } from "./QuickSettings";
import { panelStatusGeometry } from "./Panel";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-bluetooth-controller-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "config");
process.env.XDG_DATA_HOME = path.join(home, "data");
await installUiFonts();
setUiScaleFactor(1);
setTheme(applyThemeFamily(getTheme(), "moire", true));
const adapterId = parseBluetoothId("adapter:fixture");
const firstId = parseBluetoothId("device:first");
const secondId = parseBluetoothId("device:second");
const bluetooth: DesktopBluetooth = {
  status: {
    kind: "ready",
    policy: "interactive",
    adapters: [{ id: adapterId, name: "Fixture adapter", powered: true }],
    devices: [
      {
        id: firstId,
        adapterId,
        name: "Same fixture name",
        address: "02:00:00:00:00:01",
        paired: true,
        trusted: true,
        connected: false,
      },
      {
        id: secondId,
        adapterId,
        name: "Same fixture name",
        address: "02:00:00:00:00:02",
        paired: true,
        trusted: true,
        connected: false,
      },
    ],
  },
  operation: { kind: "idle" },
};
function status(
  b: DesktopBluetooth = bluetooth,
  revision = 1,
  owner = ":1.40",
  updating = false,
): Extract<DesktopStatusState, { kind: "ready" }> {
  return {
    kind: "ready",
    owner,
    snapshot: {
      revision,
      bluetooth: b,
      battery: BATTERY_UNAVAILABLE,
      wifi: WIFI_UNAVAILABLE,
      audio: { kind: "unavailable", message: "Fixture has no audio" },
      network: [],
      capabilities: {
        audio: false,
        brightness: false,
        battery: false,
        bluetooth: true,
        power: false,
        notifications: false,
      },
      doNotDisturb: false,
      notificationsAvailable: false,
      updating,
      notices: [],
    },
  };
}
let observation: DesktopStatusState = status();
const submitted: BluetoothActionRequest[] = [];
let refreshes = 0;
let presentationError = "";
let nextRequest: () => Promise<void> = async () => {};
const actions: DesktopControlActions = {
  async refreshBluetooth() {
    refreshes++;
  },
  async setBluetoothConnected(request) {
    submitted.push(request);
    presentationError = "";
    await nextRequest();
  },
  async refreshWifi() {},
  async connectWifi() {},
  async cancelWifi() {},
  async setVolume() {},
  async setMute() {},
  async setDoNotDisturb() {},
  async dismiss() {},
  async dismissMany() {
    return { dismissed: 0, skipped: 0 };
  },
  async invokeAction() {},
};
const shell = createShell(
  () => ({}),
  () => {},
  actions,
);
const width = 1100,
  height = 1500;
shell.setPrimaryOutput({ x: 0, y: 0, width, height });
const scene = createShellRoot();
let view: "main" | "bluetooth" = "main";
const noop = () => {};
const paint = () => {
  // Settle popup entrances, as a real frame does a few frames after opening.
  tickAllMotions(1);
  const frame = shell.chromeRaster(width, height);
  assert(frame);
  return frame;
};
const dangerPixels = () => {
  const frame = paint(),
    color = getWidgetTheme().foundations.palette.danger >>> 0;
  const words = new Uint32Array(
    frame.pixels.buffer,
    frame.pixels.byteOffset,
    frame.pixels.byteLength / 4,
  );
  return words.reduce((count, pixel) => count + (pixel === color ? 1 : 0), 0);
};
// Probe only text, never a second stateful shell. Require full opaque strokes and
// all interior transparent pixels so a solid danger-colored surface is rejected.
const errorVisible = (text: string) => {
  const probe = createShellRoot(),
    color = getWidgetTheme().foundations.palette.danger >>> 0;
  renderShell(probe, <TextBlock width={380} text={text} fontSize={11} color={color} wrap />);
  const bytes = rasterize(probe.container, 400, 50).pixels;
  const pattern = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const ink: { x: number; y: number }[] = [];
  let left = 400,
    right = 0,
    top = 50,
    bottom = 0;
  for (let y = 0; y < 50; y++)
    for (let x = 0; x < 400; x++) {
      const pixel = pattern[y * 400 + x] ?? 0;
      if (pixel >>> 24) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      if (pixel === color) ink.push({ x, y });
    }
  assert(ink.length > 0, "actual font probe has opaque strokes");
  const holes: { x: number; y: number }[] = [];
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) if (!(pattern[y * 400 + x] >>> 24)) holes.push({ x, y });
  assert(holes.length > 0, "body text probe has contrast pixels");
  const first = ink[0];
  assert(first);
  const frame = paint(),
    pixels = new Uint32Array(
      frame.pixels.buffer,
      frame.pixels.byteOffset,
      frame.pixels.byteLength / 4,
    );
  for (let index = 0; index < pixels.length; index++) {
    if (pixels[index] !== color) continue;
    const x = (index % frame.width) - first.x,
      y = Math.floor(index / frame.width) - first.y;
    if (x + left < 0 || y + top < 0 || x + right >= frame.width || y + bottom >= frame.height)
      continue;
    if (
      ink.every((p) => pixels[(y + p.y) * frame.width + x + p.x] === color) &&
      holes.every((p) => pixels[(y + p.y) * frame.width + x + p.x] !== color)
    )
      return true;
  }
  return false;
};
const observe = (next: DesktopStatusState) => {
  observation = next;
  shell.setDesktopStatus(next);
  paint();
};
observe(observation);
const anchor = () => {
  const a = panelStatusGeometry({
    screenW: width,
    screenH: height,
    clock: "12:00",
    onControlsClick: noop,
    onNotificationsClick: noop,
    status: observation,
  }).controls;
  assert(a);
  return a;
};
const hits = () => {
  renderShell(
    scene,
    <QuickSettings
      open
      screenW={width}
      screenH={height}
      anchor={anchor()}
      state={observation}
      error={presentationError}
      view={view}
      onViewChange={noop}
      onDismiss={noop}
      scrollY={0}
      onScroll={noop}
      onBluetoothChange={noop}
      onBluetoothRefresh={noop}
      onBluetoothDiscoveryStart={noop}
      onBluetoothDiscoveryStop={noop}
      onBluetoothPair={noop}
      onBluetoothPairCancel={noop}
      onBluetoothPromptResponse={noop}
      onBluetoothInputResponse={noop}
      onBluetoothTrustRequest={noop}
      onBluetoothTrustConfirm={noop}
      onBluetoothTrustCancel={noop}
    />,
  );
  return rasterize(scene.container, width, height).hits;
};
const point = (id: string) => {
  const h = hits().find((h) => h.focusable && h.focusId === id);
  assert(h, `actual shared geometry for ${id}`);
  return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
};
const edge = (p: { x: number; y: number }, value: number) => {
  assert(shell.onPointerButton({ ...p, button: 0x110, value, timeMs: 1 }));
  paint();
};
const click = (id: string) => {
  const p = point(id);
  edge(p, 1);
  edge(p, 0);
};
const key = (code: number) => {
  for (const value of [1, 0]) {
    const consumed = shell.onKey({ code, value });
    if (value === 1) assert(consumed);
    paint();
  }
};
const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  paint();
};
const open = () => {
  shell.onKey({ code: 1, value: 1 });
  shell.onKey({ code: 1, value: 0 });
  paint();
  view = "main";
  presentationError = "";
  const a = anchor();
  edge({ x: a.x + a.width / 2, y: a.y + a.height / 2 }, 1);
  edge({ x: a.x + a.width / 2, y: a.y + a.height / 2 }, 0);
  click("quick:bluetooth");
  view = "bluetooth";
  paint();
};
const deviceAction = `quick:bluetooth:device:${firstId}`;
let cases = 0;
try {
  open();
  click(deviceAction);
  await settle();
  assert.deepEqual(submitted, [{ owner: ":1.40", revision: 1, id: firstId, connected: true }]);
  cases++;
  assert.equal(
    observation.kind === "ready" &&
      observation.snapshot.bluetooth.status.kind === "ready" &&
      observation.snapshot.bluetooth.status.devices[0]?.connected,
    false,
    "RPC acknowledgment does not invent Connected",
  );
  cases++;
  click(`quick:bluetooth:device:${secondId}`);
  await settle();
  assert.equal(submitted.at(-1)?.id, secondId, "equal display names retain different identities");
  cases++;
  // Focus actual first device with pointer-down, then activate with a real key pair.
  const p = point(deviceAction);
  edge(p, 1);
  edge(p, 0);
  await settle();
  const beforeKey = submitted.length;
  key(28);
  await settle();
  assert.equal(submitted.length, beforeKey + 1, "Enter down/up submits once");
  cases++;
  key(57);
  await settle();
  assert.equal(submitted.length, beforeKey + 2, "Space down/up submits once");
  cases++;
  const stale = async (next: DesktopStatusState, label: string) => {
    observe(status());
    open();
    const p = point(deviceAction);
    const n = submitted.length;
    edge(p, 1);
    observe(next);
    shell.onPointerMotion?.(p);
    paint();
    edge(p, 0);
    await settle();
    assert.equal(submitted.length, n, label);
    cases++;
  };
  await stale(status(bluetooth, 2), "revision change cannot retarget old activation");
  await stale(status(bluetooth, 1, ":1.41"), "replacement service same revision cannot retarget");
  assert(bluetooth.status.kind === "ready");
  const ready = bluetooth.status;
  await stale(
    status({
      ...bluetooth,
      status: { ...ready, devices: ready.devices.filter((d) => d.id !== firstId) },
    }),
    "removed device is rejected",
  );
  await stale(
    status({
      ...bluetooth,
      status: {
        ...ready,
        devices: ready.devices.map((d) =>
          d.id === firstId ? { ...d, address: "02:00:00:00:00:09" } : d,
        ),
      },
    }),
    "changed identity is rejected even at same revision",
  );
  await stale(
    status({
      ...bluetooth,
      status: { ...ready, adapters: ready.adapters.map((a) => ({ ...a, powered: false })) },
    }),
    "powered-off replacement is rejected",
  );
  await stale(
    status({ ...bluetooth, status: { ...ready, policy: "readonly" } }),
    "readonly replacement is rejected",
  );
  await stale(
    status({
      ...bluetooth,
      status: { ...ready, devices: ready.devices.map((d) => ({ ...d, trusted: false })) },
    }),
    "untrusted devices cannot receive writes",
  );
  await stale(
    status({ ...bluetooth, operation: { kind: "pending", id: firstId, connected: true } }),
    "backend pending blocks duplicate submission",
  );
  await stale(
    status({
      ...bluetooth,
      operation: { kind: "unknown", id: firstId, connected: true, message: "Fixture unknown" },
    }),
    "unknown does not silently retry",
  );
  await stale(status(bluetooth, 1, ":1.40", true), "service updating blocks writes");
  observe(status());
  open();
  const old = point(deviceAction);
  const beforeDismiss = submitted.length;
  edge(old, 1);
  key(1);
  view = "main";
  paint();
  edge(old, 0);
  await settle();
  assert.equal(submitted.length, beforeDismiss, "Escape dismiss invalidates pointer activation");
  cases++;
  observe(status());
  open();
  click("quick:details:back");
  view = "main";
  paint();
  assert.equal(submitted.length, beforeDismiss, "Back performs no connection write");
  cases++;
  // Leave and re-enter the same details scope while the old pointer is held.
  // The new live hit has the same ID; only the lifecycle-bound callback can reject it.
  observe(status());
  open();
  const priorViewPoint = point(deviceAction),
    beforeView = submitted.length;
  edge(priorViewPoint, 1);
  shell.onKey({ code: 42, value: 1 });
  key(15);
  shell.onKey({ code: 42, value: 0 });
  key(28);
  view = "main";
  paint();
  key(15);
  key(28);
  view = "bluetooth";
  paint();
  shell.onPointerMotion?.(priorViewPoint);
  paint();
  edge(priorViewPoint, 0);
  await settle();
  assert.equal(
    submitted.length,
    beforeView,
    "returning to same ID cannot revive old view activation",
  );
  cases++;
  observe(status());
  open();
  const clientPoint = point(deviceAction),
    beforeClient = submitted.length;
  edge(clientPoint, 1);
  shell.onClientFocus?.();
  paint();
  edge(clientPoint, 0);
  await settle();
  assert.equal(
    submitted.length,
    beforeClient,
    "client focus restoration invalidates popup activation",
  );
  cases++;
  observe(status());
  open();
  const refreshPoint = point("quick:bluetooth:refresh"),
    beforeRefresh = refreshes;
  edge(refreshPoint, 1);
  observe(status(bluetooth, 2, ":1.41"));
  shell.onPointerMotion?.(refreshPoint);
  paint();
  edge(refreshPoint, 0);
  await settle();
  assert.equal(refreshes, beforeRefresh, "old refresh release cannot target replacement service");
  cases++;
  observe(
    status({
      ...bluetooth,
      operation: { kind: "unknown", id: firstId, connected: true, message: "Fixture unknown" },
    }),
  );
  open();
  click("quick:bluetooth:refresh");
  await settle();
  assert.equal(refreshes, 1, "unknown permits explicit read-only refresh");
  cases++;
  observe(status());
  open();
  let rejectRequest: (error: Error) => void = () => {};
  nextRequest = () =>
    new Promise((_, reject) => {
      rejectRequest = reject;
    });
  click(deviceAction);
  observe(status(bluetooth, 1, ":1.41"));
  rejectRequest(new Error("Obsolete request failure"));
  await settle();
  assert.equal(observation.kind === "ready" && observation.owner, ":1.41");
  assert.equal(dangerPixels(), 0, "obsolete owner failure is not painted into replacement popup");
  cases++;
  const newOwnerFrame = paint();
  nextRequest = async () => {};
  click(deviceAction);
  await settle();
  assert.equal(submitted.at(-1)?.owner, ":1.41", "new explicit activation uses new owner");
  cases++;
  assert(newOwnerFrame.revision > 0); // Captured actual shell raster, never a native/device claim.
  nextRequest = async () => {
    presentationError = "Fixture connection refused";
    throw new Error(presentationError);
  };
  click(deviceAction);
  await settle();
  assert(
    errorVisible("Fixture connection refused"),
    "current RPC error full glyphs are visible in actual shell raster",
  );
  cases++;
  nextRequest = async () => {};
  click(deviceAction);
  await settle();
  assert.equal(
    dangerPixels(),
    0,
    "explicit retry clears old error without inventing connected state",
  );
  cases++;
  nextRequest = () =>
    new Promise((_, reject) => {
      rejectRequest = reject;
    });
  click(deviceAction);
  key(1);
  view = "main";
  rejectRequest(new Error("Dismissed request failure"));
  await settle();
  nextRequest = async () => {};
  open();
  assert.equal(dangerPixels(), 0, "dismissed request error does not leak into reopened popup");
  cases++;

  observe(
    status(
      {
        ...bluetooth,
        status: { ...ready, devices: ready.devices.map((d) => ({ ...d, connected: true })) },
      },
      3,
    ),
  );
  open();
  click(deviceAction);
  await settle();
  assert.equal(submitted.at(-1)?.connected, false, "Disconnect derives actual observed Connected");
  cases++;
  // Same real shell, independently owned pairing capability and distinct adapter IDs.
  const pairingAdapter = parseBluetoothId("pairing:adapter"),
    nearbyId = parseBluetoothId("pairing:nearby");
  const nearby = {
    id: nearbyId,
    adapterId: pairingAdapter,
    name: "Nearby fixture",
    address: "02:00:00:00:00:08",
    paired: false as const,
  };
  type ReadyPairing = Extract<BluetoothPairingState, { kind: "ready" }>;
  const basePairing: ReadyPairing = {
    kind: "ready",
    adapters: [{ id: pairingAdapter, name: "Private pairing adapter", powered: true }],
    devices: [nearby],
    lease: null,
    discovery: "idle",
    attempt: { kind: "idle" },
    prompt: null,
    message: "",
  };
  let pairState = basePairing,
    pairRevision = 20,
    sequence = 0;
  const flowCalls: { kind: string; value: unknown }[] = [];
  const publishPair = (patch: Partial<ReadyPairing>, owner = ":1.40", updating = false) => {
    pairState = { ...pairState, ...patch };
    observe(status({ ...bluetooth, pairing: pairState }, ++pairRevision, owner, updating));
  };
  actions.startBluetoothDiscovery = async (request) => {
    flowCalls.push({ kind: "start", value: request });
    publishPair({
      lease: {
        id: parseBluetoothId(`lease:${++sequence}`),
        adapterId: request.adapterId,
        expiresAt: Date.now() + 30000,
      },
      discovery: "scanning",
      attempt: { kind: "idle" },
      prompt: null,
    });
  };
  actions.stopBluetoothDiscovery = async (request) => {
    flowCalls.push({ kind: "stop", value: request });
    assert.equal(request.leaseId, pairState.lease?.id);
    publishPair({
      lease: null,
      discovery: "stopped",
      prompt: null,
      attempt:
        pairState.attempt.kind === "pending"
          ? { ...pairState.attempt, kind: "canceled", message: "View closed" }
          : pairState.attempt,
    });
  };
  actions.beginBluetoothPair = async (request) => {
    flowCalls.push({ kind: "pair", value: request });
    const id = parseBluetoothId(`attempt:${++sequence}`);
    publishPair({
      attempt: { kind: "pending", id, device: nearby },
      prompt: {
        kind: "confirmation",
        id: parseBluetoothId(`prompt:${++sequence}`),
        attemptId: id,
        deviceId: nearbyId,
        code: "000042",
      },
    });
  };
  actions.respondBluetoothPrompt = async (request) => {
    flowCalls.push({ kind: "response", value: request });
    assert.equal(request.promptId, pairState.prompt?.id);
    publishPair({ attempt: { kind: "idle" }, prompt: null });
  };
  actions.cancelBluetoothPair = async (request) => {
    flowCalls.push({ kind: "cancel", value: request });
    assert(pairState.attempt.kind === "pending");
    assert.equal(request.attemptId, pairState.attempt.id);
    publishPair({
      attempt: { ...pairState.attempt, kind: "canceled", message: "Canceled" },
      prompt: null,
    });
  };
  const beginFlow = async () => {
    shell.onClientFocus?.();
    await settle();
    pairState = basePairing;
    publishPair({});
    open();
    click(`quick:bluetooth:discover:${pairingAdapter}`);
    await settle();
    assert(pairState.lease);
  };
  const startPair = async () => {
    click(`quick:bluetooth:pair:${nearbyId}`);
    await settle();
    assert(pairState.prompt);
    return pairState.prompt;
  };
  await beginFlow();
  assert.deepEqual(
    flowCalls.at(-1),
    {
      kind: "start",
      value: { owner: ":1.40", revision: pairRevision - 1, adapterId: pairingAdapter },
    },
    "Find uses dedicated pairing adapter identity",
  );
  cases++;
  const prompt = await startPair();
  key(28);
  await settle();
  assert.equal(flowCalls.at(-1)?.kind, "response");
  const rejectedCall = flowCalls.at(-1);
  assert(
    rejectedCall &&
      typeof rejectedCall.value === "object" &&
      rejectedCall.value !== null &&
      "accepted" in rejectedCall.value,
  );
  assert.equal(rejectedCall.value.accepted, false, "initial Enter rejects instead of confirming");
  cases++;
  key(28);
  await settle();
  assert.equal(flowCalls.at(-1)?.kind, "pair", "prompt removal restores initiating Pair focus");
  cases++;
  const confirmation = pairState.prompt!;
  click(`quick:bluetooth:prompt:accept:${confirmation.id}`);
  await settle();
  const confirmedCall = flowCalls.at(-1);
  assert(
    confirmedCall &&
      typeof confirmedCall.value === "object" &&
      confirmedCall.value !== null &&
      "accepted" in confirmedCall.value,
  );
  assert.equal(confirmedCall.value.accepted, true, "confirmation needs explicit active action");
  cases++;
  await startPair();
  const beforeCancel = flowCalls.length;
  publishPair({}, ":1.40", true);
  key(1);
  await settle();
  assert.equal(
    flowCalls[beforeCancel]?.kind,
    "cancel",
    "Escape cancels live prompt despite global updating",
  );
  assert.equal(pairState.prompt, null);
  cases++;
  publishPair({}, ":1.40", false);
  key(1);
  await settle();
  assert.equal(
    flowCalls.at(-1)?.kind,
    "stop",
    "subsequent Escape closes and cleans owned discovery",
  );
  cases++;
  await beginFlow();
  const stalePrompt = await startPair();
  const stalePoint = point(`quick:bluetooth:prompt:accept:${stalePrompt.id}`),
    beforeStale = flowCalls.length;
  edge(stalePoint, 1);
  const replacementPrompt = { ...stalePrompt, id: parseBluetoothId("prompt:replacement") };
  publishPair({ prompt: replacementPrompt });
  edge(stalePoint, 0);
  await settle();
  assert.equal(
    flowCalls.length,
    beforeStale,
    "old pointer release cannot approve replacement prompt",
  );
  cases++;
  key(1);
  await settle();
  key(1);
  await settle();
  await beginFlow();
  const ownerPrompt = await startPair();
  const ownerPoint = point(`quick:bluetooth:prompt:accept:${ownerPrompt.id}`),
    beforeOwner = flowCalls.length;
  edge(ownerPoint, 1);
  publishPair({}, ":1.41");
  edge(ownerPoint, 0);
  await settle();
  assert.equal(
    flowCalls.length,
    beforeOwner,
    "stale consent and cleanup cannot target new service owner",
  );
  cases++;
  shell.onClientFocus?.();
  await settle();
  pairState = basePairing;
  publishPair({});
  open();
  let releaseStart: () => void = () => {};
  const ordinaryStart = actions.startBluetoothDiscovery;
  actions.startBluetoothDiscovery = async (request) => {
    await new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    await ordinaryStart!(request);
  };
  click(`quick:bluetooth:discover:${pairingAdapter}`);
  key(1);
  view = "main";
  const beforeLate = flowCalls.length;
  releaseStart();
  await settle();
  await settle();
  assert.deepEqual(
    flowCalls.slice(beforeLate).map((call) => call.kind),
    ["start", "stop"],
    "scan accepted after popup close is immediately released",
  );
  cases++;
  actions.startBluetoothDiscovery = ordinaryStart;
  await beginFlow();
  await startPair();
  const beforeBlur = flowCalls.length;
  shell.onClientFocus?.();
  await settle();
  assert.equal(
    flowCalls[beforeBlur]?.kind,
    "stop",
    "client focus departure cleans owned pending pairing/discovery",
  );
  cases++;
  await beginFlow();
  await startPair();
  assert(pairState.attempt.kind === "pending");
  const unknownAttempt = {
    ...pairState.attempt,
    kind: "unknown" as const,
    message: "Fixture outcome unknown",
  };
  publishPair({ attempt: unknownAttempt, prompt: null });
  const beforeUnknown = flowCalls.length;
  key(28);
  await settle();
  assert(
    flowCalls.slice(beforeUnknown).every((call) => call.kind === "stop"),
    "unknown state permits owned cleanup, never retry or consent",
  );
  cases++;
  // Root controller owns trust consent and releases it on Escape/view departure.
  shell.onClientFocus?.();
  await settle();
  const originalStatus = bluetooth.status;
  assert(originalStatus.kind === "ready");
  let trustBluetooth: DesktopBluetooth = {
    ...bluetooth,
    status: {
      ...originalStatus,
      devices: originalStatus.devices.map((d) => ({ ...d, trusted: false })),
    },
    trust: { kind: "ready", operation: { kind: "idle" } },
  };
  const trustCalls: string[] = [];
  const publishTrust = (next: DesktopBluetooth) => {
    trustBluetooth = next;
    const revision = observation.kind === "ready" ? observation.snapshot.revision + 1 : 1;
    observe(status(next, revision));
  };
  actions.requestBluetoothTrust = async (request) => {
    trustCalls.push("request");
    publishTrust({
      ...trustBluetooth,
      trust: {
        kind: "ready",
        operation: {
          kind: "confirmation",
          id: request.id,
          trusted: request.trusted,
          challengeId: parseBluetoothId(`trust:${++sequence}`),
          expiresAt: Date.now() + 30000,
        },
      },
    });
  };
  actions.cancelBluetoothTrust = async (request) => {
    const trust = trustBluetooth.trust;
    assert(trust?.kind === "ready" && trust.operation.kind === "confirmation");
    assert.equal(request.challengeId, trust.operation.challengeId);
    trustCalls.push("cancel");
    publishTrust({ ...trustBluetooth, trust: { kind: "ready", operation: { kind: "idle" } } });
  };
  actions.confirmBluetoothTrust = async (request) => {
    const trust = trustBluetooth.trust;
    assert(trust?.kind === "ready" && trust.operation.kind === "confirmation");
    assert.equal(request.challengeId, trust.operation.challengeId);
    const consent = trust.operation;
    assert(trustBluetooth.status.kind === "ready");
    trustCalls.push("confirm");
    publishTrust({
      ...trustBluetooth,
      status: {
        ...trustBluetooth.status,
        devices: trustBluetooth.status.devices.map((d) =>
          d.id === consent.id ? { ...d, trusted: consent.trusted } : d,
        ),
      },
      trust: { kind: "ready", operation: { kind: "idle" } },
    });
  };
  publishTrust(trustBluetooth);
  open();
  click(`quick:bluetooth:trust:request:${firstId}`);
  await settle();
  assert.deepEqual(trustCalls, ["request"]);
  key(28);
  await settle();
  assert.deepEqual(trustCalls, ["request", "cancel"], "initial Enter cancels, never trusts");
  cases++;
  click(`quick:bluetooth:trust:request:${firstId}`);
  await settle();
  const t = trustBluetooth.trust;
  assert(t?.kind === "ready" && t.operation.kind === "confirmation");
  click(`quick:bluetooth:trust:confirm:${t.operation.challengeId}`);
  await settle();
  assert.equal(trustCalls.at(-1), "confirm");
  cases++;
  click(`quick:bluetooth:trust:request:${firstId}`);
  await settle();
  key(1);
  await settle();
  assert.equal(trustCalls.at(-1), "cancel", "Escape retires exact owned consent");
  cases++;
  click(`quick:bluetooth:trust:request:${firstId}`);
  await settle();
  shell.onClientFocus?.();
  await settle();
  assert.equal(trustCalls.at(-1), "cancel", "client departure retires exact owned consent");
  cases++;
  assert(trustBluetooth.status.kind === "ready");
  publishTrust({
    ...trustBluetooth,
    status: {
      ...trustBluetooth.status,
      devices: trustBluetooth.status.devices.map((d) =>
        d.id === firstId ? { ...d, trusted: false, connected: true } : d,
      ),
    },
  });
  open();
  const beforeRevokeDisconnect = submitted.length;
  click(deviceAction);
  await settle();
  assert.equal(submitted.length, beforeRevokeDisconnect + 1);
  assert.equal(
    submitted.at(-1)?.connected,
    false,
    "post-revocation explicit Disconnect remains available",
  );
  cases++;
  // A consent reply arriving after view close is released, never silently retained.
  const ordinaryTrustRequest = actions.requestBluetoothTrust;
  let releaseTrustRequest: () => void = () => {};
  actions.requestBluetoothTrust = async (request) => {
    await new Promise<void>((resolve) => {
      releaseTrustRequest = resolve;
    });
    await ordinaryTrustRequest!(request);
  };
  click(`quick:bluetooth:trust:request:${firstId}`);
  key(1);
  view = "main";
  const beforeLateTrust = trustCalls.length;
  releaseTrustRequest();
  await settle();
  await settle();
  assert.deepEqual(
    trustCalls.slice(beforeLateTrust),
    ["request", "cancel"],
    "consent accepted after view close is retired",
  );
  cases++;
  actions.requestBluetoothTrust = ordinaryTrustRequest;
  // Entry flows go through the actual controller's focused TextField.
  await beginFlow();
  await startPair();
  assert(pairState.attempt.kind === "pending");
  const entryId = parseBluetoothId(`entry:${++sequence}`);
  actions.respondBluetoothInput = async (request) => {
    assert.equal(request.promptId, entryId);
    assert.equal(request.value, "a");
    flowCalls.push({ kind: "input", value: { promptId: request.promptId } });
    publishPair({ prompt: null });
  };
  publishPair({
    inputEnabled: true,
    prompt: { kind: "pin-entry", id: entryId, attemptId: pairState.attempt.id, deviceId: nearbyId },
  });
  paint();
  key(15);
  key(30);
  key(28);
  await settle();
  assert.equal(
    flowCalls.at(-1)?.kind,
    "input",
    "focused field submit reaches the typed input action",
  );
  cases++;
  // Compact restoration belongs to createShell, rather than Window's automatic focus.
  shell.onClientFocus?.();
  await settle();
  setUiScaleFactor(1.5);
  const compactWidth = 650,
    compactHeight = 650;
  let compactObserved = status({
    ...bluetooth,
    status: {
      ...originalStatus,
      devices: Array.from({ length: 6 }, (_, i) => ({
        ...originalStatus.devices[0]!,
        id: parseBluetoothId(`compact:${i}`),
        trusted: false,
      })),
    },
    trust: { kind: "ready", operation: { kind: "idle" } },
  });
  const compactCalls: string[] = [];
  const compactActions: DesktopControlActions = { ...actions };
  const compact = createShell(() => ({}), noop, compactActions);
  compact.setPrimaryOutput({ x: 0, y: 0, width: compactWidth, height: compactHeight });
  const compactPaint = () => {
    assert(compact.chromeRaster(compactWidth, compactHeight));
  };
  const compactPublish = (bluetooth: DesktopBluetooth) => {
    compactObserved = status(bluetooth, compactObserved.snapshot.revision + 1);
    compact.setDesktopStatus(compactObserved);
    compactPaint();
  };
  compactActions.requestBluetoothTrust = async (request) => {
    compactCalls.push(`request:${request.id}`);
    compactPublish({
      ...compactObserved.snapshot.bluetooth,
      trust: {
        kind: "ready",
        operation: {
          kind: "confirmation",
          id: request.id,
          trusted: true,
          challengeId: parseBluetoothId("compact-consent"),
          expiresAt: Date.now() + 30000,
        },
      },
    });
  };
  compactActions.cancelBluetoothTrust = async () => {
    compactCalls.push("cancel");
    compactPublish({
      ...compactObserved.snapshot.bluetooth,
      trust: { kind: "ready", operation: { kind: "idle" } },
    });
  };
  const compactAnchor = panelStatusGeometry({
    screenW: compactWidth,
    screenH: compactHeight,
    clock: "12:00",
    onControlsClick: noop,
    onNotificationsClick: noop,
    status: compactObserved,
  }).controls;
  assert(compactAnchor);
  const compactSource = (view: "main" | "bluetooth") => {
    renderShell(
      scene,
      <QuickSettings
        open
        screenW={compactWidth}
        screenH={compactHeight}
        anchor={compactAnchor}
        state={compactObserved}
        view={view}
        onDismiss={noop}
        onViewChange={noop}
        scrollY={0}
        onScroll={noop}
        onBluetoothChange={noop}
        onBluetoothRefresh={noop}
        onBluetoothTrustRequest={noop}
        onBluetoothTrustConfirm={noop}
        onBluetoothTrustCancel={noop}
      />,
    );
    return rasterize(scene.container, compactWidth, compactHeight).hits;
  };
  const compactClick = (x: number, y: number) => {
    for (const value of [1, 0]) {
      compact.onPointerButton({ x, y, value, button: 0x110, timeMs: 1 });
      compactPaint();
    }
  };
  const compactKey = (code: number) => {
    for (const value of [1, 0]) {
      compact.onKey({ code, value });
      compactPaint();
    }
  };
  compact.setDesktopStatus(compactObserved);
  compactPaint();
  compactClick(
    compactAnchor.x + compactAnchor.width / 2,
    compactAnchor.y + compactAnchor.height / 2,
  );
  const compactDisclosure = compactSource("main").find((hit) => hit.focusId === "quick:bluetooth");
  assert(compactDisclosure);
  compactClick(
    compactDisclosure.x + compactDisclosure.width / 2,
    compactDisclosure.y + compactDisclosure.height / 2,
  );
  const compactFocusable = compactSource("bluetooth").filter(
    (hit) => hit.focusable && hit.focusScopeId === "quick-settings",
  );
  assert.equal(compactFocusable[0]?.focusId, "quick:details:back");
  const compactTarget = compactFocusable.findIndex(
    (hit) => hit.focusId === "quick:bluetooth:trust:request:compact:5",
  );
  assert(compactTarget > 0);
  for (let i = 0; i < compactTarget; i++) compactKey(15);
  const targetHit = compactFocusable[compactTarget]!;
  assert(
    targetHit.pointerClip &&
      targetHit.y + targetHit.height > targetHit.pointerClip.y + targetHit.pointerClip.height,
    "the initiating row lies outside the unscrolled viewport",
  );
  const beforeModalPixels = Buffer.from(compact.chromeRaster(compactWidth, compactHeight)!.pixels);
  compactKey(28);
  await new Promise((resolve) => setImmediate(resolve));
  compactPaint();
  assert.equal(compactCalls.at(-1), "request:compact:5");
  compactKey(28);
  await new Promise((resolve) => setImmediate(resolve));
  compactPaint();
  assert.equal(compactCalls.at(-1), "cancel");
  assert(
    Buffer.from(compact.chromeRaster(compactWidth, compactHeight)!.pixels).equals(
      beforeModalPixels,
    ),
    "root restores the same scrolled viewport and focused row pixels",
  );
  compactKey(28);
  await new Promise((resolve) => setImmediate(resolve));
  compactPaint();
  assert.equal(
    compactCalls.at(-1),
    "request:compact:5",
    "root restores focus to the scrolled initiating Trust row",
  );
  compact.onClientFocus?.();
  await new Promise((resolve) => setImmediate(resolve));
  setUiScaleFactor(1);
  cases++;
  assert(prompt.kind === "confirmation");
  console.log(
    JSON.stringify({
      cases,
      source: "actual createShell synthetic pointer/keyboard + RPC callbacks",
      native: false,
    }),
  );
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
}
