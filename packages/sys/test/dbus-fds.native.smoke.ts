/**
 * D-Bus descriptor passing through a real dbus-daemon: a reply carries a descriptor (logind's
 * Inhibit shape), a call carries one (the portal's OpenFile shape), unkept descriptors are closed,
 * received ones are close-on-exec, and a connection without the transport still works.
 * Linux only; prints SKIP elsewhere.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionBus } from "@moire/dbus";
import { dbusUnixFdTransport } from "@moire/sys/dbus-fds";

if (process.platform !== "linux") {
  console.log("[sys/dbus-fds] SKIP: descriptor passing needs Linux");
  process.exit(0);
}

const O_CLOEXEC = 0o2000000;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-dbus-fds-"));
const socketPath = path.join(directory, "bus");
const daemon = spawn(
  process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
  [
    "--session",
    "--nofork",
    "--nopidfile",
    "--print-address=1",
    `--address=unix:path=${socketPath}`,
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const address = await new Promise<string>((resolve, reject) => {
  let output = "";
  daemon.stdout.on("data", (chunk) => {
    output += String(chunk);
    if (output.includes("\n")) resolve(output.split("\n")[0]!);
  });
  daemon.once("exit", () => reject(new Error("dbus-daemon exited")));
  daemon.once("error", reject);
});

const openFds = () => fs.readdirSync("/proc/self/fd").length;
const cloexec = (fd: number) => {
  const flags = /flags:\s*([0-7]+)/.exec(fs.readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"));
  return (parseInt(flags?.[1] ?? "0", 8) & O_CLOEXEC) !== 0;
};
const fileWith = (name: string, text: string) => {
  const file = path.join(directory, name);
  fs.writeFileSync(file, text);
  return file;
};
const served = fileWith("served", "from the service");
const handed = fileWith("handed", "from the caller");

const service = await SessionBus.connect(address, { unixFds: dbusUnixFdTransport });
const client = await SessionBus.connect(address, { unixFds: dbusUnixFdTransport });
const plain = await SessionBus.connect(address);
let cases = 0;
try {
  assert.equal(service.unixFds, true);
  assert.equal(client.unixFds, true);
  assert.equal(plain.unixFds, false);
  assert.equal(await service.requestName("org.moire.FdSmoke"), 1);
  service.exportObject("/org/moire/FdSmoke", {
    name: "org.moire.FdSmoke",
    methods: {
      Open: {
        inSignature: "",
        outSignature: "h",
        handler: () => ({ body: [0], fds: [fs.openSync(served, "r")] }),
      },
      Read: {
        inSignature: "h",
        outSignature: "s",
        handler: (context) => {
          const fd = context.keepFd(Number(context.body[0]));
          try {
            return { body: [`${cloexec(fd)}:${fs.readFileSync(fd, "utf8")}`] };
          } finally {
            fs.closeSync(fd);
          }
        },
      },
      Ignore: { inSignature: "h", outSignature: "", handler: () => ({}) },
    },
  });
  const call = (member: string, signature = "", body: unknown[] = [], fds?: number[]) =>
    client.call({
      destination: "org.moire.FdSmoke",
      path: "/org/moire/FdSmoke",
      interface: "org.moire.FdSmoke",
      member,
      signature,
      body,
      fds,
    });

  // A reply's descriptor reaches the caller, close-on-exec, and is the caller's to close.
  const opened = await call("Open");
  assert.equal(opened.signature, "h");
  const fd = opened.fds?.[Number(opened.body?.[0])];
  assert.ok(fd !== undefined && fd >= 0);
  assert.equal(cloexec(fd), true, "received descriptors must not leak into spawned apps");
  assert.equal(fs.readFileSync(fd, "utf8"), "from the service");
  fs.closeSync(fd);
  cases++;

  // A call's descriptor reaches the handler; the caller's copy stays usable.
  const mine = fs.openSync(handed, "r");
  const read = await call("Read", "h", [0], [mine]);
  assert.equal(read.body?.[0], "true:from the caller");
  assert.equal(fs.fstatSync(mine).size, "from the caller".length);
  cases++;

  // Unkept and reply descriptors are closed: no growth over many round trips.
  const before = openFds();
  for (let index = 0; index < 50; index++) {
    await call("Ignore", "h", [0], [mine]);
    const again = await call("Open");
    fs.closeSync(again.fds![0]!);
  }
  assert.equal(openFds(), before, "descriptors leaked across round trips");
  fs.closeSync(mine);
  cases++;

  // Ordinary traffic interleaves with descriptor-carrying messages in order.
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      index % 2
        ? call("Open").then((reply) => {
            fs.closeSync(reply.fds![0]!);
            return "fd";
          })
        : client
            .call({
              destination: "org.freedesktop.DBus",
              path: "/org/freedesktop/DBus",
              interface: "org.freedesktop.DBus",
              member: "GetId",
            })
            .then(() => "plain"),
    ),
  );
  assert.equal(results.filter((kind) => kind === "fd").length, 10);
  cases++;

  // Without the transport the connection works but cannot pass descriptors.
  await assert.rejects(
    plain.call({
      destination: "org.moire.FdSmoke",
      path: "/org/moire/FdSmoke",
      interface: "org.moire.FdSmoke",
      member: "Ignore",
      signature: "h",
      body: [0],
      fds: [0],
    }),
    /cannot pass descriptors/,
  );
  await assert.rejects(
    plain.call({
      destination: "org.moire.FdSmoke",
      path: "/org/moire/FdSmoke",
      interface: "org.moire.FdSmoke",
      member: "Open",
    }),
    "the daemon refuses descriptors to a connection that did not negotiate them",
  );
  cases++;
  console.log(`[sys/dbus-fds] ok (${cases} cases)`);
} finally {
  service.close();
  client.close();
  plain.close();
  daemon.kill("SIGTERM");
  fs.rmSync(directory, { recursive: true, force: true });
}
