/**
 * The Display1 gate: CaptureScreenshot answers only the Screenshot app the compositor launched
 * from its own install tree, the layout and mode methods only Settings. Callers are stand-in bus
 * connections whose pids a fake bus daemon reports, over a fake process table.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseDesktopCommand } from "@moire/core";
import { DbusRemoteError, type DbusMethod, type SessionBus } from "@moire/dbus";
import {
  ACCESS_DENIED,
  CAPTURE_REFUSAL,
  DISPLAY_CONFIG_REFUSAL,
  TEST_CONTROL_ENABLED,
  TEST_CONTROL_GRANT,
  launchGate,
  orTestControl,
  pinTrustedLaunch,
  testControlGate,
  type FileFacts,
  restrictTo,
  trustedApps,
} from "./display-access";
import { LaunchRecords, busPeerPid, type ProcessInspector } from "./sleep-blockers";

let cases = 0;
const root = "/opt/moire";
const trusted = trustedApps(root);
const apps = [trusted.screenshot, trusted.settings];
const installed = (file: string) => file.startsWith(`${root}/`);

// Pinning: the bundled launchers run from the install tree, whatever PATH holds.
assert.equal(trusted.screenshot.file, "/opt/moire/apps/bundled/screenshot/moire-screenshot");
assert.equal(trusted.screenshot.command, "moire-screenshot");
assert.deepEqual(pinTrustedLaunch("moire-screenshot", apps, installed), {
  exec: "'/opt/moire/apps/bundled/screenshot/moire-screenshot'",
  file: trusted.screenshot.file,
});
{
  // Arguments survive the requoting, quotes included.
  const pinned = pinTrustedLaunch('moire-screenshot "/home/me/it\'s here.png"', apps, installed);
  assert.deepEqual(parseDesktopCommand(pinned!.exec), [
    trusted.screenshot.file,
    "/home/me/it's here.png",
  ]);
}
// The shell launches Settings by its absolute launcher path.
assert.equal(
  pinTrustedLaunch("'/opt/moire/apps/core/settings/moire-settings' display", apps, installed)?.file,
  trusted.settings.file,
);
// A same-named file anywhere else, a relative path, other apps, and nonsense are not pinned.
assert.equal(pinTrustedLaunch("/home/me/.local/bin/moire-screenshot", apps, installed), null);
assert.equal(pinTrustedLaunch("./moire-screenshot", apps, installed), null);
assert.equal(pinTrustedLaunch("moire-terminal", apps, installed), null);
assert.equal(pinTrustedLaunch("'unterminated", apps, installed), null);
assert.equal(
  pinTrustedLaunch("moire-screenshot", apps, () => false),
  null,
  "launcher missing",
);
cases++;

/**
 * screenshot(100) → node(101) → xdg-open(102, detached: its own session) → the directory handler
 * from mimeapps.list (103); settings(200) → node(201); terminal(300) → shell(310) → busctl(320)
 * and a moire-screenshot run from that shell (330); an unpinned "moire-screenshot" launch (400),
 * as a launch with the launcher missing would be; a user service (500) under init.
 */
const parents = new Map([
  [101, 100],
  [102, 101],
  [103, 102],
  [100, 1],
  [201, 200],
  [200, 1],
  [320, 310],
  [330, 310],
  [310, 300],
  [300, 1],
  [400, 1],
  [500, 1],
]);
const inspector: ProcessInspector = {
  parent: (pid) => parents.get(pid) ?? null,
  executable: () => "/usr/bin/node",
  // Every launch leads its own session (spawned with setsid), as does the detached xdg-open.
  session: (pid) => {
    for (
      let current: number | undefined = pid;
      current !== undefined;
      current = parents.get(current)
    )
      if (current === 102 || parents.get(current) === 1) return current;
    return null;
  },
};
const child = (pid: number) => Object.assign(new EventEmitter(), { pid });
const launches = new LaunchRecords();
const launch = (pid: number, exec: string) => {
  const pinned = pinTrustedLaunch(exec, apps, installed);
  return launches.track(child(pid), exec, pinned?.file);
};
const screenshotApp = launch(100, "moire-screenshot");
launch(200, "'/opt/moire/apps/core/settings/moire-settings'");
launch(300, "moire-terminal");
launches.track(child(400), "moire-screenshot");
assert.deepEqual(launches.rootOf(101, inspector), {
  pid: 100,
  command: "moire-screenshot",
  file: trusted.screenshot.file,
});
assert.deepEqual(launches.rootOf(330, inspector), { pid: 300, command: "moire-terminal" });

