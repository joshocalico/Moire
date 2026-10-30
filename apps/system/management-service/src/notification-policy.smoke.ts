/**
 * Desktop controls over a private bus with the notification policy injected: the Do not
 * disturb schedule turns it on and off with the clock, switching it off inside the window
 * snoozes the schedule until the window ends, and per-app rules reach the published notices.
 */
import assert from "node:assert/strict";
import { variant } from "@moire/dbus";
import type { AudioStatusAdapter } from "@moire/audio";
import type { DoNotDisturbSchedule, NotificationRules } from "@moire/prefs";
import {
  DESKTOP_STATUS_INTERFACE,
  DESKTOP_STATUS_PATH,
  parseDesktopStatus,
} from "@moire/system-management/desktop-status";
import { BATTERY_UNAVAILABLE, type BatteryAdapter } from "@moire/system-management/battery-status";
import {
  BLUETOOTH_UNAVAILABLE,
  type BluetoothAdapter,
} from "@moire/system-management/bluetooth-status";
import { WIFI_UNAVAILABLE, type WifiAdapter } from "@moire/system-management/network-status";
import { attachDesktopControls } from "./desktop-controls";
import { NOTIFICATIONS_BUS, NOTIFICATIONS_INTERFACE, NOTIFICATIONS_PATH } from "./notifications";
import { startPrivateBus } from "./private-bus.testing";

const idle = { subscribe: () => () => {}, refresh: async () => {}, dispose: async () => {} };
const audio = {
  state: { kind: "unavailable", message: "No audio in this smoke" },
  subscribe: () => () => {},
  refresh: async () => audio.state,
  dispose: () => {},
} as unknown as AudioStatusAdapter;

const bus = await startPrivateBus("moire-notification-policy-");
try {
  const server = await bus.connect();
  const client = await bus.connect();
  let clock = new Date(2026, 9, 10, 21, 0);
  let manual = false;
  const schedule: DoNotDisturbSchedule = { enabled: true, from: "22:00", to: "07:00" };
  const rules: NotificationRules = {
    Quiet: { allow: true, banners: false, sound: false, history: true },
  };
  const controls = await attachDesktopControls(server, {
    alertSound: () => {},
    audio,
    wifi: { ...idle, state: WIFI_UNAVAILABLE } as unknown as WifiAdapter,
    battery: { ...idle, state: BATTERY_UNAVAILABLE } as BatteryAdapter,
    bluetooth: { ...idle, state: BLUETOOTH_UNAVAILABLE } as unknown as BluetoothAdapter,
    network: () => [],
    pollMs: 0,
    readDoNotDisturb: () => manual,
    writeDoNotDisturb: (value) => {
      manual = value;
    },
    readNotificationPolicy: () => ({ rules, schedule }),
    now: () => clock,
  });
  const status = async () =>
    parseDesktopStatus(
      (
        await client.call({
          destination: server.name ?? "",
          path: DESKTOP_STATUS_PATH,
          interface: DESKTOP_STATUS_INTERFACE,
          member: "GetStatus",
        })
      ).body?.[0],
    );
  const setDnd = async (on: boolean) =>
    client.call({
      destination: server.name ?? "",
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "SetDoNotDisturb",
      signature: "ub",
      body: [(await status()).revision, on],
    });

  // Outside the window: off. Inside it: on, and marked as the schedule's.
  assert.equal((await status()).doNotDisturb, false);
  clock = new Date(2026, 9, 10, 23, 0);
  await controls.refresh();
  let current = await status();
  assert.equal(current.doNotDisturb, true, "the schedule turns it on");
  assert.equal(current.doNotDisturbScheduled, true);

  // Switching it off inside the window snoozes the schedule until 07:00, then it's back
  // the next evening.
  await setDnd(false);
  current = await status();
  assert.equal(current.doNotDisturb, false, "turning it off skips the rest of tonight");
  clock = new Date(2026, 9, 11, 3, 0);
  await controls.refresh();
  assert.equal((await status()).doNotDisturb, false, "still snoozed overnight");
  clock = new Date(2026, 9, 11, 22, 30);
  await controls.refresh();
  assert.equal((await status()).doNotDisturb, true, "back on the next evening");

  // The switch on top of the schedule is manual, not scheduled.
  await setDnd(true);
  current = await status();
  assert.equal(current.doNotDisturb, true);
  assert.equal(current.doNotDisturbScheduled, false);
  assert.equal(manual, true);

  // A rule reaches the published notice: banner and sound off, keyed by app name.
  await client.call({
    destination: NOTIFICATIONS_BUS,
    path: NOTIFICATIONS_PATH,
    interface: NOTIFICATIONS_INTERFACE,
    member: "Notify",
    signature: "susssasa{sv}i",
    body: ["Quiet", 0, "", "Hello", "", [], { urgency: variant("y", 1) }, 0],
  });
  const notice = (await status()).notices.find((item) => item.appName === "Quiet");
  assert.ok(notice);
  assert.equal(notice.appId, "Quiet");
  assert.equal(notice.banner, false);
  assert.equal(notice.sound, false);

  await controls.dispose();
  console.log(
    "[notification-policy] schedule on/off with the clock, snooze until the window ends, per-app flags published passed",
  );
} finally {
  await bus.close();
}
