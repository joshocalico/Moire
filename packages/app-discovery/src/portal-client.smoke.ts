/** Interactive chooser deadlines/cancellation against an owned private daemon. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionBus } from "@moire/dbus";
import { FileActivationPortalClient } from "./portal-client";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-portal-client-"));
const daemon = spawn(
  "dbus-daemon",
  [
    "--session",
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${path.join(directory, "bus")}`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(daemon, "exit");
const previous = process.env.DBUS_SESSION_BUS_ADDRESS;
let address = "",
  failure: Error | null = null,
  diagnostic = "";
daemon.stdout.on("data", (bytes) => {
  address += bytes.toString();
});
daemon.stderr.on("data", (bytes) => {
  diagnostic += bytes.toString();
});
daemon.on("error", (error) => {
  failure = error;
});
const buses: SessionBus[] = [];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(5);
  }
}
try {
  await until(
    () => address.includes("\n") || failure !== null || daemon.exitCode !== null,
    "daemon startup",
  );
  if (failure) throw failure;
  assert(address.startsWith("unix:"), diagnostic);
  process.env.DBUS_SESSION_BUS_ADDRESS = address.trim();
  const server = await SessionBus.connect();
  buses.push(server);
  assert.equal(await server.requestName("org.freedesktop.impl.portal.desktop.moire", 4), 1);
  const pending: { finish: (() => void) | null } = { finish: null };
  let closes = 0,
    requests = 0;
  const seenPaths: string[] = [];
  server.exportObject("/org/freedesktop/portal/desktop", {
    name: "org.moire.FileActivation1",
    methods: {
      OpenWith: {
        inSignature: "so",
        outSignature: "u",
        handler: async ({ body }) => {
          const [file, handle] = body;
          assert.equal(typeof file, "string");
          assert.equal(typeof handle, "string");
          if (typeof handle !== "string" || typeof file !== "string")
            throw new Error("Invalid fixture request");
          seenPaths.push(file);
          requests++;
          const remove = server.exportObject(handle, {
            name: "org.freedesktop.impl.portal.Request",
            methods: {
              Close: {
                inSignature: "",
                outSignature: "",
                handler: () => {
                  closes++;
                  pending.finish?.();
                  return {};
                },
              },
            },
          });
          try {
            await new Promise<void>((resolve) => {
              pending.finish = resolve;
            });
            return { body: [1] };
          } finally {
            pending.finish = null;
            remove();
          }
        },
      },
    },
  });
  const client = new FileActivationPortalClient();
  // A person can take longer than the former generic10s method deadline.
  const delayed = client.openWith("/tmp/quoted ' document.txt");
  await until(() => requests === 1, "interactive request opened");
  await sleep(10050);
  assert(pending.finish);
  pending.finish();
  assert.equal(await delayed, 1);
  assert.equal(closes, 0);
  assert.equal(seenPaths[0], "/tmp/quoted ' document.txt");
  await assert.rejects(client.openWith("/tmp/deadline.txt", { timeoutMs: 20 }), /timed out/);
  assert.equal(closes, 1, "deadline explicitly closes original request");
  const abort = new AbortController();
  const cancelled = client.openWith("/tmp/cancel.txt", { signal: abort.signal });
  const outcome = assert.rejects(cancelled, /cancelled|abort/i);
  await until(() => requests === 3, "cancel request opened");
  abort.abort();
  await outcome;
  assert.equal(closes, 2, "caller cancellation closes original request without retargeting");
  assert.equal(seenPaths.length, 3);
  console.log(
    "[portal/client] actual private daemon: interactive >10s, quoted path, bounded timeout and caller cancellation close original unique-owner request; native chooser rendering not claimed",
  );
} finally {
  for (const bus of buses) bus.close();
  if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGTERM");
  await exited;
  if (previous === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
  else process.env.DBUS_SESSION_BUS_ADDRESS = previous;
  await fs.rm(directory, { recursive: true, force: true });
}
