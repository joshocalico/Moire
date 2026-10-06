import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createFixtureGreetdClient } from "./greetd-client";

const little = os.endianness() === "LE";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function frame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  if (little) header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-greetd-private-"));
let sequence = 0,
  cases = 0;
const servers: net.Server[] = [],
  sockets: net.Socket[] = [];
async function fixture(handler: (request: Record<string, unknown>, socket: net.Socket) => void) {
  const file = path.join(directory, String(++sequence));
  const requests: Record<string, unknown>[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => {});
    let input = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 4) {
        const size = little ? input.readUInt32LE(0) : input.readUInt32BE(0);
        if (input.length < size + 4) return;
        const request: unknown = JSON.parse(input.subarray(4, size + 4).toString());
        input = input.subarray(size + 4);
        assert(request && typeof request === "object" && !Array.isArray(request));
        const record = Object.fromEntries(Object.entries(request));
        requests.push(record);
        handler(record, socket);
      }
    });
  });
  servers.push(server);
  server.listen(file);
  await once(server, "listening");
  const broker = await createFixtureGreetdClient({
    qualification: "fixture",
    timeoutMs: 80,
    connect: async () => {
      const socket = net.createConnection(file);
      sockets.push(socket);
      await once(socket, "connect");
      return socket;
    },
  });
  return { broker, requests };
}
async function test(name: string, run: () => Promise<void>) {
  await run();
  cases++;
  console.log("ok " + name);
}
try {
  await test("fragmented native-endian frames and phase-specific full conversation", async () => {
    const f = await fixture((r, socket) => {
      const reply =
        r.type === "create_session"
          ? { type: "auth_message", auth_message_type: "secret", auth_message: "Password" }
          : { type: "success" };
      const bytes = frame(reply);
      socket.write(bytes.subarray(0, 2));
      setTimeout(() => {
        socket.write(bytes.subarray(2, 7));
        setTimeout(() => socket.write(bytes.subarray(7)), 2);
      }, 2);
    });
    assert.equal((await f.broker.begin("fixtureuser")).kind, "prompt");
    await assert.rejects(f.broker.start({ command: ["/trusted/launcher"], environment: [] }));
    await assert.rejects(f.broker.answer(null));
    assert.equal((await f.broker.answer("synthetic-secret")).kind, "success");
    assert.equal(
      (
        await f.broker.start({
          command: ["/trusted/launcher", "session_1"],
          environment: ["FIXTURE=yes"],
        })
      ).kind,
      "success",
    );
    await assert.rejects(f.broker.answer("late"));
    assert.equal((await f.broker.cancel()).kind, "success");
    assert.deepEqual(
      f.requests.map((r) => r.type),
      ["create_session", "post_auth_message_response", "start_session", "cancel_session"],
    );
    f.broker.close();
  });
  await test("info/error prompts require null acknowledgement and echoed text is stripped", async () => {
    const f = await fixture((r, socket) =>
      socket.write(
        frame(
          r.type === "create_session"
            ? { type: "auth_message", auth_message_type: "info", auth_message: "SYNTHETIC-SECRET" }
            : r.type === "post_auth_message_response"
              ? { type: "error", error_type: "auth_error", description: "SYNTHETIC-SECRET" }
              : { type: "success" },
        ),
      ),
    );
    const reply = await f.broker.begin("fixtureuser");
    assert(!JSON.stringify(reply).includes("SYNTHETIC-SECRET"));
    await assert.rejects(f.broker.answer("SYNTHETIC-SECRET"));
    const denied = await f.broker.answer(null);
    assert.equal(denied.kind, "denied");
    assert(!JSON.stringify(denied).includes("SYNTHETIC-SECRET"));
    await f.broker.cancel();
    f.broker.close();
  });
  for (const bad of ["json", "utf8", "length", "extra", "unknown", "eof"])
    await test("bounded malformed " + bad + " fails closed", async () => {
      const f = await fixture((_, socket) => {
        if (bad === "json") {
          const bytes = Buffer.from([3, 0, 0, 0, 0x7b, 0x21, 0x7d]);
          if (!little) bytes.writeUInt32BE(3);
          socket.write(bytes);
        } else if (bad === "utf8") {
          const h = Buffer.alloc(4);
          if (little) h.writeUInt32LE(2);
          else h.writeUInt32BE(2);
          socket.write(Buffer.concat([h, Buffer.from([0xff, 0xff])]));
        } else if (bad === "length") {
          const h = Buffer.alloc(4);
          if (little) h.writeUInt32LE(65537);
          else h.writeUInt32BE(65537);
          socket.write(h);
        } else if (bad === "extra")
          socket.write(Buffer.concat([frame({ type: "success" }), frame({ type: "success" })]));
        else if (bad === "unknown")
          socket.write(frame({ type: "unknown", payload: "SYNTHETIC-SECRET" }));
        else socket.end(frame({ type: "success" }).subarray(0, 5));
      });
      await assert.rejects(
        f.broker.begin("fixtureuser"),
        (error) => error instanceof Error && !error.message.includes("SYNTHETIC-SECRET"),
      );
      await assert.rejects(f.broker.begin("fixtureuser"));
      f.broker.close();
    });
  await test("wrong-phase prompt reply closes launch transport", async () => {
    const f = await fixture((r, socket) =>
      socket.write(
        frame(
          r.type === "create_session"
            ? { type: "success" }
            : {
                type: "auth_message",
                auth_message_type: "secret",
                auth_message: "SYNTHETIC-SECRET",
              },
        ),
      ),
    );
    await f.broker.begin("fixtureuser");
    await assert.rejects(f.broker.start({ command: ["/trusted/launcher"], environment: [] }));
    await assert.rejects(f.broker.cancel());
    f.broker.close();
  });
  await test("concurrent requests rejected and cancellation joins held acknowledgement", async () => {
    const release: { value: (() => void) | null } = { value: null };
    const f = await fixture((r, socket) => {
      if (r.type === "create_session")
        release.value = () => socket.write(frame({ type: "success" }));
      else socket.write(frame({ type: "success" }));
    });
    const begun = f.broker.begin("fixtureuser");
    while (!release.value) await delay(2);
    await assert.rejects(f.broker.begin("fixtureuser"));
    const one = f.broker.cancel(),
      two = f.broker.cancel();
    assert.equal(f.requests.length, 1);
    release.value();
    await begun;
    await Promise.all([one, two]);
    assert.equal(f.requests.filter((r) => r.type === "cancel_session").length, 1);
    f.broker.close();
  });
  await test("reply timeout and explicit close do not authorize cancellation", async () => {
    const f = await fixture(() => {});
    await assert.rejects(f.broker.begin("fixtureuser"));
    await assert.rejects(f.broker.cancel());
    f.broker.close();
    const c = await fixture(() => {});
    const begun = c.broker.begin("fixtureuser");
    c.broker.close();
    await assert.rejects(begun);
    await assert.rejects(c.broker.begin("fixtureuser"));
  });
  await test("reply resolution followed by same-tick close cannot revive phase", async () => {
    const client: { value: net.Socket | null } = { value: null };
    const file = path.join(directory, String(++sequence));
    const server = net.createServer((socket) => {
      sockets.push(socket);
      socket.on("data", () => socket.write(frame({ type: "success" })));
    });
    servers.push(server);
    server.listen(file);
    await once(server, "listening");
    const broker = await createFixtureGreetdClient({
      qualification: "fixture",
      connect: async () => {
        client.value = net.createConnection(file);
        sockets.push(client.value);
        await once(client.value, "connect");
        return client.value;
      },
    });
    assert(client.value);
    client.value.on("data", () => broker.close());
    await assert.rejects(broker.begin("fixtureuser"));
    await assert.rejects(broker.start({ command: ["/trusted/launcher"], environment: [] }));
  });
  await test("connection deadline destroys a late private socket and hides connector errors", async () => {
    const file = path.join(directory, String(++sequence));
    const server = net.createServer((socket) => {
      sockets.push(socket);
      socket.on("error", () => {});
    });
    servers.push(server);
    server.listen(file);
    await once(server, "listening");
    const late: { socket: net.Socket | null; resolve: ((socket: net.Socket) => void) | null } = {
      socket: null,
      resolve: null,
    };
    const connecting = createFixtureGreetdClient({
      qualification: "fixture",
      timeoutMs: 20,
      connect: async () => {
        late.socket = net.createConnection(file);
        sockets.push(late.socket);
        await once(late.socket, "connect");
        return new Promise<net.Socket>((resolve) => {
          late.resolve = resolve;
        });
      },
    });
    await assert.rejects(
      connecting,
      (error) => error instanceof Error && !error.message.includes(file),
    );
    assert(late.socket && late.resolve);
    const closed = once(late.socket, "close");
    late.resolve(late.socket);
    await closed;
    assert.equal(late.socket.destroyed, true);
    await assert.rejects(
      createFixtureGreetdClient({
        qualification: "fixture",
        connect: async () => {
          throw new Error("SYNTHETIC-RESPONSE");
        },
      }),
      (error) => error instanceof Error && !error.message.includes("SYNTHETIC-RESPONSE"),
    );
  });
  console.log(
    JSON.stringify({
      suite: "private greetd framing fixture",
      cases,
      actualExitCode: 0,
      productionConnections: 0,
    }),
  );
} finally {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await fs.rm(directory, { recursive: true, force: true });
}
