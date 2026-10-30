/**
 * Inhibit portal against a stand-in compositor (org.moire.Idle1 and Lock1): an inhibit is held
 * for as long as its Request object, and a monitor reports the lock screen.
 * A suspend inhibit reaches the compositor from the connection that owns the backend's bus name,
 * carrying the frontend's app id untouched: the two facts the sleep-blocking allowlist keys on.
 * The compositor's side (idle policy, the allowlist, the lid) is covered by
 * power-session.smoke.ts.
 */
import assert from "node:assert/strict";
import { variant } from "@moire/dbus";
import { PORTAL_NAME } from "./common";
import { startPortalFixture, until } from "./testing";

const INHIBIT = "org.freedesktop.impl.portal.Inhibit";
const fixture = await startPortalFixture("inhibit");
try {
  const compositor = await fixture.connect();
  const held = new Map<number, unknown[]>();
  const senders = new Set<string | undefined>();
  let nextCookie = 5;
  let locked = false;
  compositor.exportObject("/org/moire/Idle1", {
    name: "org.moire.Idle1",
    methods: {
      Inhibit: {
        inSignature: "sus",
        outSignature: "u",
        handler: ({ body, message }) => {
          senders.add(message.sender);
          held.set(nextCookie, body);
          return { body: [nextCookie++] };
        },
      },
      Uninhibit: {
        inSignature: "u",
        outSignature: "",
        handler: ({ body }) => {
          if (!held.delete(Number(body[0]))) throw new Error("unknown cookie");
          return {};
        },
      },
    },
  });
  compositor.exportObject("/org/moire/Lock1", {
    name: "org.moire.Lock1",
    methods: {
      GetLocked: { inSignature: "", outSignature: "b", handler: () => ({ body: [locked] }) },
    },
  });
  assert.equal(await compositor.requestName("org.moire.Display1", 4), 1);
  await fixture.start();
  const states = await fixture.signals(INHIBIT, "StateChanged");
  const inhibit = (
    handle: string,
    flags: number,
    reason = "Playing a film",
    appId = "org.example.Player",
  ) =>
    fixture.call(INHIBIT, "Inhibit", "ossua{sv}", [
      handle,
      appId,
      "",
      flags,
      { reason: variant("s", reason) },
    ]);

  // Suspend and idle, held until the request closes.
  const handle = fixture.requestHandle("inhibit");
  const reply = await inhibit(handle, 4 | 8);
  assert.equal(reply.signature, "");
  assert.deepEqual([...held.values()], [["org.example.Player", 12, "Playing a film"]]);
  const stranger = await fixture.connect();
  await assert.rejects(fixture.closeRequest(handle, stranger), /AccessDenied/);
  assert.equal(held.size, 1, "only the requester releases an inhibitor");
  await fixture.closeRequest(handle);
  await until(() => held.size === 0, "closing the request releases the inhibitor");
  await assert.rejects(fixture.closeRequest(handle), "the request object is gone");

  // Two at once are independent.
  await inhibit(fixture.requestHandle("first"), 1, "Unsaved work");
  await inhibit(fixture.requestHandle("second"), 8);
  assert.equal(held.size, 2);
  await fixture.closeRequest(fixture.requestHandle("first"));
  await until(() => held.size === 1, "one released");
  assert.deepEqual([...held.values()][0], ["org.example.Player", 8, "Playing a film"]);

  // Sleep blocking. A suspend-only request is accepted like any other (whether it may hold off
  // a lid close is the compositor's decision, from the user's allowlist), and it arrives from
  // the owner of the backend's name with the app id exactly as the frontend derived it: an
  // empty one stays empty rather than being filled in, so it can never match a grant.
  {
    const before = new Set(held.keys());
    const added = () => [...held].filter(([cookie]) => !before.has(cookie)).map(([, body]) => body);
    await inhibit(fixture.requestHandle("awake"), 4, "Long build", "org.example.Agent");
    await inhibit(fixture.requestHandle("unattributed"), 4, "Long build", "");
    assert.deepEqual(added(), [
      ["org.example.Agent", 4, "Long build"],
      ["", 4, "Long build"],
    ]);
    const owner = await compositor.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "GetNameOwner",
      signature: "s",
      body: [PORTAL_NAME],
    });
    assert.deepEqual([...senders], [owner.body?.[0]], "every inhibit comes from the name's owner");
    await fixture.closeRequest(fixture.requestHandle("awake"));
    await fixture.closeRequest(fixture.requestHandle("unattributed"));
    await until(() => added().length === 0, "both released");
  }

  await assert.rejects(inhibit(fixture.requestHandle("none"), 0), /Invalid inhibit flags/);
  await assert.rejects(inhibit(fixture.requestHandle("unknown"), 16), /Invalid inhibit flags/);
  await assert.rejects(inhibit("/org/moire/Idle1", 8), /InvalidArgs/);
  await assert.rejects(
    fixture.call(
      INHIBIT,
      "Inhibit",
      "ossua{sv}",
      [fixture.requestHandle("stranger"), "org.example.Player", "", 8, {}],
      stranger,
    ),
    /AccessDenied/,
  );
  assert.equal(held.size, 1);

  // A monitor hears the current state, then every lock and unlock.
  const session = "/org/freedesktop/portal/desktop/session/smoke/monitor";
  const monitor = await fixture.call(INHIBIT, "CreateMonitor", "ooss", [
    fixture.requestHandle("monitor"),
    session,
    "org.example.Player",
    "",
  ]);
  assert.equal(monitor.body?.[0], 0);
  await until(() => states.length === 1, "initial state");
  assert.deepEqual(states[0], [
    session,
    {
      "screensaver-active": { signature: "b", value: false },
      "session-state": { signature: "u", value: 1 },
    },
  ]);
  locked = true;
  compositor.emitSignal({
    path: "/org/moire/Lock1",
    interface: "org.moire.Lock1",
    member: "LockedChanged",
    signature: "b",
    body: [true],
  });
  await until(() => states.length === 2, "lock reported");
  assert.deepEqual((states[1]![1] as Record<string, unknown>)["screensaver-active"], {
    signature: "b",
    value: true,
  });
  await fixture.call(INHIBIT, "QueryEndResponse", "o", [session]);
  await fixture.frontend.call({
    destination: PORTAL_NAME,
    path: session,
    interface: "org.freedesktop.impl.portal.Session",
    member: "Close",
  });
  compositor.emitSignal({
    path: "/org/moire/Lock1",
    interface: "org.moire.Lock1",
    member: "LockedChanged",
    signature: "b",
    body: [false],
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(states.length, 2, "a closed monitor hears nothing more");
  console.log("[portal/inhibit] ok");
} finally {
  await fixture.close();
}
