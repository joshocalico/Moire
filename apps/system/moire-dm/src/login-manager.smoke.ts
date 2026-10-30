/**
 * org.moire.LoginManager1 on a throwaway dbus-daemon: the account is always the caller's own,
 * polkit decides (prompting only for a caller that allows interaction), a dismissed prompt is
 * `cancelled`, accounts below uid 1000 and the greeter never qualify, and only fixed messages
 * leave the service. Needs `dbus-daemon` (or MOIRE_TEST_DBUS_DAEMON); not part of the package
 * build.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALLOW_INTERACTIVE_AUTHORIZATION, DbusRemoteError, SessionBus } from "@moire/dbus";
import { loadAutologin, writeAutologinFile } from "./autologin-file";
import { parseConfig, type DmConfig } from "./config";
import {
  LOGIN_MANAGER_INTERFACE,
  LOGIN_MANAGER_PATH,
  attachLoginManager,
  passwdName,
  type LoginManagerStatus,
  type PolkitAnswer,
} from "./login-manager";

const config = parseConfig(
  JSON.stringify({
    vt: 1,
    socket: "/run/moire-dm-front/greeter.sock",
    frontUser: "moire-dm-front",
    path: "/run/current-system/sw/bin",
    greeter: { user: "greeter", argv: ["/nix/store/x-greeter/bin/greeter"] },
    sessions: [
      { id: "moire", label: "Moire", desktop: "moire", argv: ["/nix/store/x/bin/moire"] },
      { id: "other", label: "Other", desktop: "moire", argv: ["/nix/store/x/bin/other"] },
    ],
  }),
) as DmConfig;
const PASSWD = [
  "root:x:0:0:System administrator:/root:/bin/sh",
  "greeter:x:990:990::/var/empty:/bin/sh",
  "admin:x:1000:100:Admin:/home/admin:/bin/sh",
  "standard:x:1001:100:Standard:/home/standard:/bin/sh",
  "builder:x:999:999::/var/empty:/bin/sh",
  "",
].join("\n");
assert.equal(passwdName(PASSWD, 1000), "admin");
assert.equal(passwdName(PASSWD, 1002), null);
assert.equal(passwdName("x:y\n::1000\n", 1000), null);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-dm-login-manager-"));
const file = path.join(directory, "autologin.json");
const self = process.getuid?.() ?? 0;
const daemon = spawn(
  process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
  [
    "--session",
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${path.join(directory, "bus")}`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const address = await new Promise<string>((resolve, reject) => {
  let output = "";
  daemon.once("error", reject);
  daemon.stdout.on("data", (chunk) => {
    output += String(chunk);
    if (output.includes("\n")) resolve(output.trim());
  });
});
const buses: SessionBus[] = [];
const connect = async () => {
  const bus = await SessionBus.connect(address);
  buses.push(bus);
  return bus;
};
const logs: string[] = [];
try {
  const service = await connect();
  const admin = await connect();
  const standard = await connect();
  const system = await connect();
  const greeter = await connect();

  // The bus's own GetConnectionUnixUser is what production asks; here it is this process.
  const real = await service.call({
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "GetConnectionUnixUser",
    signature: "s",
    body: [admin.name],
  });
  assert.deepEqual(real.body, [self]);

  // Every connection here is this process, so the test maps connections to accounts itself.
  const uids = new Map([
    [admin.name, 1000],
    [standard.name, 1001],
    [system.name, 999],
    [greeter.name, 990],
  ]);
  // Polkit's answer per caller: the rule says "an administrator's password", so `yes` is a
  // prompt answered (or an authorization kept), `dismissed` a prompt closed, `no` a refusal.
  // Without interaction there is no prompt, and the answer is no.
  const answers = new Map<string | null, PolkitAnswer>([
    [admin.name, "yes"],
    [standard.name, "no"],
    [system.name, "yes"],
    [greeter.name, "yes"],
  ]);
  const polkitAsked: string[] = [];
  const interaction: boolean[] = [];
  let gate: Promise<void> | null = null;
  attachLoginManager(service, {
    config,
    callerUid: async (sender) => uids.get(sender) ?? Promise.reject(new Error("unknown")),
    authorize: async (sender, interactive) => {
      polkitAsked.push(sender);
      interaction.push(interactive);
      await gate;
      return interactive ? (answers.get(sender) ?? "no") : "no";
    },
    accountName: (uid) => passwdName(PASSWD, uid),
    read() {
      const state = loadAutologin(config, file, self);
      return state.kind === "enabled"
        ? { kind: "enabled", user: state.user, session: state.session.id }
        : state;
    },
    write: (record) => writeAutologinFile(config, file, record, self),
    log: (line) => logs.push(line),
  });
  // As the management service calls: prepared to wait for the password prompt.
  const call = (
    bus: SessionBus,
    member: string,
    signature = "",
    body: unknown[] = [],
    flags = ALLOW_INTERACTIVE_AUTHORIZATION,
  ) =>
    bus.call({
      destination: service.name!,
      path: LOGIN_MANAGER_PATH,
      interface: LOGIN_MANAGER_INTERFACE,
      member,
      signature,
      body,
      flags,
    });
  const status = async (bus = standard): Promise<LoginManagerStatus> =>
    JSON.parse(String((await call(bus, "GetStatus")).body?.[0]));
  const refused = async (
    bus: SessionBus,
    code: string,
    body: unknown[] = [true],
    signature = "b",
  ) => {
    await assert.rejects(call(bus, "SetAutomaticLogin", signature, body), (error) => {
      assert(error instanceof DbusRemoteError);
      assert.equal(error.errorName, `${LOGIN_MANAGER_INTERFACE}.Error.${code}`);
      assert(!/administrators/i.test(error.message), "anyone at the seat may ask");
      return true;
    });
  };

  // Off to begin with; anyone may read the state (the file itself is world-readable).
  assert.deepEqual(await status(), {
    version: 1,
    enabled: false,
    user: null,
    session: null,
    problem: null,
  });

  // A caller that doesn't say it will wait gets no prompt, so polkit's answer is no.
  await assert.rejects(call(admin, "SetAutomaticLogin", "b", [true], 0), (error) => {
    assert(error instanceof DbusRemoteError);
    assert.equal(error.errorName, `${LOGIN_MANAGER_INTERFACE}.Error.permission`);
    return true;
  });
  assert.deepEqual(interaction, [false]);
  assert.equal((await status()).enabled, false);
  polkitAsked.length = 0;

  // An administrator turns it on: for their own account, with the catalog's first session.
  await call(admin, "SetAutomaticLogin", "b", [true]);
  assert.deepEqual(interaction, [false, true], "interaction follows the caller's flag");
  assert.deepEqual(await status(), {
    version: 1,
    enabled: true,
    user: "admin",
    session: "moire",
    problem: null,
  });
  assert.deepEqual(polkitAsked, [admin.name]);

  // Refused, file untouched: polkit says no; an account below 1000 or the greeter, even with a
  // polkit yes (asked only after the account qualifies); bad arguments; an unknown caller.
  await refused(standard, "permission");
  await refused(system, "permission");
  await refused(greeter, "permission");
  assert.deepEqual(polkitAsked, [admin.name, standard.name], "polkit only for real accounts");
  await refused(admin, "invalid", ["yes"], "s");
  await refused(admin, "invalid", [], "");
  const stranger = await connect();
  await refused(stranger, "unavailable");
  assert.equal((await status()).user, "admin");

  // The prompt was dismissed: `cancelled`, and nothing is written, on or off.
  answers.set(standard.name, "dismissed");
  await refused(standard, "cancelled");
  await refused(standard, "cancelled", [false]);
  assert.equal((await status()).user, "admin");
  // A standard user gets through when an administrator answers their prompt: on for their own
  // account (never the administrator's), and off again.
  answers.set(standard.name, "yes");
  await call(standard, "SetAutomaticLogin", "b", [true]);
  assert.equal((await status()).user, "standard");
  await call(standard, "SetAutomaticLogin", "b", [false]);
  answers.set(standard.name, "no");
  await call(admin, "SetAutomaticLogin", "b", [true]);

  // A refused standard user can't turn it off either; the administrator can.
  await refused(standard, "permission", [false]);
  await call(admin, "SetAutomaticLogin", "b", [false]);
  assert.deepEqual(await status(), {
    version: 1,
    enabled: false,
    user: null,
    session: null,
    problem: null,
  });

  // An odd file reads as off, with the reason, and a write replaces it.
  fs.writeFileSync(file, "{}");
  assert.equal((await status()).problem, "shape");
  await call(admin, "SetAutomaticLogin", "b", [true]);
  assert.equal((await status()).user, "admin");

  // One change at a time: a second call while polkit is still deciding is refused.
  let release!: () => void;
  gate = new Promise<void>((resolve) => (release = resolve));
  const first = call(admin, "SetAutomaticLogin", "b", [false]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await refused(admin, "busy");
  release();
  await first;
  gate = null;

  assert.deepEqual(logs, [
    "moire-dm-settings: code=autologin-on user=admin",
    "moire-dm-settings: code=autologin-on user=standard",
    "moire-dm-settings: code=autologin-off user=standard",
    "moire-dm-settings: code=autologin-on user=admin",
    "moire-dm-settings: code=autologin-off user=admin",
    "moire-dm-settings: code=autologin-on user=admin",
    "moire-dm-settings: code=autologin-off user=admin",
  ]);
} finally {
  for (const bus of buses) bus.close();
  daemon.kill("SIGTERM");
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log("moire-dm login manager smoke ok");
