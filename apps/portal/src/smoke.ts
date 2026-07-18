import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SessionBus, variant } from "@moire/dbus";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const portal = spawn(
  path.join(root, "node_modules/.bin/tsx"),
  [path.join(root, "apps/portal/src/main.tsx")],
  {
    env: { ...process.env, MOIRE_UI_PLATFORM: "headless" },
    stdio: "inherit",
  },
);

const bus = await SessionBus.connect();
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await bus.call({
        destination: "org.freedesktop.DBus",
        path: "/org/freedesktop/DBus",
        interface: "org.freedesktop.DBus",
        member: "GetNameOwner",
        signature: "s",
        body: ["org.freedesktop.impl.portal.desktop.moire"],
      });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.equal(ready, true, "portal backend did not own its D-Bus name");

  const handle = "/org/freedesktop/portal/desktop/request/smoke/chooser";
  const choose = bus.call({
    destination: "org.freedesktop.impl.portal.desktop.moire",
    path: "/org/freedesktop/portal/desktop",
    interface: "org.freedesktop.impl.portal.AppChooser",
    member: "ChooseApplication",
    signature: "ossasa{sv}",
    body: [
      handle,
      "org.moire.Smoke",
      "",
      ["moire-files.desktop"],
      {
        content_type: variant("s", "inode/directory"),
        filename: variant("s", "Desktop"),
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await bus.call({
    destination: "org.freedesktop.impl.portal.desktop.moire",
    path: handle,
    interface: "org.freedesktop.impl.portal.Request",
    member: "Close",
  });
  const reply = await choose;
  assert.equal(reply.signature, "ua{sv}");
  assert.equal(reply.body?.[0], 2, "request cancellation did not end the chooser");
  console.log("[portal/smoke] ok");
} finally {
  bus.close();
  portal.kill("SIGTERM");
}
