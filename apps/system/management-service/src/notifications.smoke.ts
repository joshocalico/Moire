import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { SessionBus, variant, type DbusMessage, type DbusMethodContext } from "@moire/dbus";
import {
  attachNotificationService,
  createNotificationService,
  NOTIFICATIONS_BUS,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_INTERFACE,
  NOTIFICATION_LIMITS,
  type NotificationControls,
  type NotificationEntry,
  type NotificationScheduler,
  type NotificationTransport,
} from "./notifications";
import { DEFAULT_NOTIFICATION_RULE, type NotificationRule } from "@moire/prefs";

class Clock implements NotificationScheduler {
  value = 1000;
  tasks: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  now() {
    return this.value;
  }
  schedule(delayMs: number, callback: () => void) {
    const task = { at: this.value + delayMs, callback, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }
  advance(ms: number) {
    this.value += ms;
    for (const task of this.tasks)
      if (!task.cancelled && task.at <= this.value) {
        task.cancelled = true;
        task.callback();
      }
  }
}

class Transport implements NotificationTransport {
  signals: Parameters<NotificationTransport["emitSignal"]>[0][] = [];
  owners = new Map<string, (owner: string | null) => void>();
  removed = 0;
  emitSignal(signal: Parameters<NotificationTransport["emitSignal"]>[0]) {
    this.signals.push(signal);
  }
  async watchSender(sender: string, changed: (owner: string | null) => void) {
    this.owners.set(sender, changed);
    changed(sender);
    let removed = false;
    return async () => {
      if (removed) return;
      removed = true;
      this.removed++;
      if (this.owners.get(sender) === changed) this.owners.delete(sender);
    };
  }
}

function request(body: unknown[], sender = ":1.10", member = "Notify"): DbusMethodContext {
  return {
    body,
    fds: [],
    keepFd: () => -1,
    message: {
      type: 1,
      serial: 1,
      sender,
      path: NOTIFICATIONS_PATH,
      interface: NOTIFICATIONS_INTERFACE,
      member,
      signature: member === "Notify" ? "susssasa{sv}i" : member === "CloseNotification" ? "u" : "",
    },
  };
}
function argumentsFor(
  overrides: {
    replaces?: number;
    timeout?: number;
    summary?: string;
    actions?: string[];
    hints?: Record<string, unknown>;
    body?: string;
  } = {},
): unknown[] {
  return [
    "Fixture",
    overrides.replaces ?? 0,
    "",
    overrides.summary ?? "Completed",
    overrides.body ?? "Saved a document",
    overrides.actions ?? ["default", "Open", "retry", "Retry"],
    overrides.hints ?? {},
    overrides.timeout ?? -1,
  ];
}

async function modelCases() {
  const clock = new Clock(),
    transport = new Transport();
  const presentations: Array<{ entry: NotificationEntry; controls: NotificationControls }> = [];
  let changes = 0;
  const errors: unknown[] = [];
  const service = createNotificationService(transport, {
    scheduler: clock,
    onChange: () => changes++,
    onError: (error) => errors.push(error),
    present: (entry, controls) => presentations.push({ entry, controls }),
  });
  async function call(member: string, body: unknown[], sender?: string) {
    const method = service.descriptor.methods[member];
    assert(method, `actual exported descriptor includes ${member}`);
    return method.handler(request(body, sender, member));
  }
  async function notify(body = argumentsFor(), sender?: string) {
    const result = await call("Notify", body, sender);
    const id = result.body?.[0];
    assert.equal(typeof id, "number");
    if (typeof id !== "number") throw new Error("Notify did not return an ID");
    return id;
  }
  try {
    assert.deepEqual((await call("GetCapabilities", [])).body, [["body", "actions"]]);
    assert.deepEqual((await call("GetServerInformation", [])).body, [
      "Moire",
      "Moire",
      "0.0.0",
      "1.3",
    ]);
    const first = await notify(
      argumentsFor({
        timeout: 100,
        body: '<b>Saved</b> &amp; <a href="file:///private">safe</a><img src="/private"/>',
      }),
    );
    assert.equal(service.snapshot().active[0]?.body, "Saved & safe");
    const prior = presentations[0];
    assert(prior);
    const cancelledTimer = clock.tasks[0];
    assert(cancelledTimer);
    assert.equal(
      await notify(argumentsFor({ replaces: first, timeout: 200, summary: "Replacement" })),
      first,
    );
    assert.equal(service.snapshot().active.length, 1);
    assert.equal(transport.signals.length, 0, "atomic replacement sends no closed signal");
    assert.equal(
      prior.controls.invokeAction("default"),
      false,
      "replacement revokes prior action callbacks",
    );
    assert.equal(prior.controls.dismiss(), false, "replacement revokes prior dismissal callback");
    cancelledTimer.callback();
    assert.equal(
      service.snapshot().active.length,
      1,
      "late canceled expiry cannot close replacement",
    );
    clock.advance(199);
    assert.equal(service.snapshot().active.length, 1);
    clock.advance(1);
    assert.equal(service.snapshot().active.length, 0);
    assert.deepEqual(transport.signals.at(-1)?.body, [first, 1]);
    assert.equal(service.snapshot().history[0]?.notification.actions.length, 0);
    assert.equal(prior.controls.invokeAction("default"), false);

    const critical = await notify(
      argumentsFor({ timeout: 1, hints: { urgency: variant("y", 2) } }),
    );
    clock.advance(10000);
    assert.equal(
      service.snapshot().active[0]?.id,
      critical,
      "critical notifications do not auto-expire",
    );
    const current = presentations.at(-1);
    assert(current);
    assert.equal(current.controls.invokeAction("not-requested"), false);
    assert.equal(current.controls.invokeAction("default"), true);
    assert.equal(current.controls.invokeAction("default"), false, "action only fires once");
    assert.deepEqual(
      transport.signals.slice(-2).map((signal) => [signal.member, signal.body, signal.destination]),
      [
        ["ActionInvoked", [critical, "default"], ":1.10"],
        ["NotificationClosed", [critical, 2], ":1.10"],
      ],
    );

    const live = await notify(argumentsFor({ timeout: 0 }));
    const replacementByOtherOwner = await notify(
      argumentsFor({ replaces: live, timeout: 0 }),
      ":1.11",
    );
    assert.notEqual(replacementByOtherOwner, live);
    await assert.rejects(call("CloseNotification", [live], ":1.11"), /no longer exists/);
    assert.equal(
      service.snapshot().active.length,
      2,
      "another producer cannot close an unrelated notification",
    );
    const liveControls = presentations.at(-2);
    assert(liveControls);
    transport.owners.get(":1.10")?.(null);
    assert.equal(liveControls.controls.invokeAction("retry"), false);
    assert.equal(
      service.snapshot().active.length,
      1,
      "producer loss only retires its own notifications",
    );
    await call("CloseNotification", [replacementByOtherOwner], ":1.11");
    await assert.rejects(
      call("CloseNotification", [replacementByOtherOwner], ":1.11"),
      /no longer exists/,
    );
    assert.deepEqual(transport.signals.at(-1)?.body, [replacementByOtherOwner, 3]);

    service.setDoNotDisturb(true);
    const shown = presentations.length;
    const suppressed = await notify(argumentsFor({ timeout: 20 }));
    assert.equal(presentations.length, shown);
    assert.equal(service.snapshot().doNotDisturb, true);
    assert.equal(service.snapshot().active[0]?.id, suppressed);
    clock.advance(20);
    assert.equal(service.snapshot().history[0]?.notification.id, suppressed);
    service.setDoNotDisturb(false);
    assert.equal(
      presentations.length,
      shown,
      "disabling DND does not replay expired notifications",
    );

    for (const bad of [
      ["Fixture", 0],
      argumentsFor({ actions: ["default"] }),
      argumentsFor({ actions: ["default", "Open", "default", "Duplicate"] }),
      argumentsFor({ body: "x".repeat(NOTIFICATION_LIMITS.bodyBytes + 1) }),
      argumentsFor({ hints: { urgency: variant("s", "critical") } }),
      argumentsFor({ hints: { urgency: variant("y", 3) } }),
      argumentsFor({
        hints: {
          "image-data": variant("(iiibiiay)", [
            1,
            1,
            4,
            true,
            8,
            4,
            new Uint8Array(NOTIFICATION_LIMITS.imageBytes + 1),
          ]),
        },
      }),
      argumentsFor({ timeout: -2 }),
      argumentsFor({ replaces: -1 }),
    ])
      await assert.rejects(call("Notify", bad), /Invalid|requires|Duplicate|limits/);
    await assert.rejects(call("Notify", argumentsFor(), "org.fake.Producer"), /unique bus sender/);
    await assert.rejects(call("CloseNotification", [-1]), /Invalid/);
    await assert.rejects(call("GetCapabilities", [1]), /no arguments/);
    await assert.rejects(call("GetServerInformation", [1]), /no arguments/);
    const wrongSignature = request(argumentsFor());
    wrongSignature.message.signature = "s";
    const notifyDescriptor = service.descriptor.methods.Notify;
    assert(notifyDescriptor);
    await assert.rejects(async () => notifyDescriptor.handler(wrongSignature), /signature/);
    assert.equal(service.snapshot().active.length, 0);

    const imageIgnored = await notify(
      argumentsFor({
        timeout: 0,
        hints: {
          "image-data": variant("(iiibiiay)", [1, 1, 4, true, 8, 4, [1, 2, 3, 255]]),
          "image-path": variant("s", "file:///private/no-read"),
          category: variant("s", "transfer.complete"),
        },
      }),
    );
    assert.equal(service.snapshot().active[0]?.category, "transfer.complete");
    assert.equal(Object.hasOwn(service.snapshot().active[0] ?? {}, "image"), false);
    assert.equal(service.dismiss(imageIgnored), true);

    for (let index = 0; index < NOTIFICATION_LIMITS.active; index++)
      await notify(argumentsFor({ timeout: 0 }));
    await assert.rejects(notify(argumentsFor({ timeout: 0 })), /Too many active/);
    const oldId = service.snapshot().active[0]?.id;
    assert(oldId);
    assert.equal(
      await notify(argumentsFor({ replaces: oldId, timeout: 0 })),
      oldId,
      "replacement works at capacity",
    );
    for (const entry of service.snapshot().active) service.dismiss(entry.id);
    assert.equal(service.snapshot().history.length, NOTIFICATION_LIMITS.history);
    const next = await notify(argumentsFor({ timeout: 0 }));
    assert(next > oldId, "closed IDs are not recycled");
    let listenerCalls = 0;
    const unsubscribe = service.subscribe(() => listenerCalls++);
    service.setDoNotDisturb(true);
    unsubscribe();
    service.setDoNotDisturb(false);
    assert.equal(listenerCalls, 1);
    const callback = presentations.at(-1);
    assert(callback);
    const lateOwner = transport.owners.get(":1.10");
    await service.dispose();
    await service.dispose();
    assert.equal(service.snapshot().active.length, 0);
    assert.equal(transport.owners.size, 0);
    const frozenChanges = changes;
    lateOwner?.(":1.10");
    clock.advance(100000);
    assert.equal(callback.controls.invokeAction("default"), false);
    assert.equal(callback.controls.dismiss(), false);
    assert.equal(changes, frozenChanges, "late callback after disposal cannot update observers");
    await assert.rejects(notify(), /disposed/);
    await assert.rejects(call("GetCapabilities", []), /disposed/);
    assert.equal(errors.length, 0);
  } finally {
    await service.dispose();
  }

  const passive = createNotificationService(new Transport(), { scheduler: new Clock() });
  try {
    const capabilities = passive.descriptor.methods.GetCapabilities;
    assert(capabilities);
    assert.deepEqual((await capabilities.handler(request([], ":1.10", "GetCapabilities"))).body, [
      ["body"],
    ]);
    const method = passive.descriptor.methods.Notify;
    assert(method);
    await method.handler(request(argumentsFor()));
    assert.deepEqual(
      passive.snapshot().active[0]?.actions,
      [],
      "without a presentation callback actions are unsupported",
    );
    assert.equal(passive.invokeAction(1, "default", 1), false);
  } finally {
    await passive.dispose();
  }

  const release: { finish: (() => void) | null } = { finish: null };
  let retired = 0;
  const slow = createNotificationService({
    emitSignal() {},
    watchSender(sender, changed) {
      return new Promise((resolve) => {
        release.finish = () => {
          changed(sender);
          resolve(async () => {
            retired++;
          });
        };
      });
    },
  });
  const method = slow.descriptor.methods.Notify;
  assert(method);
  const pending = method.handler(request(argumentsFor()));
  const rejection = assert.rejects(async () => pending, /no longer connected/);
  const cleanup = slow.dispose();
  release.finish?.();
  await rejection;
  await cleanup;
  assert.equal(retired, 1, "disposal awaits and retires an in-flight sender subscription");
  console.log("[notifications] model: replacement/expiry/actions/owner/DND/bounds/dispose passed");
}

async function until(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function privateBusCases() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-notifications-"));
  const daemon = spawn(
    "dbus-daemon",
    [
      "--session",
      "--nofork",
      "--nopidfile",
      `--address=unix:path=${path.join(directory, "bus")}`,
      "--print-address=1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = once(daemon, "exit").catch(() => []);
  let address = "",
    errors = "";
  daemon.stdout.on("data", (bytes: Buffer) => {
    address += bytes.toString();
  });
  daemon.stderr.on("data", (bytes: Buffer) => {
    errors += bytes.toString();
  });
  const startupError: { error: Error | null } = { error: null };
  daemon.on("error", (error) => {
    startupError.error = error;
  });
  const buses: SessionBus[] = [];
  let attached: Awaited<ReturnType<typeof attachNotificationService>> | null = null;
  try {
    await until(
      () => address.includes("\n") || startupError.error !== null || daemon.exitCode !== null,
      "private bus startup",
    );
    if (startupError.error) {
      if ("code" in startupError.error && startupError.error.code === "ENOENT") {
        console.log("[notifications] private-bus scope skipped: dbus-daemon unavailable");
        await exited.catch(() => {});
        return;
      }
      throw startupError.error;
    }
    assert(address.startsWith("unix:"), errors);
    const server = await SessionBus.connect(address.trim());
    buses.push(server);
    const client = await SessionBus.connect(address.trim());
    buses.push(client);
    const other = await SessionBus.connect(address.trim());
    buses.push(other);
    const clock = new Clock();
    const shown: NotificationControls[] = [];
    const presentationErrors: unknown[] = [];
    attached = await attachNotificationService(server, {
      scheduler: clock,
      present: (_, controls) => shown.push(controls),
      onError: (error) => presentationErrors.push(error),
    });
    const service = attached;
    const signals: DbusMessage[] = [];
    const removeClosed = await client.subscribeSignal(
      {
        sender: NOTIFICATIONS_BUS,
        path: NOTIFICATIONS_PATH,
        interface: NOTIFICATIONS_INTERFACE,
        member: "NotificationClosed",
      },
      (message) => signals.push(message),
    );
    const removeAction = await client.subscribeSignal(
      {
        sender: NOTIFICATIONS_BUS,
        path: NOTIFICATIONS_PATH,
        interface: NOTIFICATIONS_INTERFACE,
        member: "ActionInvoked",
      },
      (message) => signals.push(message),
    );
    const call = (bus: SessionBus, member: string, signature = "", body: unknown[] = []) =>
      bus.call({
        destination: NOTIFICATIONS_BUS,
        path: NOTIFICATIONS_PATH,
        interface: NOTIFICATIONS_INTERFACE,
        member,
        signature,
        body,
      });
    assert.deepEqual((await call(client, "GetCapabilities")).body, [["body", "actions"]]);
    assert.deepEqual((await call(client, "GetServerInformation")).body, [
      "Moire",
      "Moire",
      "0.0.0",
      "1.3",
    ]);
    const first = (await call(client, "Notify", "susssasa{sv}i", argumentsFor({ timeout: 100 })))
      .body?.[0];
    assert.equal(typeof first, "number");
    if (typeof first !== "number") throw new Error("Missing wire ID");
    const prior = shown[0];
    assert(prior);
    assert.equal(
      (
        await call(
          client,
          "Notify",
          "susssasa{sv}i",
          argumentsFor({ replaces: first, timeout: 100 }),
        )
      ).body?.[0],
      first,
    );
    assert.equal(prior.invokeAction("default"), false);
    const latest = shown.at(-1);
    assert(latest);
    assert.equal(latest.invokeAction("default"), true);
    await until(() => signals.length === 2, "real action/closed signals");
    assert.deepEqual(
      signals.map((message) => [message.member, message.body]),
      [
        ["ActionInvoked", [first, "default"]],
        ["NotificationClosed", [first, 2]],
      ],
    );
    assert.deepEqual(service.snapshot().active, []);
    const owned = (await call(client, "Notify", "susssasa{sv}i", argumentsFor({ timeout: 0 })))
      .body?.[0];
    await assert.rejects(call(other, "CloseNotification", "u", [owned]), /no longer exists/);
    assert.equal(service.snapshot().active.length, 1);
    client.close();
    await until(
      () => service.snapshot().active.length === 0,
      "actual producer disconnect revokes notifications",
    );
    assert.equal(shown.at(-1)?.invokeAction("default"), false);
    await removeClosed();
    await removeAction();
    await assert.rejects(attachNotificationService(other), /already owns/);
    const expiring = (await call(other, "Notify", "susssasa{sv}i", argumentsFor({ timeout: 10 })))
      .body?.[0];
    clock.advance(10);
    assert.equal(service.snapshot().active.length, 0);
    assert.equal(service.snapshot().history[0]?.notification.id, expiring);
    await assert.rejects(
      call(other, "Notify", "susssasa{sv}i", argumentsFor({ actions: ["bad"] })),
      /Invalid notification actions/,
    );
    assert.equal(presentationErrors.length, 0, "healthy private transport has no swallowed errors");
    await service.dispose();
    await assert.rejects(call(other, "GetCapabilities"), /ServiceUnknown|NameHasNoOwner/);
    attached = await attachNotificationService(other, {
      onError: (error) => presentationErrors.push(error),
    });
    await call(server, "Notify", "susssasa{sv}i", argumentsFor({ timeout: 0 }));
    daemon.kill("SIGTERM");
    await exited;
    await until(
      () => attached?.snapshot().active.length === 0,
      "bus loss clears active notifications",
    );
    await attached.dispose();
    attached = null;
    for (const error of presentationErrors)
      assert(
        error instanceof Error && "code" in error && error.code === "EPIPE",
        "only the deliberate daemon teardown can interrupt an in-flight RemoveMatch",
      );
    console.log(
      "[notifications] real private bus: descriptors/signals/replacement/producer loss/name conflict/restart/disconnect passed",
    );
  } finally {
    await attached?.dispose();
    for (const bus of buses) bus.close();
    if (daemon.exitCode === null && daemon.signalCode === null && daemon.pid)
      daemon.kill("SIGTERM");
    await exited.catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** Per-app rules: dropped, banner-less and history-less apps, read at each arrival. */
async function ruleCases() {
  const clock = new Clock(),
    transport = new Transport();
  const presented: NotificationEntry[] = [];
  const rules: Record<string, Partial<NotificationRule>> = {
    Muted: { allow: false },
    "org.moire.Quiet": { banners: false, sound: false },
    Fleeting: { history: false },
  };
  const chimes: string[] = [];
  const service = createNotificationService(transport, {
    scheduler: clock,
    present: (entry) => presented.push(entry),
    rule: (appId) => ({ ...DEFAULT_NOTIFICATION_RULE, ...rules[appId] }),
    sound: (entry) => chimes.push(entry.appId),
  });
  const notify = async (appName: string, hints: Record<string, unknown> = {}, replaces = 0) => {
    const args = argumentsFor({ hints, replaces, timeout: 0 });
    args[0] = appName;
    const result = await service.descriptor.methods.Notify!.handler(request(args));
    return result.body?.[0] as number;
  };

  const dropped = await notify("Muted");
  assert(dropped > 0, "a refused notification still gets an id");
  assert.equal(service.snapshot().active.length, 0, "a refused app shows nothing");
  assert.deepEqual(transport.signals.at(-1)?.body, [dropped, 2], "the sender hears it closed");

  // The desktop-entry hint names the app; its rule wins over the app name.
  await notify("Quiet app", { "desktop-entry": variant("s", "org.moire.Quiet.desktop") });
  const quiet = service.snapshot().active[0]!;
  assert.equal(quiet.appId, "org.moire.Quiet");
  assert.equal(quiet.banner, false);
  assert.equal(quiet.sound, false);
  assert.equal(presented.length, 0, "no banner is presented for a banner-less app");

  const fleeting = await notify("Fleeting");
  assert.equal(presented.length, 1, "an allowed app still gets its banner");
  assert(service.dismiss(fleeting));
  assert(
    !service.snapshot().history.some((item) => item.notification.id === fleeting),
    "a history-less app isn't kept once closed",
  );
  assert(service.dismiss(quiet.id));
  assert.equal(service.snapshot().history[0]?.notification.id, quiet.id);

  // Sound: new notifications of apps with Sound on chime; replacements, quiet apps, the
  // suppress-sound hint and Do not disturb don't.
  assert.deepEqual(chimes, ["Fleeting"], "the refused and the quiet app made no sound");
  const loud = await notify("Loud");
  await notify("Loud", {}, loud);
  await notify("Hushed", { "suppress-sound": variant("b", true) });
  await assert.rejects(
    Promise.resolve().then(() => notify("Bad", { "suppress-sound": variant("s", "yes") })),
    /suppress-sound/,
  );
  service.setDoNotDisturb(true);
  await notify("Loud");
  service.setDoNotDisturb(false);
  assert.deepEqual(chimes, ["Fleeting", "Loud"]);

  // Turning an app off later closes a replacement of its open notification.
  const open = await notify("Later");
  rules.Later = { allow: false };
  assert.equal(await notify("Later", {}, open), open);
  assert(!service.snapshot().active.some((item) => item.id === open));
  await service.dispose();
  console.log(
    "[notifications] per-app rules: allow, banners, sound (alert, DND, replacement, suppress-sound) and history passed",
  );
}

await modelCases();
await ruleCases();
await privateBusCases();
