/**
 * Opening files and links through org.moire.FileActivation1: the default handler receives the
 * path or URI as one argument, programs are refused, scripts need the chooser, and nothing in a
 * URI reaches a shell. Descriptor-based OpenFile needs Linux.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startPortalFixture, until } from "./testing";

const ACTIVATION = "org.moire.FileActivation1";
const fixture = await startPortalFixture("open-uri");
const log = path.join(fixture.home, "launched.log");
const launched = () =>
  fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
try {
  // Stand-in applications that record what they were started with.
  const recorder = path.join(fixture.home, "record.sh");
  fs.writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`, { mode: 0o755 });
  const applications = path.join(fixture.dataHome, "applications");
  fs.mkdirSync(applications, { recursive: true });
  const entry = (id: string, code: string, mimeTypes: string) =>
    fs.writeFileSync(
      path.join(applications, `${id}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${id}\nExec=${recorder} ${id} ${code}\nMimeType=${mimeTypes}\n`,
    );
  entry("browser", "%u", "x-scheme-handler/http;x-scheme-handler/https;");
  entry("viewer", "%f", "text/plain;");
  entry("files", "%u", "inode/directory;");

  // Resolved, since targets are (the scratch directory sits behind a link on some hosts).
  const documents = path.join(fs.realpathSync(fixture.home), "docs");
  fs.mkdirSync(documents);
  const note = path.join(documents, "it's a note.txt");
  fs.writeFileSync(note, "hello");
  const program = path.join(documents, "tool");
  fs.writeFileSync(program, "\x7fELF", { mode: 0o755 });
  const launcher = path.join(documents, "evil.desktop");
  fs.writeFileSync(launcher, "[Desktop Entry]\nType=Application\nExec=touch pwned\n");
  const disguised = path.join(documents, "report.txt");
  fs.symlinkSync(program, disguised);
  const script = path.join(documents, "setup.sh");
  fs.writeFileSync(script, "#!/bin/sh\ntouch pwned\n", { mode: 0o755 });

  await fixture.start();
  const app = await fixture.connect();
  let serial = 0;
  const openUri = (uri: string, options = {}) =>
    fixture.call(
      ACTIVATION,
      "OpenURI",
      "ossa{sv}",
      [fixture.requestHandle(`open${serial++}`), "", uri, options],
      app,
    );

  // A link goes to the default browser, whole and as one argument.
  const hostile = "https://example.com/a?b=c&d=$(touch%20pwned);`id`'x'";
  assert.equal((await openUri(hostile)).body?.[0], 0);
  await until(() => launched().length === 1, "browser launched");
  assert.equal(launched()[0], `browser ${new URL(hostile).href}`);

  // A document goes to its default application by path.
  assert.equal((await openUri(pathToFileURL(note).href)).body?.[0], 0);
  await until(() => launched().length === 2, "viewer launched");
  assert.equal(launched()[1], `viewer ${note}`);

  // A folder opens in the file manager.
  assert.equal((await openUri(pathToFileURL(documents).href)).body?.[0], 0);
  await until(() => launched().length === 3, "file manager launched");
  assert.equal(launched()[2], `files ${pathToFileURL(documents).href}`);

  // Programs, launchers and a program behind an innocent name are refused outright.
  for (const refused of [program, launcher, disguised])
    await assert.rejects(openUri(pathToFileURL(refused).href), /NotAllowed/, refused);
  for (const refused of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file://elsewhere/etc/passwd",
    "not a uri",
    "https://example.com/\nsecond-line",
    pathToFileURL(path.join(documents, "missing.txt")).href,
  ])
    await assert.rejects(openUri(refused), /NotAllowed/, refused);

  // A scheme nobody handles fails without a dialog.
  assert.equal((await openUri("gopher://example.com/")).body?.[0], 2);

  // A script is never run or defaulted: it opens only through the chooser, here cancelled.
  const scriptHandle = fixture.requestHandle("script");
  const pending = fixture.call(
    ACTIVATION,
    "OpenURI",
    "ossa{sv}",
    [scriptHandle, "", pathToFileURL(script).href, {}],
    app,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  await fixture.closeRequest(scriptHandle, app);
  assert.equal((await pending).body?.[0], 2);

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(launched().length, 3, "nothing else was started");
  assert.equal(fs.existsSync(path.join(documents, "pwned")), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), "pwned")), false);

  if (process.platform === "linux") {
    const { dbusUnixFdTransport } = await import("@moire/sys/dbus-fds");
    const { SessionBus } = await import("@moire/dbus");
    const address = `unix:path=${path.join(fixture.home, "bus")}`;
    const fdBus = await SessionBus.connect(address, { unixFds: dbusUnixFdTransport });
    try {
      const openFd = (member: string, file: string) => {
        const fd = fs.openSync(file, "r");
        return fdBus
          .call({
            destination: "org.freedesktop.impl.portal.desktop.moire",
            path: "/org/freedesktop/portal/desktop",
            interface: ACTIVATION,
            member,
            signature: "osha{sv}",
            body: [fixture.requestHandle(`fd${serial++}`), "", 0, {}],
            fds: [fd],
          })
          .finally(() => fs.closeSync(fd));
      };
      assert.equal((await openFd("OpenFile", note)).body?.[0], 0);
      await until(() => launched().length === 4, "viewer launched for a descriptor");
      assert.equal(launched()[3], `viewer ${note}`);
      await assert.rejects(openFd("OpenFile", program), /NotAllowed/);
      assert.equal((await openFd("OpenDirectory", note)).body?.[0], 0);
      await until(() => launched().length === 5, "containing folder shown");
      assert.equal(launched()[4], `files ${pathToFileURL(documents).href}`);
    } finally {
      fdBus.close();
    }
    console.log("[portal/open-uri] ok (with descriptors)");
  } else {
    await assert.rejects(
      fixture.call(
        ACTIVATION,
        "OpenFile",
        "osha{sv}",
        [fixture.requestHandle("fd"), "", 0, {}],
        app,
      ),
      /NotSupported/,
    );
    console.log("[portal/open-uri] ok (descriptor cases need Linux)");
  }
} finally {
  await fixture.close();
}