// The bus daemon: each sender's pid, asked at call time; `pids` changes between calls below.
const pids = new Map<string, number>([
  [":1.10", 101], // the Screenshot app
  [":1.11", 100], // the Screenshot launch itself (the installed wrapper execs node in place)
  [":1.12", 103], // what Screenshot's "Show in Files" ran
  [":1.20", 201], // Settings
  [":1.30", 320], // busctl in a terminal
  [":1.31", 330], // moire-screenshot run from that terminal
  [":1.40", 400], // a "moire-screenshot" launch that was not pinned
  [":1.50", 500], // a user service
  [":1.60", 9999], // a pid with no process behind it
  [":1.61", 1], // init
]);
const asked: string[] = [];
const bus = {
  async call(message: { member: string; body: unknown[] }) {
    assert.equal(message.member, "GetConnectionUnixProcessID");
    const sender = String(message.body[0]);
    asked.push(sender);
    if (!pids.has(sender))
      throw new DbusRemoteError("org.freedesktop.DBus.Error.NameHasNoOwner", sender);
    return { body: [pids.get(sender)] };
  },
} as unknown as SessionBus;
assert.equal(await busPeerPid(bus, ":1.10"), 101);
const gate = launchGate({ launches, inspector });

// The real Display1 methods' shape: a capture that is refused while a secure prompt is up.
let promptUp = false;
let captures = 0;
const capture: DbusMethod = {
  inSignature: "",
  outSignature: "s",
  handler: () => {
    if (promptUp) throw new Error("Display capture unavailable");
    captures++;
    return { body: ["/run/user/1000/moire-capture-x/capture.png"] };
  },
};
let modeChanges = 0;
const setMode: DbusMethod = {
  inSignature: "s",
  outSignature: "b",
  handler: () => {
    modeChanges++;
    return { body: [true] };
  },
};
const captureScreenshot = restrictTo(bus, gate, trusted.screenshot, CAPTURE_REFUSAL, capture);
const setModeGated = restrictTo(bus, gate, trusted.settings, DISPLAY_CONFIG_REFUSAL, setMode);
const call = (method: DbusMethod, sender: string | undefined) =>
  method.handler({
    message: { type: 1, serial: 1, sender, body: [] } as never,
    body: [],
    fds: [],
    keepFd: () => {
      throw new Error("no descriptors");
    },
  });
const refused = (
  sender: string | undefined,
  method = captureScreenshot,
  detail = CAPTURE_REFUSAL,
) =>
  assert.rejects(
    async () => call(method, sender),
    (error: unknown) =>
      error instanceof DbusRemoteError &&
      error.errorName === ACCESS_DENIED &&
      error.message.includes(detail),
  );

// The Screenshot app (a descendant of its pinned launch) captures.
assert.deepEqual(await call(captureScreenshot, ":1.10"), {
  body: ["/run/user/1000/moire-capture-x/capture.png"],
});
assert.equal((await call(captureScreenshot, ":1.11")).body?.length, 1);
assert.equal(captures, 2);
cases++;

// Everyone else is refused before the capture runs.
await refused(":1.12"); // a descendant in another session: a handler xdg-open chose
await refused(":1.30"); // busctl in a terminal
await refused(":1.31"); // the Screenshot launcher run from a terminal is the terminal's launch
await refused(":1.40"); // a launch by name that the compositor did not pin to its install tree
await refused(":1.50"); // not launched by the compositor
await refused(":1.20"); // Settings may not capture
await refused(":1.60"); // unknown pid
await refused(":1.61"); // pid 1
await refused(":1.99"); // left the bus
await refused(undefined); // no sender at all
assert.equal(captures, 2, "no refused call reached the capture");
cases++;

// A secure prompt on screen refuses the Screenshot app too, with the compositor's own error.
promptUp = true;
await assert.rejects(async () => call(captureScreenshot, ":1.10"), /Display capture unavailable/);
promptUp = false;
assert.equal(captures, 2);
cases++;

// Display configuration is Settings' alone.
assert.deepEqual(await call(setModeGated, ":1.20"), { body: [true] });
await refused(":1.10", setModeGated, DISPLAY_CONFIG_REFUSAL);
await refused(":1.30", setModeGated, DISPLAY_CONFIG_REFUSAL);
assert.equal(modeChanges, 1);
cases++;

// The pid is asked of the daemon on every call, never cached: once the Screenshot app has exited
// its record is gone, and a process that later holds that pid (or that connection name) is not it.
asked.length = 0;
screenshotApp.emit("exit");
await refused(":1.10");
assert.deepEqual(asked, [":1.10"]);
pids.set(":1.10", 320);
await refused(":1.10");
assert.deepEqual(asked, [":1.10", ":1.10"]);
cases++;

// Without session ids (an inspector that cannot read them) nobody passes.
{
  const blind = launchGate({
    launches,
    inspector: { parent: inspector.parent, executable: inspector.executable },
  });
  assert.equal(await blind(bus, ":1.20", trusted.settings), false);
}
cases++;

