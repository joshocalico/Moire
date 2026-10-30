/**
 * Brightness end to end on a private dbus-daemon: backlights read from a fake sysfs tree and
 * chosen in systemd's order, raw values that never reach zero, org.moire.Brightness1 with the
 * Settings client (set, follow a change made elsewhere, refusals as values, no backlight), and
 * the logind setter against a fake login1 (session lookup, arguments, AccessDenied).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DbusRemoteError, type SessionBus } from "@moire/dbus";
import { SETTINGS_SERVICE_BUS } from "@moire/system-management/settings-service";
import {
  observeBrightness,
  type BrightnessClient,
  type BrightnessStatus,
} from "@moire/system-management/brightness";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import {
  NO_BACKLIGHT,
  attachBrightnessControls,
  backlightStatus,
  createLogindBrightnessSetter,
  rawBrightness,
  readBacklights,
} from "./backlight";
import { startPrivateBus, until } from "./private-bus.testing";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "moire-backlight-"));
const device = (name: string, type: string, max: number, current: number) => {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "type"), `${type}\n`);
  fs.writeFileSync(path.join(directory, "max_brightness"), `${max}\n`);
  fs.writeFileSync(path.join(directory, "actual_brightness"), `${current}\n`);
  fs.writeFileSync(path.join(directory, "brightness"), `${current}\n`);
};
const write = (name: string, value: number) =>
  fs.writeFileSync(path.join(root, name, "actual_brightness"), `${value}\n`);

const bus = await startPrivateBus("moire-backlight-smoke-");
let client: BrightnessClient | null = null;
const disposers: { dispose(): Promise<void> }[] = [];
try {
  // ---- Reading: firmware before platform before raw; junk skipped.
  device("intel_backlight", "raw", 96000, 48000);
  device("acpi_video0", "firmware", 100, 30);
  device("broken", "raw", 0, 0);
  fs.mkdirSync(path.join(root, "no-type"));
  const found = readBacklights(root);
  assert.deepEqual(
    found.map((entry) => entry.name),
    ["acpi_video0", "intel_backlight"],
  );
  assert.deepEqual(backlightStatus(found), {
    kind: "ready",
    device: "acpi_video0",
    type: "firmware",
    level: 0.3,
  });
  assert.deepEqual(backlightStatus([]), { kind: "unavailable", message: NO_BACKLIGHT });
  assert.equal(readBacklights(path.join(root, "missing")).length, 0);
  assert.equal(rawBrightness(0, 100), 5, "the floor keeps the panel lit");
  assert.equal(rawBrightness(1, 100), 100);
  assert.equal(rawBrightness(0.5, 96000), 48000);
  assert.equal(rawBrightness(0, 3), 1, "never zero");

  // ---- The service and the Settings client.
  fs.rmSync(path.join(root, "acpi_video0"), { recursive: true });
  const sets: [string, number][] = [];
  let refuse = false;
  const service = await bus.connect();
  disposers.push(
    attachBrightnessControls(service, {
      root,
      pollMs: 20,
      set: async (name, raw) => {
        sets.push([name, raw]);
        if (refuse)
          throw new SettingsServiceError(
            "permission",
            "Only the person signed in at this screen can change its brightness.",
          );
        write(name, raw);
      },
    }),
  );
  assert.equal(await service.requestName(SETTINGS_SERVICE_BUS, 4), 1);
  client = await observeBrightness(await bus.connect(), { readTimeoutMs: 1000 });
  const c = client;
  const status = (): BrightnessStatus | null => (c.state.kind === "ready" ? c.state.status : null);
  const level = () => {
    const current = status();
    return current?.kind === "ready" ? current.level : null;
  };
  await until(() => status()?.kind === "ready", "client ready");
  assert.deepEqual(status(), {
    kind: "ready",
    device: "intel_backlight",
    type: "raw",
    level: 0.5,
  });
  assert.deepEqual(await c.setLevel(0.75), { ok: true, value: undefined });
  assert.deepEqual(sets.at(-1), ["intel_backlight", 72000]);
  await until(() => level() === 0.75, "level follows the set");
  // A brightness key changes it elsewhere; the client follows within the poll.
  write("intel_backlight", 9600);
  await until(() => level() === 0.1, "follows outside changes");
  // Too low is raised to the floor before it is sent.
  await c.setLevel(0);
  assert.deepEqual(sets.at(-1), ["intel_backlight", 4800]);
  // Refusals come back as values with the service's sentence.
  refuse = true;
  const refused = await c.setLevel(0.9);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.code, "permission");
  assert.match(!refused.ok ? refused.message : "", /signed in at this screen/);
  refuse = false;
  assert.equal((await c.setLevel(Number.NaN)).ok, false);
  await client.dispose();
  client = null;

  // ---- No backlight (a VM): unavailable, and setting says so.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "moire-backlight-empty-"));
  const bare = await startPrivateBus("moire-backlight-bare-");
  try {
    const bareService = await bare.connect();
    disposers.push(attachBrightnessControls(bareService, { root: empty, set: async () => {} }));
    assert.equal(await bareService.requestName(SETTINGS_SERVICE_BUS, 4), 1);
    const bareClient = await observeBrightness(await bare.connect(), { readTimeoutMs: 1000 });
    await until(() => bareClient.state.kind === "ready", "bare client ready");
    assert.deepEqual(bareClient.state.kind === "ready" && bareClient.state.status, {
      kind: "unavailable",
      message: NO_BACKLIGHT,
    });
    const result = await bareClient.setLevel(0.5);
    assert.equal(!result.ok && result.code, "unavailable");
    await bareClient.dispose();
  } finally {
    for (const disposer of disposers.splice(1)) await disposer.dispose();
    await bare.close();
    fs.rmSync(empty, { recursive: true, force: true });
  }

  // ---- logind: the session from XDG_SESSION_ID, then SetBrightness with its arguments.
  const login1 = await bus.connect();
  const calls: unknown[][] = [];
  let deny = false;
  login1.exportObject("/org/freedesktop/login1", {
    name: "org.freedesktop.login1.Manager",
    methods: {
      GetSession: {
        inSignature: "s",
        outSignature: "o",
        handler: ({ body }) => {
          calls.push(["GetSession", ...body]);
          return { body: ["/org/freedesktop/login1/session/_32"] };
        },
      },
    },
  });
  login1.exportObject("/org/freedesktop/login1/session/_32", {
    name: "org.freedesktop.login1.Session",
    methods: {
      SetBrightness: {
        inSignature: "ssu",
        outSignature: "",
        handler: ({ body }) => {
          calls.push(["SetBrightness", ...body]);
          if (deny)
            throw new DbusRemoteError(
              "org.freedesktop.DBus.Error.AccessDenied",
              "logind detail must not escape",
            );
          return {};
        },
      },
    },
  });
  assert.equal(await login1.requestName("org.freedesktop.login1", 4), 1);
  const setter = createLogindBrightnessSetter({
    connect: () => bus.connect() as Promise<SessionBus>,
    sessionId: "2",
    timeoutMs: 1000,
  });
  await setter("intel_backlight", 1234);
  await setter("intel_backlight", 99);
  assert.deepEqual(calls, [
    ["GetSession", "2"],
    ["SetBrightness", "backlight", "intel_backlight", 1234],
    ["SetBrightness", "backlight", "intel_backlight", 99],
  ]);
  deny = true;
  await assert.rejects(
    setter("intel_backlight", 5),
    (error: unknown) =>
      error instanceof SettingsServiceError &&
      error.code === "permission" &&
      !error.message.includes("logind detail"),
  );
  setter.dispose();
} finally {
  await client?.dispose();
  for (const disposer of disposers) await disposer.dispose();
  await bus.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("[backlight] sysfs, service, client, refusals, no backlight and logind passed");
