import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { SessionBus, DbusRemoteError, type DbusSignalMatch } from "./index";
import {
  encodeMessage,
  decodeMessage,
  encodeBody,
  decodeBody,
  messageByteLength,
  type DbusMessage,
} from "./codec";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-dbus-signals-"));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const wait = async (predicate: () => boolean, label: string) => {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out: ${label}`);
};
const match: DbusSignalMatch = {
  sender: "org.moire.SignalSmoke",
  path: "/org/moire/SignalSmoke",
  interface: "org.moire.SignalSmoke",
  member: "Changed",
};
const busCall = (member: string, signature?: string, body?: unknown[]) => ({
  destination: "org.freedesktop.DBus",
  path: "/org/freedesktop/DBus",
  interface: "org.freedesktop.DBus",
  member,
  signature,
  body,
});
let cases = 0;
const connections = new Set<SessionBus>();
async function connect(address: string) {
  const bus = await SessionBus.connect(address, { timeoutMs: 2000 });
  connections.add(bus);
  return bus;
}
async function privateDaemon(socketPath: string) {
  const child = spawn(
    process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
    [
      ...(process.env.MOIRE_TEST_DBUS_CONFIG
        ? [`--config-file=${process.env.MOIRE_TEST_DBUS_CONFIG}`]
        : ["--session"]),
      "--nofork",
      "--nopidfile",
      "--print-address=1",
      `--address=unix:path=${socketPath}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += String(data);
  });
  child.stderr.on("data", (data) => {
    stderr = (stderr + String(data)).slice(-4096);
  });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  let failure: Error | null = null;
  child.once("error", (error) => {
    failure = error;
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      try {
        await wait(() => exited, "owned private daemon exits");
      } catch (error) {
        child.kill("SIGKILL");
        await wait(() => exited, "owned private daemon exits after bounded escalation");
        throw error;
      }
    }
  };
  try {
    await wait(() => !!failure || exited || stdout.includes("\n"), "private daemon address");
    if (failure) throw failure;
    if (exited) throw new Error(`Private daemon exited: ${stderr}`);
    const address = stdout.split("\n")[0];
    assert.ok(address?.startsWith("unix:"));
    return { address, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** A real socket/auth/codec peer supplies deterministic ordering that a daemon cannot force. */
async function wirePeer(
  label: string,
  handler: (message: DbusMessage, send: (message: DbusMessage) => void) => void,
  auth: "normal" | "stall" | "close" = "normal",
) {
  const socketPath = path.join(directory, `${label}.socket`);
  const sockets = new Set<net.Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let input = Buffer.alloc(0),
      mode: "auth" | "begin" | "messages" = "auth";
    socket.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (mode === "auth") {
        const end = input.indexOf("\r\n");
        if (end < 0) return;
        input = input.subarray(end + 2);
        if (auth === "close") {
          socket.end();
          return;
        }
        if (auth === "stall") return;
        socket.write("OK 0123456789abcdef0123456789abcdef\r\n");
        mode = "begin";
      }
      if (mode === "begin") {
        const end = input.indexOf("\r\n");
        if (end < 0) return;
        assert.equal(input.subarray(0, end).toString(), "BEGIN");
        input = input.subarray(end + 2);
        mode = "messages";
      }
      for (;;) {
        const length = messageByteLength(input);
        if (length === null || input.length < length) return;
        const message = decodeMessage(input.subarray(0, length));
        input = input.subarray(length);
        handler(message, (reply) => {
          if (!socket.destroyed) socket.write(encodeMessage(reply));
        });
      }
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  return {
    address: `unix:path=${socketPath}`,
    later(callback: () => void, ms: number) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, ms);
      timers.add(timer);
    },
    async stop() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}
const reply = (message: DbusMessage, body: unknown[] = [], signature = ""): DbusMessage => ({
  type: 2,
  serial: message.serial + 1000,
  replySerial: message.serial,
  sender: "org.freedesktop.DBus",
  signature,
  body,
});
const ownerChanged = (name: string, oldOwner: string, newOwner: string): DbusMessage => ({
  type: 4,
  serial: 900,
  sender: "org.freedesktop.DBus",
  path: "/org/freedesktop/DBus",
  interface: "org.freedesktop.DBus",
  member: "NameOwnerChanged",
  signature: "sss",
  body: [name, oldOwner, newOwner],
});
try {
  const mixed = Buffer.alloc(16);
  mixed.writeUInt32LE(1, 0);
  mixed.writeDoubleLE(0.7, 8);
  assert.ok(
    encodeBody("ud", [1, 0.7]).equals(mixed),
    "mixed uint32/double matches independently authored wire bytes",
  );
  assert.deepEqual(decodeBody("ud", mixed), [1, 0.7]);
  cases++;
  for (const auth of ["stall", "close"] as const) {
    const peer = await wirePeer(`auth-${auth}`, () => {}, auth);
    try {
      await assert.rejects(
        SessionBus.connect(peer.address, { timeoutMs: 40 }),
        /timed out|disconnected/,
      );
    } finally {
      await peer.stop();
    }
    cases++;
  }
  const hello = await wirePeer("hello-timeout", () => {});
  try {
    await assert.rejects(SessionBus.connect(hello.address, { timeoutMs: 40 }), /timed out/);
  } finally {
    await hello.stop();
  }
  cases++;
  const cancelled = await wirePeer("auth-cancel", () => {}, "stall");
  const authCancellation = new AbortController();
  const pendingConnection = SessionBus.connect(cancelled.address, {
    signal: authCancellation.signal,
    timeoutMs: 500,
  });
  authCancellation.abort();
  await assert.rejects(pendingConnection, /cancel|abort/i);
  await cancelled.stop();
  cases++;

  const removed: string[] = [],
    delivered: string[] = [];
  const ordering = await wirePeer("ordering", (message, send) => {
    if (message.member === "Hello") send(reply(message, [":1.100"], "s"));
    else if (message.member === "AddMatch") {
      if (String(message.body?.[0]).includes("member='Rejected'")) {
        send({
          type: 3,
          serial: 301,
          replySerial: message.serial,
          errorName: "org.freedesktop.DBus.Error.AccessDenied",
          signature: "s",
          body: ["fixture rejection"],
        });
      } else {
        // The same receive batch tests setup delivery before the AddMatch await resumes.
        send(reply(message));
        if (String(message.body?.[0]).includes("member='Queued'"))
          send({
            type: 4,
            serial: 302,
            sender: ":1.7",
            path: match.path,
            interface: match.interface,
            member: "Queued",
            signature: "s",
            body: ["queued"],
          });
      }
    } else if (message.member === "RemoveMatch") {
      removed.push(String(message.body?.[0]));
      send(reply(message));
    } else if (message.member === "GetNameOwner") {
      send(ownerChanged(String(message.body?.[0]), ":1.7", ":1.8"));
      send(reply(message, [":1.7"], "s"));
    }
  });
  try {
    const bus = await connect(ordering.address);
    const owners: Array<string | null> = [];
    const stop = await bus.watchName(match.sender, (owner) => owners.push(owner));
    assert.deepEqual(owners, [":1.8"], "stale GetNameOwner response cannot replace changed owner");
    cases++;
    await stop();
    await stop();
    const queued = await bus.subscribeSignal(
      { ...match, sender: ":1.7", member: "Queued" },
      (message) => delivered.push(String(message.body?.[0])),
    );
    await wait(() => delivered.length === 1, "signal in AddMatch reply batch");
    await queued();
    await queued();
    assert.equal(removed.filter((rule) => rule.includes("member='Queued'")).length, 1);
    cases++;
    await assert.rejects(
      bus.subscribeSignal({ ...match, sender: ":1.7", member: "Rejected" }, () =>
        assert.fail("rejected listener cannot be active"),
      ),
      DbusRemoteError,
    );
    cases++;
    await assert.rejects(
      bus.subscribeSignal({ ...match, sender: ":1.7", arg0: "bad\0value" }, () => {}),
      /Invalid/,
    );
    cases++;
    await assert.rejects(bus.call(busCall("Ignored"), { timeoutMs: 0 }), /timeoutMs/);
    cases++;
    const timed = bus.call(busCall("Ignored"), { timeoutMs: 20 });
    await assert.rejects(timed, /timed out/);
    cases++;
    const abort = new AbortController();
    const pending = bus.call(busCall("Ignored"), { signal: abort.signal });
    abort.abort();
    await assert.rejects(pending, /cancel/);
    cases++;
    let disconnects = 0;
    const unsubscribe = bus.onDisconnect(() => disconnects++);
    const waiting = bus.call(busCall("Ignored"));
    const rejected = assert.rejects(waiting, /closed/);
    bus.close();
    await rejected;
    bus.close();
    assert.equal(disconnects, 1);
    unsubscribe();
    await assert.rejects(bus.call(busCall("Ignored")), /closed/);
    cases++;
  } finally {
    await ordering.stop();
  }

  let removedAfterCancellation = 0,
    afterCancellationSignals = 0;
  const installation = await wirePeer("installation-cancel", (message, send) => {
    if (message.member === "Hello") send(reply(message, [":1.100"], "s"));
    else if (message.member === "AddMatch")
      installation.later(() => {
        send(reply(message));
        send({
          type: 4,
          serial: 502,
          sender: ":1.7",
          path: match.path,
          interface: match.interface,
          member: match.member,
        });
      }, 50);
    else if (message.member === "RemoveMatch") {
      removedAfterCancellation++;
      send(reply(message));
    }
  });
  try {
    const bus = await connect(installation.address);
    await assert.rejects(
      bus.subscribeSignal({ ...match, sender: ":1.7" }, () => afterCancellationSignals++, {
        timeoutMs: 15,
      }),
      /timed out/,
    );
    await sleep(75);
    assert.equal(removedAfterCancellation, 1);
    assert.equal(afterCancellationSignals, 0);
    assert.equal(
      (await bus.call(busCall("Hello"))).body?.[0],
      ":1.100",
      "late match reply cannot revive cancelled setup",
    );
    cases++;
    const abort = new AbortController();
    const pending = bus.subscribeSignal(
      { ...match, sender: ":1.7" },
      () => afterCancellationSignals++,
      { signal: abort.signal },
    );
    abort.abort();
    await assert.rejects(pending, /cancel/);
    await sleep(75);
    assert.equal(afterCancellationSignals, 0);
    assert.equal(removedAfterCancellation, 2);
    cases++;
  } finally {
    await installation.stop();
  }
  const failure = await wirePeer("remove-failure", (message, send) => {
    if (message.member === "Hello") send(reply(message, [":1.100"], "s"));
    else if (message.member === "AddMatch") send(reply(message));
    else if (message.member === "RemoveMatch")
      send({
        type: 3,
        serial: 503,
        replySerial: message.serial,
        errorName: "org.freedesktop.DBus.Error.AccessDenied",
        signature: "s",
        body: ["fixture removal denied"],
      });
  });
  try {
    const bus = await connect(failure.address);
    let disconnected = 0;
    bus.onDisconnect(() => disconnected++);
    const dispose = await bus.subscribeSignal({ ...match, sender: ":1.7" }, () => {});
    await assert.rejects(dispose(), DbusRemoteError);
    assert.equal(
      disconnected,
      1,
      "failed remote removal retires connection instead of accumulating rules",
    );
    await assert.rejects(bus.call(busCall("Hello")), DbusRemoteError);
    cases++;
  } finally {
    await failure.stop();
  }
  const flood = await wirePeer("setup-flood", (message, send) => {
    if (message.member === "Hello") send(reply(message, [":1.100"], "s"));
    else if (message.member === "AddMatch") {
      for (let index = 0; index < 65; index++)
        send({
          type: 4,
          serial: 1000 + index,
          sender: ":1.7",
          path: match.path,
          interface: match.interface,
          member: match.member,
        });
    }
  });
  try {
    const bus = await connect(flood.address);
    let delivered = 0;
    await assert.rejects(
      bus.subscribeSignal({ ...match, sender: ":1.7" }, () => delivered++),
      /setup buffer/,
    );
    assert.equal(delivered, 0, "unaccepted setup signals cannot escape the bounded buffer");
    cases++;
  } finally {
    await flood.stop();
  }
  const limits = await wirePeer("limits", (message, send) => {
    if (message.member === "Hello") send(reply(message, [":1.100"], "s"));
    else if (message.member === "AddMatch" || message.member === "RemoveMatch")
      send(reply(message));
  });
  try {
    const lifetime = new AbortController();
    const bus = await SessionBus.connect(limits.address, { signal: lifetime.signal });
    connections.add(bus);
    const subscriptions = [];
    for (let index = 0; index < 128; index++)
      subscriptions.push(await bus.subscribeSignal({ ...match, sender: ":1.7" }, () => {}));
    await assert.rejects(
      bus.subscribeSignal({ ...match, sender: ":1.7" }, () => {}),
      /Too many/,
    );
    await Promise.all(subscriptions.map((dispose) => dispose()));
    cases++;
    const pending = Array.from({ length: 1024 }, () =>
      bus.call(busCall("Ignored")).then(
        () => assert.fail("ignored calls cannot resolve"),
        (error: unknown) => error,
      ),
    );
    await assert.rejects(bus.call(busCall("Ignored")), /Too many/);
    cases++;
    let disconnected = 0;
    bus.onDisconnect(() => disconnected++);
    lifetime.abort();
    await Promise.all(pending);
    await wait(() => disconnected === 1, "connection-lifetime cancellation after Hello");
    cases++;
  } finally {
    await limits.stop();
  }

  let daemon: Awaited<ReturnType<typeof privateDaemon>> | null = null;
  try {
    daemon = await privateDaemon(path.join(directory, "real.socket"));
  } catch (error) {
    if (process.env.MOIRE_TEST_REAL_DBUS === "1") throw error;
    console.log(
      `[dbus/signals] ${cases} socket/codec cases passed; real private daemon unavailable: ${String(error)}`,
    );
  }
  if (daemon) {
    try {
      const observer = await connect(daemon.address),
        first = await connect(daemon.address),
        second = await connect(daemon.address);
      assert.equal(await first.requestName(match.sender, 1), 1);
      const owners: Array<string | null> = [],
        uniqueOwners: Array<string | null> = [];
      const watch = await observer.watchName(match.sender, (owner) => owners.push(owner));
      const watchUnique = await observer.watchName(first.name!, (owner) =>
        uniqueOwners.push(owner),
      );
      assert.deepEqual(owners, [first.name]);
      assert.deepEqual(uniqueOwners, [first.name]);
      cases++;
      const signals: DbusMessage[] = [];
      const stop = await observer.subscribeSignal({ ...match, arg0: "accepted" }, (message) =>
        signals.push(message),
      );
      const send = (
        bus: SessionBus,
        changes: Partial<Parameters<SessionBus["emitSignal"]>[0]> = {},
      ) =>
        bus.emitSignal({
          path: match.path,
          interface: match.interface,
          member: match.member,
          signature: "s",
          body: ["accepted"],
          ...changes,
        });
      send(first);
      await wait(() => signals.length === 1, "real broadcast signal");
      cases++;
      // Destination forces delivery even without a match, exercising exact local checks.
      assert.ok(observer.name);
      send(second, { destination: observer.name });
      send(first, { destination: observer.name, path: "/wrong" });
      send(first, { destination: observer.name, interface: "org.moire.Wrong" });
      send(first, { destination: observer.name, member: "Wrong" });
      send(first, { destination: observer.name, body: ["rejected"] });
      await observer.call(busCall("ListNames"));
      await sleep(20);
      assert.equal(signals.length, 1);
      cases++;
      assert.equal(await second.requestName(match.sender, 2), 1);
      await wait(() => owners.at(-1) === second.name, "real service owner replacement");
      send(first, { destination: observer.name });
      send(second);
      await wait(() => signals.length === 2, "new owner signal accepted");
      assert.equal(signals.at(-1)?.sender, second.name);
      cases++;
      first.close();
      await wait(() => uniqueOwners.at(-1) === null, "unique producer disappearance");
      cases++;
      const abort = new AbortController();
      let abortedSignals = 0;
      await observer.subscribeSignal({ ...match, sender: second.name! }, () => abortedSignals++, {
        signal: abort.signal,
      });
      abort.abort();
      send(second, { destination: observer.name });
      await observer.call(busCall("ListNames"));
      await sleep(20);
      assert.equal(abortedSignals, 0);
      assert.equal(
        signals.length,
        3,
        "aborting one subscription preserves another active listener",
      );
      cases++;
      await stop();
      await stop();
      send(second, { destination: observer.name });
      await observer.call(busCall("ListNames"));
      await sleep(20);
      assert.equal(signals.length, 3);
      cases++;
      const quotedValue = "comma, quote' slash\\";
      let quotedSignals = 0;
      const stopQuoted = await observer.subscribeSignal(
        { ...match, sender: second.name!, arg0: quotedValue },
        () => quotedSignals++,
      );
      send(second, { body: [quotedValue] });
      await wait(
        () => quotedSignals === 1,
        "real daemon exact quoted/backslash/comma argument match",
      );
      await stopQuoted();
      cases++;
      second.exportObject(match.path, {
        name: match.interface,
        methods: {
          Slow: {
            inSignature: "",
            outSignature: "s",
            handler: async () => {
              await sleep(100);
              return { body: ["late"] };
            },
          },
          Hang: { inSignature: "", outSignature: "", handler: () => new Promise(() => {}) },
          MixedDouble: { inSignature: "ud", outSignature: "ud", handler: ({ body }) => ({ body }) },
          DoubleArray: {
            inSignature: "uad",
            outSignature: "uad",
            handler: ({ body }) => ({ body }),
          },
          Fast: { inSignature: "", outSignature: "s", handler: () => ({ body: ["fresh"] }) },
          MissingObject: {
            inSignature: "",
            outSignature: "",
            handler: () => {
              throw new DbusRemoteError(
                "org.freedesktop.DBus.Error.UnknownObject",
                "Removed fixture object",
              );
            },
          },
          OrdinaryFailure: {
            inSignature: "",
            outSignature: "",
            handler: () => {
              throw new Error("Ordinary fixture failure");
            },
          },
          InvalidErrorName: {
            inSignature: "",
            outSignature: "",
            handler: () => {
              throw new DbusRemoteError("invalid/name", "Invalid fixture error name");
            },
          },
        },
      });
      const method = (member: string) => ({
        destination: match.sender,
        path: match.path,
        interface: match.interface,
        member,
      });
      for (const { member, errorName } of [
        { member: "MissingObject", errorName: "org.freedesktop.DBus.Error.UnknownObject" },
        { member: "OrdinaryFailure", errorName: "org.freedesktop.DBus.Error.Failed" },
        { member: "InvalidErrorName", errorName: "org.freedesktop.DBus.Error.Failed" },
      ]) {
        await assert.rejects(
          observer.call(method(member)),
          (error: unknown) => error instanceof DbusRemoteError && error.errorName === errorName,
        );
      }
      cases++;
      assert.deepEqual(
        (await observer.call({ ...method("MixedDouble"), signature: "ud", body: [7, 0.7] })).body,
        [7, 0.7],
        "actual daemon accepts aligned mixed double call/reply",
      );
      assert.deepEqual(
        (
          await observer.call({
            ...method("DoubleArray"),
            signature: "uad",
            body: [3, [0.7, -0.5, 1.25]],
          })
        ).body,
        [3, [0.7, -0.5, 1.25]],
        "array elements retain double alignment",
      );
      cases++;
      await assert.rejects(observer.call(method("Slow"), { timeoutMs: 20 }), /timed out/);
      const cancellation = new AbortController();
      const pending = observer.call(method("Slow"), { signal: cancellation.signal });
      cancellation.abort();
      await assert.rejects(pending, /cancel/);
      await sleep(150);
      assert.deepEqual(
        (await observer.call(method("Fast"))).body,
        ["fresh"],
        "late replies cannot satisfy a later call",
      );
      cases++;
      let disconnected = 0;
      observer.onDisconnect(() => disconnected++);
      const hanging = observer.call(method("Hang"));
      const rejectHang = assert.rejects(hanging, /disconnect/);
      await daemon.stop();
      await rejectHang;
      await wait(() => disconnected === 1 && owners.at(-1) === null, "daemon loss revokes owner");
      cases++;
      await watch();
      await watchUnique();
      const replacement = await privateDaemon(path.join(directory, "real.socket"));
      try {
        const fresh = await connect(replacement.address);
        const freshOwners: Array<string | null> = [];
        const unwatch = await fresh.watchName(match.sender, (owner) => freshOwners.push(owner));
        assert.deepEqual(
          freshOwners,
          [null],
          "replacement daemon cannot inherit previous ownership",
        );
        await assert.rejects(observer.call(busCall("ListNames")), /disconnect/);
        await unwatch();
        cases++;
        const tail = await connect(replacement.address);
        assert.ok(tail.name);
        const payload = "x".repeat(65536);
        let drained = 0;
        const stopDrain = await fresh.subscribeSignal(
          { ...match, sender: tail.name },
          (message) => {
            assert.equal(message.body?.[0], payload);
            drained++;
          },
        );
        for (let index = 0; index < 32; index++)
          tail.emitSignal({
            path: match.path,
            interface: match.interface,
            member: match.member,
            signature: "s",
            body: [payload],
          });
        tail.close();
        await wait(
          () => drained === 32,
          "explicit close preserves queued signal flush under backpressure",
        );
        await stopDrain();
        cases++;
      } finally {
        await replacement.stop();
      }
      console.log(
        `[dbus/signals] ${cases} real daemon/socket/codec signal, owner, cancellation and teardown cases passed`,
      );
    } finally {
      await daemon.stop();
    }
  }
} finally {
  for (const bus of connections) bus.close();
  await fs.rm(directory, { recursive: true, force: true });
}
