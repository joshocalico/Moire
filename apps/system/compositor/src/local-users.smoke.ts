/** Actual private D-Bus transport; a fixture service, never host account discovery. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SessionBus, variant, type DbusVariant } from "@moire/dbus";
import { createLocalUserProvider } from "./local-users";

const SERVICE = "org.freedesktop.Accounts",
  ROOT = "/org/freedesktop/Accounts";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-account-bus-"));
const config = path.join(directory, "bus.conf");
await fs.writeFile(
  config,
  `<busconfig>
  <type>session</type><auth>EXTERNAL</auth>
  <listen>unix:path=${directory}/bus</listen>
  <policy context="default">
    <allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/>
  </policy>
</busconfig>\n`,
);
const daemon = spawn(
  "dbus-daemon",
  [
    `--config-file=${config}`,
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${directory}/bus`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let address = "",
  stderr = "",
  failure: Error | undefined;
daemon.stdout.on("data", (data) => {
  address += data.toString();
});
daemon.stderr.on("data", (data) => {
  stderr = (stderr + data.toString()).slice(-8192);
});
const exit = new Promise<void>((resolve) => {
  daemon.once("exit", () => resolve());
  daemon.once("error", (error) => {
    failure = error;
    resolve();
  });
});
const buses: SessionBus[] = [];
const records = new Map<string, Record<string, DbusVariant>>();
const calls: string[] = [];
let beforeGet: () => Promise<void> = async () => {};
let cases = 0;
try {
  const deadline = performance.now() + 3000;
  while (
    !address.includes("\n") &&
    !failure &&
    daemon.exitCode === null &&
    performance.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  if (!address.includes("\n")) throw failure ?? new Error(`Private D-Bus did not start: ${stderr}`);
  const service = await SessionBus.connect(address.trim()),
    client = await SessionBus.connect(address.trim());
  buses.push(service, client);
  assert.equal(await service.requestName(SERVICE), 1);
  service.exportObject(ROOT, {
    name: SERVICE,
    methods: {
      ListCachedUsers: {
        inSignature: "",
        outSignature: "ao",
        handler: () => {
          calls.push("ListCachedUsers");
          return { body: [[...records.keys()]] };
        },
      },
    },
  });
  function account(uid: bigint, username: string, overrides: Record<string, DbusVariant> = {}) {
    const objectPath = `${ROOT}/User${uid}`;
    records.set(objectPath, {
      Uid: variant("t", uid),
      UserName: variant("s", username),
      RealName: variant("s", username),
      Locked: variant("b", false),
      SystemAccount: variant("b", false),
      LocalAccount: variant("b", true),
      Shell: variant("s", "/run/current-system/sw/bin/bash"),
      ...overrides,
    });
    service.exportObject(objectPath, {
      name: "org.freedesktop.DBus.Properties",
      methods: {
        Get: {
          inSignature: "ss",
          outSignature: "v",
          handler: async ({ body }) => {
            assert.equal(body[0], `${SERVICE}.User`);
            const key = body[1];
            assert.equal(typeof key, "string");
            if (typeof key !== "string") throw new Error("Invalid fixture property");
            calls.push(key);
            await beforeGet();
            const value = records.get(objectPath)?.[key];
            if (!value) throw new Error("Absent fixture property");
            return { body: [value] };
          },
        },
      },
    });
    return objectPath;
  }
  const alice = account(1000n, "alice", { RealName: variant("s", "Alice") });
  account(1001n, "locked", { Locked: variant("b", true) });
  account(1002n, "system", { SystemAccount: variant("b", true) });
  account(1003n, "remote", { LocalAccount: variant("b", false) });
  account(0n, "root");
  account(1004n, "noshell", { Shell: variant("s", "/sbin/nologin") });
  account(1005n, "bob", { RealName: variant("s", "") });
  const provider = createLocalUserProvider(client);
  const list = () => provider.list(new AbortController().signal);
  assert.deepEqual(await list(), [
    { uid: 1000n, username: "alice", displayName: "Alice" },
    { uid: 1005n, username: "bob", displayName: "bob" },
  ]);
  cases++;
  const properties = records.get(alice);
  assert.ok(properties);
  properties.Locked = variant("b", true);
  assert.deepEqual(
    (await list()).map((user) => user.username),
    ["bob"],
  );
  cases++;
  properties.Locked = variant("b", false);
  properties.RealName = variant("s", "Hidden\u202eName");
  await assert.rejects(list());
  cases++;
  properties.RealName = variant("s", "Alice");
  properties.Locked = variant("s", "false");
  await assert.rejects(list());
  cases++;
  properties.Locked = variant("b", false);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(provider.list(cancelled.signal));
  cases++;
  let revoked = false;
  beforeGet = async () => {
    if (revoked) return;
    revoked = true;
    await service.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "ReleaseName",
      signature: "s",
      body: [SERVICE],
    });
  };
  await assert.rejects(list());
  cases++;
  assert.ok(
    calls.every((method) =>
      [
        "ListCachedUsers",
        "SystemAccount",
        "Locked",
        "LocalAccount",
        "Uid",
        "UserName",
        "RealName",
        "Shell",
      ].includes(method),
    ),
  );
  console.log(
    JSON.stringify({
      test: "local-user-provider",
      cases,
      transport: "actual private dbus-daemon",
      authority: "fixture metadata only",
      readOnly: true,
    }),
  );
} finally {
  for (const bus of buses) bus.close();
  if (daemon.exitCode === null && !failure) daemon.kill("SIGTERM");
  await exit;
  await fs.rm(directory, { recursive: true, force: true });
}
