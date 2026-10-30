/**
 * Who a sleep-blocking request comes from: launch records and the walk up the process tree, the
 * X11 label, and the caller identifier against a stand-in bus daemon. The decision the identity
 * feeds (allowlist, lid, battery) is covered by power-session.smoke.ts.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { SessionBus } from "@moire/dbus";
import {
  LaunchRecords,
  PORTAL_BACKEND_NAME,
  callerIdentifier,
  procInspector,
  runsUnderX11,
  type ProcessInspector,
} from "./sleep-blockers";

let cases = 0;
const child = (pid: number | undefined) => Object.assign(new EventEmitter(), { pid });
/** terminal(100) → shell(110) → agent(120); xterm(200); a daemon(300) under init. */
const parents = new Map([
  [120, 110],
  [110, 100],
  [100, 1],
  [200, 1],
  [300, 1],
]);
const inspector: ProcessInspector = {
  parent: (pid) => parents.get(pid) ?? null,
  executable: (pid) => (pid === 300 ? "/usr/bin/backupd" : pid === 120 ? "/usr/bin/node" : null),
};

// Launch records: the command's first word, kept until the child exits.
const launches = new LaunchRecords();
const terminal = child(100);
launches.track(terminal, "moire-terminal --working-directory '/home/me/my project'");
const xterm = launches.track(child(200), "/usr/bin/xterm");
assert.deepEqual(launches.rootOf(120, inspector), { pid: 100, command: "moire-terminal" });
assert.deepEqual(launches.rootOf(100, inspector), { pid: 100, command: "moire-terminal" });
assert.equal(launches.rootOf(300, inspector), null, "not started by the compositor");
assert.equal(launches.rootOf(1, inspector), null);
launches.track(child(undefined), "never-started");
launches.track(child(400), "'unterminated");
assert.equal(launches.rootOf(400, inspector), null, "a command that does not parse is no record");
{
  // A parent loop (or a very deep tree) ends the walk instead of spinning.
  const loop: ProcessInspector = {
    parent: (pid) => (pid === 500 ? 501 : 500),
    executable: () => null,
  };
  assert.equal(launches.rootOf(500, loop), null);
}
cases++;

// X11: only with Xwayland up, and only when the app's tree has no Wayland connection itself.
const wayland = [{ pid: 110, xwayland: false }];
const withX = [...wayland, { pid: 900, xwayland: true }];
assert.equal(runsUnderX11(200, wayland, launches, inspector), false, "no Xwayland, no X11 apps");
assert.equal(runsUnderX11(200, withX, launches, inspector), true);
assert.equal(runsUnderX11(100, withX, launches, inspector), false, "a descendant is a client");
cases++;

// The caller identifier. The bus daemon answers who owns the portal name and each sender's pid.
const pids = new Map([
  [":1.10", 120],
  [":1.11", 200],
  [":1.12", 300],
  [":1.13", 777],
  [":1.20", 650],
]);
let portalOwner: string | null = ":1.20";
const bus = {
  async call(message: { member: string; body: unknown[] }) {
    const name = String(message.body[0]);
    if (message.member === "GetNameOwner") {
      assert.equal(name, PORTAL_BACKEND_NAME);
      if (portalOwner === null) throw new Error("NameHasNoOwner");
      return { body: [portalOwner] };
    }
    assert.equal(message.member, "GetConnectionUnixProcessID");
    if (!pids.has(name)) throw new Error("NameHasNoOwner");
    return { body: [pids.get(name)] };
  },
} as unknown as SessionBus;
const identify = callerIdentifier({
  launches,
  inspector,
  clients: () => withX,
  displayName: (command) => (command === "moire-terminal" ? "Terminal" : null),
});
// A tool run inside a terminal is the terminal's launch, whatever it calls itself.
assert.deepEqual(await identify(bus, ":1.10", "org.mozilla.firefox"), {
  id: "launch:moire-terminal",
  name: "Terminal",
  x11: false,
});
assert.deepEqual(await identify(bus, ":1.11", ""), {
  id: "launch:/usr/bin/xterm",
  name: "xterm",
  x11: true,
});
// Not launched by the compositor: its executable.
assert.deepEqual(await identify(bus, ":1.12", "Terminal"), {
  id: "exe:/usr/bin/backupd",
  name: "backupd",
  x11: false,
});
assert.equal(await identify(bus, ":1.13", "anything"), null, "no launch and no executable");
await assert.rejects(identify(bus, ":1.99", "gone"), "a caller that left the bus");
// The portal backend's app id is the frontend's; a missing or malformed one names nobody.
assert.deepEqual(await identify(bus, ":1.20", "org.example.Flat"), {
  id: "portal:org.example.Flat",
  name: "org.example.Flat",
  x11: false,
});
assert.equal(await identify(bus, ":1.20", ""), null);
assert.equal(await identify(bus, ":1.20", "launch:moire-terminal"), null);
// Nobody else gets a portal identity by passing an app id, with or without a backend running.
assert.equal((await identify(bus, ":1.12", "org.example.Flat"))?.id, "exe:/usr/bin/backupd");
portalOwner = null;
assert.equal((await identify(bus, ":1.12", "org.example.Flat"))?.id, "exe:/usr/bin/backupd");
cases++;

// A record ends with its process: a later process with the same pid is not that app.
terminal.emit("exit");
assert.equal(launches.rootOf(120, inspector), null);
assert.equal((await identify(bus, ":1.10", ""))?.id, "exe:/usr/bin/node");
xterm.emit("error");
assert.equal(launches.rootOf(200, inspector), null);
cases++;

// /proc: this process's parent and executable on Linux; nothing to read elsewhere.
if (process.platform === "linux") {
  assert.equal(procInspector.parent(process.pid), process.ppid);
  assert.equal(procInspector.executable(process.pid), process.execPath);
} else {
  assert.equal(procInspector.parent(process.pid), null);
  assert.equal(procInspector.executable(process.pid), null);
}
assert.equal(procInspector.parent(0x7fff_fff0), null);
cases++;

console.log(`[sleep-blockers] ${cases} cases PASS`);
