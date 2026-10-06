import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { connectNativeGreetd, fixedSessionCommand } from "./native-greetd-client";

const executable = "/nix/store/0123456789abcdfghijklmnpqrsvwxyz-moire-session/bin/moire-session";
const session = fixedSessionCommand(executable);
const secret = "SYNTHETIC-NATIVE-RESPONSE";
const little = os.endianness() === "LE";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const success = { type: "success" };
function header(length: number) {
  const value = Buffer.alloc(4);
  if (little) value.writeUInt32LE(length);
  else value.writeUInt32BE(length);
  return value;
}
function frame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([header(body.length), body]);
}
function prompt(style: string) {
  return { type: "auth_message", auth_message_type: style, auth_message: secret };
}
function denied() {
  return { type: "error", error_type: "auth_error", description: secret };
}
function safeError(error: unknown) {
  return (
    error instanceof Error && !error.message.includes(secret) && !error.stack?.includes(secret)
  );
}
function secretFree(value: unknown) {
  assert(!JSON.stringify(value).includes(secret));
}

// This daemon has synthetic conversations only. It never invokes PAM or launches a session.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-native-ipc-"));
await fs.chmod(directory, 0o700);
const servers: net.Server[] = [];
const sockets: net.Socket[] = [];
let sequence = 0;
let cases = 0;
async function fixture(
  handler: (request: Record<string, unknown>, socket: net.Socket) => void,
  timeoutMs = 100,
  maxFrameBytes = 65536,
) {
  const file = path.join(directory, String(++sequence));
  const requests: Record<string, unknown>[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => {});
    let input = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 4) {
        const length = little ? input.readUInt32LE(0) : input.readUInt32BE(0);
        if (input.length < length + 4) return;
        const raw: unknown = JSON.parse(input.subarray(4, length + 4).toString());
        input = input.subarray(length + 4);
        assert(raw && typeof raw === "object" && !Array.isArray(raw));
        const request = Object.fromEntries(Object.entries(raw));
        requests.push(request);
        handler(request, socket);
      }
    });
  });
  servers.push(server);
  server.listen(file);
  await once(server, "listening");
  const broker = await connectNativeGreetd({ session, socketPath: file, timeoutMs, maxFrameBytes });
  return { broker, requests, server };
}
async function test(name: string, run: () => Promise<void>) {
  await run();
  cases++;
  console.log("ok " + name);
}
async function received(requests: unknown[], count: number) {
  const deadline = Date.now() + 1000;
  while (requests.length < count) {
    assert(Date.now() < deadline, "Synthetic request was not received");
    await delay(2);
  }
}

