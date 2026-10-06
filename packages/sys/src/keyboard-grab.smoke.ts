import assert from "node:assert/strict";
import { EvdevKeyboard } from "./evdev";
import { hasVtRoutableKeys, isTypingKeyboard, type KeyboardDeviceIo } from "./keyboard-grab";

function bits(keys: number[]) {
  const result = Buffer.alloc(96);
  for (const key of keys) result[Math.floor(key / 8)] |= 1 << (key % 8);
  return result;
}
const typing = bits([1, 28, 29, 30, 46]);
assert(isTypingKeyboard(typing));
assert(hasVtRoutableKeys(bits([116])), "power-only sibling routes to VT");
assert(hasVtRoutableKeys(bits([0x1f1])), "braille route covered");
assert(!hasVtRoutableKeys(bits([0x110])), "pointer button is not a VT key");

function fixture(fail?: string) {
  let next = 100;
  const live = new Map<number, string>();
  const grabs = new Set<number>();
  const callbacks = new Map<number, () => void>();
  const generation = new Map<string, number>();
  const heldSamples = new Map<number, number>();
  const events: string[] = [];
  let readError = false;
  let changed = false;
  const io: KeyboardDeviceIo = {
    identity(fd) {
      const path = live.get(fd);
      assert(path);
      return path === "alias" ? "first" : path;
    },
    open(path) {
      events.push(`open:${path}`);
      if (fail === "open" && path === "second") throw new Error("open denied");
      const fd = next++;
      live.set(fd, path);
      generation.set(path, (generation.get(path) ?? 0) + 1);
      return fd;
    },
    close(fd) {
      assert(live.has(fd), "close each owned FD exactly once");
      events.push(`close:${fd}`);
      live.delete(fd);
      grabs.delete(fd);
    },
    keyBits(fd) {
      const path = live.get(fd);
      assert(path);
      if (fail === "capability" && path === "second") throw new Error("capability denied");
      if (path === "mouse") return bits([0x110]);
      if (path === "hybrid-buttons") return bits([1, 28, 29, 30, 46, 0x110]);
      if (path === "media" || (changed && (generation.get(path) ?? 0) > 1)) return bits([116]);
      return typing;
    },
    eventBits(fd) {
      const path = live.get(fd);
      return bits(path === "hybrid-rel" ? [0, 1, 2] : path === "hybrid-abs" ? [0, 1, 3] : [0, 1]);
    },
    heldKeyBits(fd) {
      const sample = (heldSamples.get(fd) ?? 0) + 1;
      heldSamples.set(fd, sample);
      if (
        live.get(fd) === "second" &&
        ((fail === "held" && sample === 1) || (fail === "held-after" && sample === 2))
      )
        return bits([29]);
      return bits([]);
    },
    grab(fd) {
      events.push(`grab:${fd}`);
      if (fail === "grab" && live.get(fd) === "second") throw new Error("busy");
      grabs.add(fd);
    },
    read(fd) {
      if (readError && live.get(fd) === "first") {
        readError = false;
        throw Object.assign(new Error("unplugged"), { code: "ENODEV" });
      }
      throw Object.assign(new Error("empty"), { code: "EAGAIN" });
    },
  };
  const readiness = {
    add(fd: number, callback: () => void) {
      events.push(`register:${fd}`);
      if (fail === "register" && live.get(fd) === "second") throw new Error("registration failed");
      callbacks.set(fd, callback);
    },
    remove(fd: number) {
      events.push(`unregister:${fd}`);
      callbacks.delete(fd);
    },
  };
  const keyboard = new EvdevKeyboard(readiness, io);
  return {
    keyboard,
    live,
    grabs,
    callbacks,
    events,
    generation,
    setReadError: () => {
      readError = true;
    },
    setChanged: () => {
      changed = true;
    },
  };
}
let cases = 4;
{
  const f = fixture();
  const publications: string[][] = [];
  f.keyboard.on("devicesChanged", (paths: string[]) => publications.push([...paths]));
  f.keyboard.start(["first", "media", "mouse"], { exclusive: true });
  assert.deepEqual(f.keyboard.openedDevices, ["first", "media"]);
  assert.deepEqual(publications, [["first", "media"]]);
  assert.equal(f.live.size, 2);
  assert.equal(f.grabs.size, 2);
  for (const fd of f.grabs)
    assert(f.events.indexOf(`grab:${fd}`) < f.events.indexOf(`register:${fd}`));
  f.keyboard.stop();
  f.keyboard.stop();
  assert.equal(f.live.size, 0);
  assert.equal(f.grabs.size, 0);
  assert.equal(f.callbacks.size, 0);
  cases++;
}
{
  const f = fixture();
  f.keyboard.start(["first", "first", "alias", "media"], { exclusive: true });
  assert.deepEqual(f.keyboard.openedDevices, ["first", "media"]);
  assert.equal(f.grabs.size, 2);
  assert.equal(f.live.size, 2);
  f.keyboard.stop();
  assert.equal(f.live.size, 0);
  cases++;
}
for (const fail of ["open", "capability", "held", "held-after", "grab", "register"]) {
  const f = fixture(fail);
  const publications: string[][] = [];
  f.keyboard.on("devicesChanged", (paths: string[]) => publications.push([...paths]));
  assert.throws(() => f.keyboard.start(["first", "second"], { exclusive: true }), /startup failed/);
  assert.equal(f.live.size, 0);
  assert.equal(f.grabs.size, 0);
  assert.equal(f.callbacks.size, 0);
  assert.deepEqual(publications, [[]], "partial acquisition is never published");
  cases++;
}
for (const paths of [[], ["mouse"], ["media"]]) {
  const f = fixture();
  assert.throws(() => f.keyboard.start(paths, { exclusive: true }), /typing keyboard/);
  assert.equal(f.live.size, 0);
  assert.equal(f.grabs.size, 0);
  assert.equal(f.callbacks.size, 0);
  cases++;
}
for (const path of ["hybrid-rel", "hybrid-abs", "hybrid-buttons"]) {
  const f = fixture();
  assert.throws(() => f.keyboard.start(["first", path], { exclusive: true }), /startup failed/);
  assert.equal(f.live.size, 0);
  assert.equal(f.grabs.size, 0);
  assert.equal(f.callbacks.size, 0);
  cases++;
}
{
  const f = fixture();
  f.keyboard.start(["first"], { exclusive: true });
  f.setReadError();
  f.callbacks.get(100)?.();
  assert.deepEqual(f.keyboard.openedDevices, ["first"]);
  assert(!f.live.has(100));
  assert(f.grabs.has(101));
  assert(f.callbacks.has(101));
  assert(f.events.indexOf("grab:101") < f.events.indexOf("register:101"));
  f.keyboard.stop();
  assert.equal(f.live.size, 0);
  cases++;
}
{
  const f = fixture();
  const failures: Error[] = [];
  f.keyboard.on("exclusiveFailure", (error: Error) => failures.push(error));
  f.keyboard.start(["first", "media"], { exclusive: true });
  f.setReadError();
  f.setChanged();
  f.callbacks.get(100)?.();
  assert.equal(failures.length, 1);
  assert.equal(f.live.size, 0);
  assert.equal(f.grabs.size, 0);
  assert.equal(f.callbacks.size, 0);
  assert.deepEqual(f.keyboard.openedDevices, []);
  cases++;
}
{
  const f = fixture();
  f.keyboard.start(["first"], { requireEscape: true });
  assert.equal(f.grabs.size, 0, "boot guardian/default readers remain nonexclusive");
  assert(!f.events.some((event) => event.startsWith("grab:")));
  f.keyboard.stop();
  assert.equal(f.live.size, 0);
  cases++;
}
process.stdout.write(JSON.stringify({ test: "keyboard-grab", cases, nativeDevices: 0 }) + "\n");
