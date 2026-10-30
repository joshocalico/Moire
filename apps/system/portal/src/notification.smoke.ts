/**
 * Notification portal against a stand-in org.freedesktop.Notifications: a portal notification
 * becomes a Notify call, a replacement reuses the id, its buttons come back as ActionInvoked with
 * their targets, and removal closes it.
 */
import assert from "node:assert/strict";
import { variant } from "@moire/dbus";
import { notifyRequest } from "./notification";
import { startPortalFixture, until } from "./testing";

const NOTIFICATION = "org.freedesktop.impl.portal.Notification";
const SERVER = "org.freedesktop.Notifications";
const SERVER_PATH = "/org/freedesktop/Notifications";

// The translation on its own.
{
  const request = notifyRequest("org.example.Chat", {
    title: variant("s", "Ada\u0007 Lovelace"),
    "markup-body": variant("s", "<b>Hello</b>"),
    priority: variant("s", "urgent"),
    category: variant("s", "im.received"),
    "default-action": variant("s", "app.open"),
    buttons: variant("aa{sv}", [
      { label: variant("s", "Reply"), action: variant("s", "app.reply") },
      { label: variant("s", ""), action: variant("s", "app.unlabelled") },
    ]),
  });
  assert.equal(request.summary, "Ada Lovelace", "control characters are dropped");
  assert.equal(request.body, "<b>Hello</b>");
  assert.deepEqual(request.actions, ["default", "Open", "button1", "Reply"]);
  assert.deepEqual(request.hints.urgency, { signature: "y", value: 2 });
  assert.deepEqual(request.hints["desktop-entry"], { signature: "s", value: "org.example.Chat" });
  assert.deepEqual(request.hints.category, { signature: "s", value: "im.received" });
  assert.equal(notifyRequest("bad id!", {}).hints["desktop-entry"], undefined);
}

const fixture = await startPortalFixture("notification");
try {
  const server = await fixture.connect();
  const notified: unknown[][] = [];
  const closedIds: number[] = [];
  let nextId = 41;
  let callers = new Set<string>();
  server.exportObject(SERVER_PATH, {
    name: SERVER,
    methods: {
      Notify: {
        inSignature: "susssasa{sv}i",
        outSignature: "u",
        handler: ({ body, message }) => {
          notified.push(body);
          callers.add(message.sender ?? "");
          return { body: [Number(body[1]) || nextId++] };
        },
      },
      CloseNotification: {
        inSignature: "u",
        outSignature: "",
        handler: ({ body }) => {
          closedIds.push(Number(body[0]));
          return {};
        },
      },
    },
  });
  assert.equal(await server.requestName(SERVER, 4), 1);
  await fixture.start();
  const invoked = await fixture.signals(NOTIFICATION, "ActionInvoked");
  const add = (id: string, notification: Record<string, unknown>) =>
    fixture.call(NOTIFICATION, "AddNotification", "ssa{sv}", [
      "org.example.Chat",
      id,
      notification,
    ]);
  const emit = (member: string, signature: string, body: unknown[]) =>
    server.emitSignal({
      path: SERVER_PATH,
      interface: SERVER,
      member,
      destination: [...callers][0],
      signature,
      body,
    });

  await add("message-1", {
    title: variant("s", "Ada"),
    body: variant("s", "Are you there?"),
    "default-action": variant("s", "app.open-chat"),
    "default-action-target": variant("s", "ada"),
    buttons: variant("aa{sv}", [
      {
        label: variant("s", "Reply"),
        action: variant("s", "app.reply"),
        target: variant("u", 7),
      },
    ]),
  });
  assert.equal(notified.length, 1);
  const [appName, replaces, , summary, body, actions, hints, timeout] = notified[0]!;
  assert.equal(appName, "Chat", "the app is named as the tray names apps");
  assert.equal(replaces, 0);
  assert.equal(summary, "Ada");
  assert.equal(body, "Are you there?");
  assert.deepEqual(actions, ["default", "Open", "button1", "Reply"]);
  assert.deepEqual((hints as Record<string, unknown>)["desktop-entry"], {
    signature: "s",
    value: "org.example.Chat",
  });
  assert.equal(timeout, -1);

  // The same portal id again replaces the notification on screen.
  await add("message-1", { title: variant("s", "Ada (2)") });
  assert.equal(notified[1]![1], 41, "a replacement names the server's id");
  await add("message-2", {
    title: variant("s", "Grace"),
    buttons: variant("aa{sv}", [
      { label: variant("s", "Mark read"), action: variant("s", "app.read") },
    ]),
  });
  assert.equal(notified[2]![1], 0);

  // The replacement dropped the first version's buttons; message-2's button reaches the app.
  emit("ActionInvoked", "us", [41, "button1"]);
  emit("ActionInvoked", "us", [42, "button0"]);
  await until(() => invoked.length === 1, "ActionInvoked forwarded");
  assert.deepEqual(invoked[0], ["org.example.Chat", "message-2", "app.read", []]);

  // A target travels with its action.
  await add("message-3", {
    title: variant("s", "Linus"),
    "default-action": variant("s", "app.open-chat"),
    "default-action-target": variant("s", "linus"),
  });
  emit("ActionInvoked", "us", [43, "default"]);
  await until(() => invoked.length === 2, "default action forwarded");
  assert.deepEqual(invoked[1], [
    "org.example.Chat",
    "message-3",
    "app.open-chat",
    [{ signature: "s", value: "linus" }],
  ]);

  // Closed on the desktop: forgotten here, so a stale action goes nowhere.
  emit("NotificationClosed", "uu", [43, 2]);
  emit("ActionInvoked", "us", [43, "default"]);
  await fixture.call(NOTIFICATION, "RemoveNotification", "ss", ["org.example.Chat", "message-1"]);
  await until(() => closedIds.length === 1, "RemoveNotification closes the notification");
  assert.deepEqual(closedIds, [41]);
  await fixture.call(NOTIFICATION, "RemoveNotification", "ss", ["org.example.Chat", "message-3"]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(closedIds, [41], "an already closed notification is not closed again");
  assert.equal(invoked.length, 2);

  const stranger = await fixture.connect();
  await assert.rejects(
    fixture.call(
      NOTIFICATION,
      "AddNotification",
      "ssa{sv}",
      ["org.example.Chat", "spoofed", { title: variant("s", "Not from Chat") }],
      stranger,
    ),
    /AccessDenied/,
  );
  assert.equal(notified.length, 4);
  console.log("[portal/notification] ok");
} finally {
  await fixture.close();
}