// Test images only: the guest display scripts, run from a root shell (900) through runuser (910)
// as gdbus (920), while root's grant names that shell. Busctl in a terminal (320), a process that
// double-forked away from the shell's tree (930, now under init), and Settings' launch are
// otherwise what they were.
{
  const tree = new Map([...parents, [910, 900], [920, 910], [900, 1], [930, 1]]);
  const testInspector: ProcessInspector = {
    ...inspector,
    parent: (pid) => tree.get(pid) ?? null,
    startTime: (pid) => (pid === 900 ? 4242 : pid > 1 ? 1 : null),
  };
  const uids = new Map([
    [900, 0],
    [910, 0],
  ]);
  const now = 1_000_000;
  const facts = new Map<string, FileFacts>([
    [TEST_CONTROL_ENABLED, { uid: 0, mode: 0o100444, file: true, directory: false, mtimeMs: 0 }],
    ["/run/moire-test", { uid: 0, mode: 0o40755, file: false, directory: true, mtimeMs: now }],
    [TEST_CONTROL_GRANT, { uid: 0, mode: 0o100644, file: true, directory: false, mtimeMs: now }],
  ]);
  let grant: string | null = "900 4242\n";
  const testPids = new Map([...pids, [":1.70", 920], [":1.71", 930], [":1.72", 900]]);
  const test = testControlGate({
    inspector: testInspector,
    peerPid: async (_bus, sender) => {
      const pid = testPids.get(sender);
      if (pid === undefined) throw new Error("left the bus");
      return pid;
    },
    facts: (file) => facts.get(file) ?? null,
    read: (file) => (file === TEST_CONTROL_GRANT ? grant : null),
    processUid: (pid) => uids.get(pid) ?? 1000,
    now: () => now,
  });
  const gated = restrictTo(
    bus,
    orTestControl(gate, test),
    trusted.settings,
    DISPLAY_CONFIG_REFUSAL,
    setMode,
  );
  const before = modeChanges;
  // The script, and the root shell itself, pass; Settings still does.
  assert.deepEqual(await call(gated, ":1.70"), { body: [true] });
  assert.deepEqual(await call(gated, ":1.72"), { body: [true] });
  assert.deepEqual(await call(gated, ":1.20"), { body: [true] });
  // Nothing else does, granted or not.
  await refused(":1.30", gated, DISPLAY_CONFIG_REFUSAL);
  await refused(":1.71", gated, DISPLAY_CONFIG_REFUSAL);
  await refused(":1.99", gated, DISPLAY_CONFIG_REFUSAL);
  await refused(undefined, gated, DISPLAY_CONFIG_REFUSAL);
  assert.equal(modeChanges, before + 3);
  // Never for capture: the test gate is only combined with the display configuration gate.
  await refused(":1.70");

  const denies = async (label: string, change: () => void, undo: () => void) => {
    change();
    assert.equal(await test(bus, ":1.70"), false, label);
    undo();
    assert.equal(await test(bus, ":1.70"), true, `${label}: restored`);
  };
  const swap = (file: string, next: Partial<FileFacts> | null) => {
    const saved = facts.get(file)!;
    return [
      () => (next ? facts.set(file, { ...saved, ...next }) : facts.delete(file)),
      () => facts.set(file, saved),
    ] as const;
  };
  // The image doesn't enable it (the shipped image): no grant counts.
  await denies("not a test image", ...swap(TEST_CONTROL_ENABLED, null));
  await denies("enabled file not root's", ...swap(TEST_CONTROL_ENABLED, { uid: 1000 }));
  await denies("enabled file writable", ...swap(TEST_CONTROL_ENABLED, { mode: 0o100666 }));
  // The grant must be root's, in a root-only directory, a plain file, and fresh.
  await denies("no grant", ...swap(TEST_CONTROL_GRANT, null));
  await denies("grant not root's", ...swap(TEST_CONTROL_GRANT, { uid: 1000 }));
  await denies("grant writable by others", ...swap(TEST_CONTROL_GRANT, { mode: 0o100666 }));
  await denies("grant is a link", ...swap(TEST_CONTROL_GRANT, { file: false }));
  await denies("directory not root's", ...swap("/run/moire-test", { uid: 1000 }));
  await denies("directory world-writable", ...swap("/run/moire-test", { mode: 0o41777 }));
  await denies("stale grant", ...swap(TEST_CONTROL_GRANT, { mtimeMs: now - 11 * 60_000 }));
  // The named process must still be that root process: same start time, still root's.
  await denies(
    "pid reused",
    () => (grant = "900 4243\n"),
    () => (grant = "900 4242\n"),
  );
  await denies(
    "holder not root",
    () => uids.set(900, 1000),
    () => uids.set(900, 0),
  );
  await denies(
    "garbage",
    () => (grant = "900"),
    () => (grant = "900 4242\n"),
  );
  // A grant naming a user's own process (the terminal) gives nothing to the terminal either.
  grant = "300 1\n";
  assert.equal(await test(bus, ":1.30"), false, "a grant must name a root process");
  // Without start times (an inspector that can't read them) nobody passes.
  grant = "900 4242\n";
  const blind = testControlGate({
    inspector: { parent: testInspector.parent, executable: testInspector.executable },
    peerPid: async () => 920,
    facts: (file) => facts.get(file) ?? null,
    read: () => grant,
    processUid: (pid) => uids.get(pid) ?? 1000,
    now: () => now,
  });
  assert.equal(await blind(bus, ":1.70"), false);
}
cases++;

console.log(`[display-access] ${cases} cases PASS`);