try {
  await test("immutable opaque command rejects mutable paths, shell syntax, argv and invalid store hash", async () => {
    assert(Object.isFrozen(session));
    assert.equal(JSON.stringify(session), "{}");
    await assert.rejects(
      connectNativeGreetd({ session: Object.freeze({ ...session }), socketPath: "/tmp/private" }),
      safeError,
    );
    for (const invalid of [
      "/usr/bin/moire-session",
      "/nix/var/nix/profiles/system/bin/moire-session",
      executable + " --session=other",
      executable + ";echo",
      executable + "$(echo)",
      executable + "\n",
      executable + "'",
      executable + '"',
      executable + "\\x",
      executable + "/../else",
      executable + "/./else",
      executable + "//else",
      executable + "/",
      executable.replace("012345", "01234e"),
      executable.replace("-moire-session", "-"),
      executable.replace("/bin/", "/sbin/"),
    ])
      assert.throws(() => fixedSessionCommand(invalid), /Invalid fixed session command/);
    const f = await fixture((_, socket) => socket.write(frame(success)));
    assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
    assert.equal(f.requests.length, 0);
    f.broker.close();
  });
  await test("fragmented repeated visible, secret, info and error prompts with exact null acknowledgements", async () => {
    const styles = ["visible", "secret", "info", "error", "secret"];
    let next = 0;
    const f = await fixture((request, socket) => {
      const reply =
        request.type === "create_session" || request.type === "post_auth_message_response"
          ? next < styles.length
            ? prompt(styles[next++])
            : success
          : success;
      const bytes = frame(reply);
      socket.write(bytes.subarray(0, 1));
      setTimeout(() => {
        socket.write(bytes.subarray(1, 6));
        setTimeout(() => socket.write(bytes.subarray(6)), 2);
      }, 2);
    });
    let reply = await f.broker.authenticate("syntheticuser");
    for (const style of styles) {
      assert.equal(reply.kind, "prompt");
      assert(reply.kind === "prompt" && reply.style === style);
      secretFree(reply);
      assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
      if (style === "info" || style === "error") {
        await assert.rejects(f.broker.respond(secret), safeError);
        reply = await f.broker.respond(null);
      } else {
        await assert.rejects(f.broker.respond(null), safeError);
        reply = await f.broker.respond(secret);
      }
    }
    assert.deepEqual(reply, { kind: "authorized" });
    assert.deepEqual(await f.broker.start(), { kind: "committed" });
    assert.deepEqual(f.requests.at(-1), { type: "start_session", cmd: [executable], env: [] });
    assert.deepEqual(
      f.requests.filter((r) => r.type === "post_auth_message_response").map((r) => r.response),
      [secret, secret, null, null, secret],
    );
    assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
    assert.deepEqual(await f.broker.cancel(), { kind: "unavailable" });
    assert.equal(f.requests.filter((r) => r.type === "cancel_session").length, 0);
    await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
    f.broker.close();
  });
  for (const response of ["wrong-synthetic-answer", ""]) {
    await test(
      "daemon denies " +
        (response ? "wrong" : "blank") +
        " credentials and acknowledged cancel permits fresh authentication",
      async () => {
        const f = await fixture((request, socket) =>
          socket.write(
            frame(
              request.type === "create_session"
                ? prompt("secret")
                : request.type === "post_auth_message_response"
                  ? denied()
                  : success,
            ),
          ),
        );
        await f.broker.authenticate("syntheticuser");
        const reply = await f.broker.respond(response);
        assert.deepEqual(reply, { kind: "denied" });
        secretFree(reply);
        assert.equal(f.requests.at(-1)?.response, response);
        await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
        assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
        assert.deepEqual(await f.broker.cancel(), { kind: "cancelled" });
        assert.equal((await f.broker.authenticate("syntheticuser")).kind, "prompt");
        f.broker.close();
      },
    );
  }
  for (const recover of [true, false]) {
    await test(
      "denied worker cancellation error requires a fresh success acknowledgement: " + recover,
      async () => {
        let cancels = 0;
        const f = await fixture((request, socket) => {
          if (request.type === "create_session") socket.write(frame(prompt("secret")));
          else if (request.type === "post_auth_message_response") socket.write(frame(denied()));
          else if (request.type === "cancel_session") {
            cancels++;
            socket.write(
              frame(
                recover && cancels === 2
                  ? success
                  : {
                      type: "error",
                      error_type: "error",
                      description: secret,
                    },
              ),
            );
          } else assert.fail("No session may launch after denial");
        });
        await f.broker.authenticate("syntheticuser");
        assert.deepEqual(await f.broker.respond("wrong-synthetic-answer"), { kind: "denied" });
        assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
        assert.deepEqual(await f.broker.cancel(), { kind: recover ? "cancelled" : "unavailable" });
        assert.equal(cancels, 2, "Cancellation retries once, never loops");
        if (recover) assert.equal((await f.broker.authenticate("syntheticuser")).kind, "prompt");
        else await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
        f.broker.close();
      },
    );
  }
  await test("one in-flight request; repeated cancellation waits for authentication and sends one cancel", async () => {
    let release: (() => void) | undefined;
    const f = await fixture((request, socket) => {
      if (request.type === "create_session") release = () => socket.write(frame(success));
      else socket.write(frame(success));
    });
    const auth = f.broker.authenticate("syntheticuser");
    await received(f.requests, 1);
    await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
    await assert.rejects(f.broker.respond(secret), safeError);
    const one = f.broker.cancel();
    const two = f.broker.cancel();
    assert.equal(f.requests.length, 1);
    assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
    assert(release);
    release();
    assert.deepEqual(await auth, { kind: "authorized" });
    assert.deepEqual(await Promise.all([one, two]), [{ kind: "cancelled" }, { kind: "cancelled" }]);
    assert.equal(f.requests.filter((r) => r.type === "cancel_session").length, 1);
    f.broker.close();
  });
  await test("cancellation during held launch cannot undo committed scheduling", async () => {
    let release: (() => void) | undefined;
    const f = await fixture((request, socket) => {
      if (request.type === "start_session") release = () => socket.write(frame(success));
      else socket.write(frame(success));
    });
    await f.broker.authenticate("syntheticuser");
    const launch = f.broker.start();
    await received(f.requests, 2);
    const cancel = f.broker.cancel();
    assert.equal(f.requests.length, 2);
    assert(release);
    release();
    assert.deepEqual(await launch, { kind: "committed" });
    assert.deepEqual(await cancel, { kind: "unavailable" });
    assert.equal(f.requests.length, 2);
    f.broker.close();
  });
  await test("explicit launch rejection is failed and requires cancellation before retry", async () => {
    const f = await fixture((request, socket) =>
      socket.write(
        frame(
          request.type === "start_session"
            ? { type: "error", error_type: "error", description: secret }
            : success,
        ),
      ),
    );
    await f.broker.authenticate("syntheticuser");
    assert.deepEqual(await f.broker.start(), { kind: "failed" });
    assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
    assert.deepEqual(await f.broker.cancel(), { kind: "cancelled" });
    assert.deepEqual(await f.broker.authenticate("syntheticuser"), { kind: "authorized" });
    f.broker.close();
  });
  for (const bad of [
    "json",
    "utf8",
    "length",
    "extra",
    "unknown",
    "extra-field",
    "text-type",
    "text-bound",
    "nul",
    "style",
    "error-type",
    "eof",
  ]) {
    await test("strict bounded authentication decoding fails closed for " + bad, async () => {
      const f = await fixture((_, socket) => {
        if (bad === "json") socket.write(Buffer.concat([header(3), Buffer.from("{!}")]));
        else if (bad === "utf8")
          socket.write(Buffer.concat([header(2), Buffer.from([0xff, 0xff])]));
        else if (bad === "length") socket.write(header(65537));
        else if (bad === "extra") socket.write(Buffer.concat([frame(success), frame(success)]));
        else if (bad === "unknown") socket.write(frame({ type: secret }));
        else if (bad === "extra-field") socket.write(frame({ ...success, unexpected: secret }));
        else if (bad === "text-type") socket.write(frame({ ...prompt("secret"), auth_message: 1 }));
        else if (bad === "text-bound")
          socket.write(frame({ ...prompt("secret"), auth_message: "x".repeat(4097) }));
        else if (bad === "nul")
          socket.write(frame({ ...prompt("secret"), auth_message: secret + "\0" }));
        else if (bad === "style") socket.write(frame(prompt("unknown")));
        else if (bad === "error-type") socket.write(frame({ ...denied(), error_type: "unknown" }));
        else socket.end(frame(success).subarray(0, 5));
      });
      await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
      assert.deepEqual(await f.broker.cancel(), { kind: "unavailable" });
      assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
      await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
      f.broker.close();
    });
  }
  await test("general authentication error is sanitized and terminal", async () => {
    const f = await fixture((_, socket) =>
      socket.write(frame({ type: "error", error_type: "error", description: secret })),
    );
    await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
    assert.deepEqual(await f.broker.cancel(), { kind: "unavailable" });
    f.broker.close();
  });
  for (const mode of ["timeout", "eof", "prompt", "malformed"]) {
    await test("unknown launch " + mode + " blocks cancel and retries", async () => {
      const f = await fixture((request, socket) => {
        if (request.type !== "start_session") socket.write(frame(success));
        else if (mode === "eof") socket.end();
        else if (mode === "prompt") socket.write(frame(prompt("secret")));
        else if (mode === "malformed") socket.write(frame({ type: secret }));
      }, 30);
      await f.broker.authenticate("syntheticuser");
      const launch = f.broker.start();
      const cancel = f.broker.cancel();
      assert.deepEqual(await launch, { kind: "unavailable" });
      assert.deepEqual(await cancel, { kind: "unavailable" });
      assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
      await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
      assert.deepEqual(
        f.requests.map((r) => r.type),
        ["create_session", "start_session"],
      );
      f.broker.close();
    });
  }
  await test("late success after authentication timeout cannot authorize or cancel", async () => {
    let late: net.Socket | undefined;
    const f = await fixture((_, socket) => {
      late = socket;
    }, 20);
    await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
    assert(late);
    late.write(frame(success));
    await delay(10);
    assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
    assert.deepEqual(await f.broker.cancel(), { kind: "unavailable" });
    assert.equal(f.requests.length, 1);
    f.broker.close();
  });
  await test("late success after unknown launch cannot commit, cancel or retry", async () => {
    let late: net.Socket | undefined;
    const f = await fixture((request, socket) => {
      if (request.type === "start_session") late = socket;
      else socket.write(frame(success));
    }, 20);
    await f.broker.authenticate("syntheticuser");
    assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
    assert(late);
    late.write(frame(success));
    await delay(10);
    assert.deepEqual(await f.broker.start(), { kind: "unavailable" });
    assert.deepEqual(await f.broker.cancel(), { kind: "unavailable" });
    await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
    assert.deepEqual(
      f.requests.map((r) => r.type),
      ["create_session", "start_session"],
    );
    f.broker.close();
  });
  await test("explicit close rejects held request; cancellation error and timeout stay unavailable", async () => {
    const held = await fixture(() => {});
    const auth = held.broker.authenticate("syntheticuser");
    held.broker.close();
    held.broker.close();
    await assert.rejects(auth, safeError);
    assert.deepEqual(await held.broker.cancel(), { kind: "unavailable" });
    for (const mode of ["error", "timeout"]) {
      const f = await fixture((request, socket) => {
        if (request.type !== "cancel_session") socket.write(frame(success));
        else if (mode === "error") socket.write(frame(denied()));
      }, 20);
      await f.broker.authenticate("syntheticuser");
      assert.deepEqual(await f.broker.cancel(), { kind: "unavailable" });
      await assert.rejects(f.broker.authenticate("syntheticuser"), safeError);
      f.broker.close();
    }
  });
  await test("invalid accounts, response bounds and connection configuration contain no supplied text", async () => {
    const f = await fixture(
      (request, socket) =>
        socket.write(frame(request.type === "create_session" ? prompt("secret") : success)),
      100,
      256,
    );
    for (const username of ["", secret + "\n", "x".repeat(65)])
      await assert.rejects(f.broker.authenticate(username), safeError);
    assert.equal(f.requests.length, 0);
    await f.broker.authenticate("syntheticuser");
    for (const response of [secret + "\0", "x".repeat(4097), "x".repeat(250)])
      await assert.rejects(f.broker.respond(response), safeError);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(await f.broker.cancel(), { kind: "cancelled" });
    f.broker.close();
    for (const socketPath of [
      "relative",
      "/tmp/a/../b",
      "/tmp/" + secret + "\0",
      "/" + "x".repeat(104),
    ])
      await assert.rejects(connectNativeGreetd({ session, socketPath }), safeError);
    for (const timeoutMs of [0, 9, 30001, NaN])
      await assert.rejects(
        connectNativeGreetd({ session, socketPath: "/tmp/private", timeoutMs }),
        safeError,
      );
    for (const maxFrameBytes of [0, 255, 65537, NaN])
      await assert.rejects(
        connectNativeGreetd({ session, socketPath: "/tmp/private", maxFrameBytes }),
        safeError,
      );
    await assert.rejects(
      connectNativeGreetd({ session, socketPath: path.join(directory, "missing") }),
      safeError,
    );
  });
  console.log(
    JSON.stringify({
      suite: "native greetd private Unix IPC",
      cases,
      actualExitCode: 0,
      pamAuthentication: false,
      sessionExecutions: 0,
    }),
  );
} finally {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await fs.rm(directory, { recursive: true, force: true });
}
