import assert from "node:assert/strict";
import { SessionBus } from "./index";

const bus = await SessionBus.connect();
const nameResult = await bus.requestName("org.moire.DBusSmoke");
assert.equal(nameResult, 1, "failed to become the primary D-Bus name owner");

bus.exportObject("/org/moire/DBusSmoke", {
  name: "org.moire.DBusSmoke",
  methods: {
    Echo: {
      inSignature: "s",
      outSignature: "s",
      handler: ({ body }) => ({ body: [String(body[0])] }),
    },
  },
});

const echo = await bus.call({
  destination: "org.moire.DBusSmoke",
  path: "/org/moire/DBusSmoke",
  interface: "org.moire.DBusSmoke",
  member: "Echo",
  signature: "s",
  body: ["moire"],
});
assert.deepEqual(echo.body, ["moire"]);

const introspection = await bus.call({
  destination: "org.moire.DBusSmoke",
  path: "/org/moire/DBusSmoke",
  interface: "org.freedesktop.DBus.Introspectable",
  member: "Introspect",
});
assert.match(String(introspection.body?.[0]), /org\.moire\.DBusSmoke/);

bus.close();
console.log("[dbus/smoke] ok");
