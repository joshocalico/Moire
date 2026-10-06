/** Actual compositor input stage/teardown, with no device or native readiness operations. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-exclusive-seat-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer } = await import("./server");
class Keyboard extends EventEmitter {
  starts: {
    paths: string[] | undefined;
    options: { requireEscape?: boolean; exclusive?: boolean };
  }[] = [];
  stops = 0;
  startupFailure: Error | null = null;
  start(paths?: string[], options: { requireEscape?: boolean; exclusive?: boolean } = {}): void {
    this.starts.push({ paths, options });
    if (this.startupFailure) throw this.startupFailure;
  }
  stop(): void {
    this.stops++;
  }
}
class Server extends CompositorServer {
  activate(keyboard: Keyboard): void {
    this.startKeyboardInput(keyboard);
  }
}
function ownedResources(server: Server) {
  const calls = { pointer: 0, socket: 0, readiness: 0, wake: 0 };
  Object.assign(server, {
    pointerDev: {
      stop: () => {
        calls.pointer++;
      },
    },
    socket: {
      stop: () => {
        calls.socket++;
      },
    },
    readiness: {
      stop: () => {
        calls.readiness++;
      },
    },
    compositeWakeResolver: () => {
      calls.wake++;
    },
    running: true,
  });
  return calls;
}
const logs: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  logs.push(args);
};
try {
  const failed = new Server(fixture);
  const startup = new Keyboard();
  startup.startupFailure = new Error("fixture grab rejected before input publication");
  const startupResources = ownedResources(failed);
  assert.throws(
    () => failed.activate(startup),
    (error) => error === startup.startupFailure,
  );
  assert.deepEqual(startup.starts, [{ paths: undefined, options: { exclusive: true } }]);
  assert.equal(startup.stops, 1);
  assert.deepEqual(startupResources, { pointer: 1, socket: 1, readiness: 1, wake: 1 });
  failed.stop();
  assert.equal(startup.stops, 1, "partial-start teardown is idempotent");
  assert.deepEqual(startupResources, { pointer: 1, socket: 1, readiness: 1, wake: 1 });

  const server = new Server(fixture);
  const keyboard = new Keyboard();
  const resources = ownedResources(server);
  const keys: { code: number; value: number }[] = [];
  server.setShell({
    paint() {},
    onKey: (key) => {
      keys.push(key);
      return true;
    },
    onPointerButton: () => false,
    isLauncherOpen: () => false,
  });
  const fatal: Error[] = [];
  let removed = 0;
  const removeBefore = server.onFatalError(() => {
    removed++;
  });
  removeBefore();
  const failure = new Error("fixture same-path reopen could not reacquire ownership");
  let removeMain = () => {};
  removeMain = server.onFatalError((error) => {
    assert.equal(error, failure);
    assert.equal(keyboard.stops, 1, "all input handles are stopped before main notification");
    assert.deepEqual(resources, { pointer: 1, socket: 1, readiness: 1, wake: 1 });
    removeMain(); // Mirrors the actual root-owned main cleanup subscription.
    server.stop();
    fatal.push(error);
  });
  let following = 0;
  const removeFollowing = server.onFatalError(() => {
    following++;
  });
  server.activate(keyboard);
  assert.deepEqual(keyboard.starts, [{ paths: undefined, options: { exclusive: true } }]);
  keyboard.emit("key", { code: 30, value: 1, timeMs: 1 });
  assert.equal(keys.length, 1, "owned keyboard routes through actual shell input path");
  keyboard.emit("exclusiveFailure", failure);
  keyboard.emit("exclusiveFailure", failure);
  keyboard.emit("key", { code: 31, value: 1, timeMs: 2 });
  assert.deepEqual(fatal, [failure]);
  assert.equal(following, 1, "self-unsubscribe during fatal iteration preserves next listener");
  assert.equal(removed, 0);
  assert.equal(keys.length, 1, "queued events from stopped owner cannot route input");
  assert.equal(keyboard.stops, 1);
  const replacement = new Keyboard();
  assert.throws(
    () => server.activate(replacement),
    (error) => error === failure,
  );
  assert.equal(replacement.starts.length, 0, "failed compositor cannot silently reuse input loop");
  removeFollowing();
  server.stop();
  assert.deepEqual(resources, { pointer: 1, socket: 1, readiness: 1, wake: 1 });
  assert.equal(logs.length, 1, "one fatal ownership diagnostic");
  console.log(
    "[seat/ownership] actual exclusive stage startup/reopen failure, ordered teardown, stale callbacks and reentrant main unsubscribe PASS; no native devices",
  );
} finally {
  console.error = originalError;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}
