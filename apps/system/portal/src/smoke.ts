/** AppChooser, the native Open With entry point, and who may call what. */
import assert from "node:assert/strict";
import path from "node:path";
import { variant } from "@moire/dbus";
import { startPortalFixture } from "./testing";

const APP_CHOOSER = "org.freedesktop.impl.portal.AppChooser";
const fixture = await startPortalFixture("chooser");
try {
  await fixture.start();
  const stranger = await fixture.connect();
  const chooseBody = (handle: string) => [
    handle,
    "org.moire.Smoke",
    "",
    ["moire-files.desktop"],
    { content_type: variant("s", "inode/directory"), filename: variant("s", "Desktop") },
  ];

  // Only the frontend may call a backend interface: an app id is only as good as its source.
  await assert.rejects(
    fixture.call(
      APP_CHOOSER,
      "ChooseApplication",
      "ossasa{sv}",
      chooseBody(fixture.requestHandle("stranger")),
      stranger,
    ),
    /AccessDenied/,
  );
  // A request handle outside the request tree would shadow another object.
  await assert.rejects(
    fixture.call(
      APP_CHOOSER,
      "ChooseApplication",
      "ossasa{sv}",
      chooseBody("/org/freedesktop/portal/desktop"),
    ),
    /InvalidArgs/,
  );

  const handle = fixture.requestHandle("chooser");
  const choose = fixture.call(APP_CHOOSER, "ChooseApplication", "ossasa{sv}", chooseBody(handle));
  await new Promise((resolve) => setTimeout(resolve, 150));
  // A second dialog is refused while one is open, and only the requester can close its request.
  const second = await fixture.call(
    APP_CHOOSER,
    "ChooseApplication",
    "ossasa{sv}",
    chooseBody(fixture.requestHandle("second")),
  );
  assert.equal(second.body?.[0], 2);
  await assert.rejects(fixture.closeRequest(handle, stranger), /AccessDenied/);
  await fixture.closeRequest(handle);
  const reply = await choose;
  assert.equal(reply.signature, "ua{sv}");
  assert.equal(reply.body?.[0], 2, "request cancellation did not end the chooser");

  // Moire's own apps reach the same picker without the frontend.
  const nativeHandle = fixture.requestHandle("native_chooser");
  const file = path.join(fixture.home, "note.txt");
  const nativeChoose = fixture.call(
    "org.moire.FileActivation1",
    "OpenWith",
    "so",
    [file, nativeHandle],
    stranger,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  await fixture.closeRequest(nativeHandle, stranger);
  const nativeReply = await nativeChoose;
  assert.equal(nativeReply.signature, "u");
  assert.equal(nativeReply.body?.[0], 2, "native chooser cancellation did not end the picker");

  const version = await fixture.call("org.freedesktop.DBus.Properties", "Get", "ss", [
    APP_CHOOSER,
    "version",
  ]);
  assert.deepEqual(version.body?.[0], { signature: "u", value: 2 });
  console.log("[portal/smoke] ok");
} finally {
  await fixture.close();
}
