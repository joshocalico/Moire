import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { SessionBus } from "@moire/dbus";
import { StartupDesktop } from "@moire/compositor/startup";
import { SessionContinuation, type ContinuationState } from "@moire/greeter/continuation";
import { requestDesktopStart } from "./desktop";

const server = await SessionBus.connect();
let attempts = 0;
let attached = 0;
let withholdReply = false;
const delayed: { release: (() => void) | null } = { release: null };
const desktop = new StartupDesktop(() => {
  attempts++;
  if (attempts === 1) throw new Error("Fixture shell attachment failed");
  attached++;
});
try {
  await assert.rejects(requestDesktopStart(), /ServiceUnknown|NameHasNoOwner|provided|name/i);
  assert.equal(attached, 0, "a missing service cannot claim a completed handoff");
  assert.equal(await server.requestName("org.moire.Display1"), 1);
  server.exportObject("/org/moire/Display1", {
    name: "org.moire.Display1",
    methods: {
      StartDesktop: {
        inSignature: "",
        outSignature: "b",
        handler: () =>
          withholdReply
            ? new Promise<{ body: boolean[] }>((resolve) => {
                delayed.release = () => resolve({ body: [desktop.start()] });
              })
            : { body: [desktop.start()] },
      },
    },
  });
  await assert.rejects(requestDesktopStart(), /Fixture shell attachment failed/);
  assert.equal(attached, 0);
  await requestDesktopStart();
  await Promise.all([requestDesktopStart(), requestDesktopStart()]);
  assert.equal(attempts, 2, "retry works, repeated requests never recreate the shell");
  assert.equal(attached, 1);
  withholdReply = true;
  const states: ContinuationState[] = [];
  const continuation = new SessionContinuation(
    () => requestDesktopStart({ timeoutMs: 50 }),
    (state) => states.push(state),
  );
  await continuation.start();
  assert.equal(states.at(-1)?.kind, "error", "a withheld real reply reports an error");
  delayed.release?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(states.at(-1)?.kind, "error", "late success cannot complete the timed-out welcome");
  withholdReply = false;
  await continuation.start();
  assert.equal(states.at(-1)?.kind, "complete", "only a new explicit reply completes retry");
  assert.equal(attached, 1, "an unresponsive owner times out without breaking a later retry");
  const realAddress = process.env.DBUS_SESSION_BUS_ADDRESS;
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-bus-deadline-"));
  try {
    for (const phase of ["authentication", "Hello"] as const) {
      let accepted = 0;
      let closed = 0;
      let received = Buffer.alloc(0);
      const sockets = new Set<net.Socket>();
      const socketPath = path.join(fixture, `${phase}.sock`);
      const unresponsive = net.createServer((socket) => {
        accepted++;
        sockets.add(socket);
        let authenticated = false;
        socket.on("data", (bytes) => {
          received = Buffer.concat([received, bytes]);
          if (phase === "Hello" && !authenticated && received.includes(Buffer.from("AUTH"))) {
            authenticated = true;
            socket.write("OK 0123456789abcdef0123456789abcdef\r\n");
          }
        });
        socket.on("close", () => {
          closed++;
          sockets.delete(socket);
        });
      });
      await new Promise<void>((resolve, reject) => {
        unresponsive.once("error", reject);
        unresponsive.listen(socketPath, resolve);
      });
      try {
        process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${socketPath}`;
        await assert.rejects(requestDesktopStart({ timeoutMs: 100 }), /did not respond/);
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(accepted, 1, `${phase} fixture actually accepted the Unix connection`);
        assert.ok(received.includes(Buffer.from(phase === "Hello" ? "Hello" : "AUTH")));
        assert.equal(closed, 1, `${phase} timeout releases the pending socket`);
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => unresponsive.close(() => resolve()));
      }
    }
  } finally {
    if (realAddress === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
    else process.env.DBUS_SESSION_BUS_ADDRESS = realAddress;
    await fs.rm(fixture, { recursive: true, force: true });
  }
  await requestDesktopStart();
  assert.equal(attached, 1);
  console.log(
    "[session/desktop] real D-Bus missing-service/failure/retry/idempotent handoff and auth/Hello/no-reply deadlines passed",
  );
} finally {
  server.close();
}
