import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EvdevKeyboard } from "./evdev";
import { ioctlFd } from "./libc";
import { LinuxReadinessDispatcher } from "./readiness";

// Linux evdev.c handle_eviocgbit -> bits_to_user returns copied bytes, not zero.
// https://github.com/torvalds/linux/blob/master/drivers/input/evdev.c
const EVIOCGBIT_EV_KEY_96 = 0x80604521;
const KEY_ESC = 1;
const KEY_POWER = 116;
type Capability = { path: string; copiedBytes: number; escape: boolean; power: boolean };

function bit(bytes: Buffer, code: number): boolean {
  return (bytes[Math.floor(code / 8)]! & (1 << (code % 8))) !== 0;
}

function query(device: string): Capability | null {
  let fd: number;
  try {
    assert.ok(fs.statSync(device).isCharacterDevice(), `${device} must be a character device`);
    fd = fs.openSync(device, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch (error) {
    console.log(`[evdev-capability] inaccessible ${device}: ${String(error)}`);
    return null;
  }
  try {
    const keys = Buffer.alloc(96);
    const copiedBytes = ioctlFd(fd, EVIOCGBIT_EV_KEY_96, keys);
    assert.ok(
      copiedBytes > 0 && copiedBytes <= keys.length,
      `${device}: copied bytes=${copiedBytes}`,
    );
    assert.ok(
      ioctlFd(-1, EVIOCGBIT_EV_KEY_96, Buffer.alloc(96)) < 0,
      "an invalid descriptor reports an ioctl error",
    );
    assert.equal(
      ioctlFd(fd, 0x80004521, Buffer.alloc(1)),
      0,
      "a zero-length EVIOCGBIT query copies no capability bytes",
    );
    const capability = {
      path: device,
      copiedBytes,
      escape: bit(keys, KEY_ESC),
      power: bit(keys, KEY_POWER),
    };
    console.log(`[evdev-capability] ${JSON.stringify(capability)}`);
    return capability;
  } finally {
    fs.closeSync(fd);
  }
}

function descriptorCount(device: string): number {
  const target = fs.realpathSync(device);
  return fs.readdirSync("/proc/self/fd").filter((name) => {
    try {
      return fs.readlinkSync(`/proc/self/fd/${name}`) === target;
    } catch {
      return false; // The directory enumeration's own descriptor may already be closed.
    }
  }).length;
}

function verifyStartup(capability: Capability, readiness: LinuxReadinessDispatcher): void {
  const keyboard = new EvdevKeyboard(readiness);
  const countDescriptors = () => descriptorCount(capability.path);
  const initialDescriptors = countDescriptors();
  const deviceChanges: string[][] = [];
  keyboard.on("devicesChanged", (devices: readonly string[]) => deviceChanges.push([...devices]));
  try {
    keyboard.start([capability.path], { requireEscape: true });
    assert.deepEqual(
      keyboard.openedDevices,
      capability.escape ? [capability.path] : [],
      `production requireEscape must agree with the exact FD's capability query (${capability.copiedBytes} bytes)`,
    );
    assert.equal(countDescriptors(), initialDescriptors + (capability.escape ? 1 : 0));
    keyboard.stop();
    keyboard.stop();
    assert.deepEqual(keyboard.openedDevices, [], "stop retires all registered descriptors");
    assert.equal(countDescriptors(), initialDescriptors, "rejection/stop closes the real evdev FD");
    // A negative capability must be rejected for its bits, rather than lack of read access.
    keyboard.start([capability.path], { requireEscape: false });
    assert.deepEqual(
      keyboard.openedDevices,
      [capability.path],
      "explicit permissive startup can open this device",
    );
    assert.equal(countDescriptors(), initialDescriptors + 1);
    keyboard.stop();
    assert.equal(countDescriptors(), initialDescriptors);
    assert.deepEqual(deviceChanges, [
      capability.escape ? [capability.path] : [],
      [],
      [],
      [capability.path],
      [],
    ]);
  } finally {
    keyboard.stop();
  }
}

function verifyFailedRegistration(capability: Capability): void {
  assert.equal(capability.escape, true, "registration failure needs a verified KEY_ESC keyboard");
  const readiness = new LinuxReadinessDispatcher("evdev-stopped-registration-smoke");
  readiness.stop();
  const keyboard = new EvdevKeyboard(readiness);
  const deviceChanges: string[][] = [];
  keyboard.on("devicesChanged", (devices: readonly string[]) => deviceChanges.push([...devices]));
  const initialDescriptors = descriptorCount(capability.path);
  try {
    // KEY_ESC verification succeeds; only the real stopped dispatcher's add rejects this FD.
    for (let attempt = 0; attempt < 2; attempt++) {
      keyboard.start([capability.path], { requireEscape: true });
      assert.deepEqual(
        keyboard.openedDevices,
        [],
        "failed readiness registration cannot publish an opened keyboard",
      );
      assert.equal(
        descriptorCount(capability.path),
        initialDescriptors,
        "failed readiness registration closes its real evdev FD before stop",
      );
    }
    assert.deepEqual(deviceChanges, [[], []], "failed registration publishes no phantom devices");
    console.log(
      "[evdev-capability] PASS stopped dispatcher registration: no published keyboard or evdev FD leak",
    );
  } finally {
    keyboard.stop();
    keyboard.stop();
    readiness.stop();
  }
  assert.equal(descriptorCount(capability.path), initialDescriptors);
}

const args = process.argv.slice(2);
const requireKeyboard = args.includes("--require-keyboard");
const requireNoEscape = args.includes("--require-no-escape");
const explicit = args.filter(
  (argument) => !["--require-keyboard", "--require-no-escape"].includes(argument),
);
for (const device of explicit) {
  assert.ok(device.startsWith("/dev/input/"), "only explicit /dev/input paths are accepted");
}
if (process.platform !== "linux") {
  console.log("[evdev-capability] SKIP: Linux evdev required; no native kernel assertion executed");
  assert.ok(!requireKeyboard && !requireNoEscape, "required native checks cannot run on this host");
} else {
  let candidates = explicit;
  if (candidates.length === 0) {
    try {
      candidates = fs
        .readdirSync("/dev/input")
        .filter((name) => /^event\d+$/.test(name))
        .sort()
        .map((name) => path.join("/dev/input", name));
    } catch (error) {
      console.log(`[evdev-capability] unavailable /dev/input: ${String(error)}`);
    }
  }
  const capabilities = [...new Set(candidates)].flatMap((device) => {
    const capability = query(device);
    return capability ? [capability] : [];
  });
  const keyboard = capabilities.find((capability) => capability.escape);
  const noEscape =
    capabilities.find((capability) => !capability.escape && capability.power) ??
    capabilities.find((capability) => !capability.escape);
  assert.ok(!requireKeyboard || keyboard, "required accessible KEY_ESC keyboard not found");
  assert.ok(!requireNoEscape || noEscape, "required accessible non-KEY_ESC device not found");
  if (!keyboard) console.log("[evdev-capability] SKIP keyboard: no accessible KEY_ESC device");
  if (!noEscape) console.log("[evdev-capability] SKIP rejection: no accessible non-KEY_ESC device");
  if (keyboard || noEscape) {
    const readiness = new LinuxReadinessDispatcher("evdev-capability-smoke");
    try {
      if (keyboard) verifyStartup(keyboard, readiness);
      if (noEscape) verifyStartup(noEscape, readiness);
    } finally {
      readiness.stop();
      readiness.stop();
    }
    if (keyboard) verifyFailedRegistration(keyboard);
    // Allow the native epoll wake completion to dispose its descriptors before exit.
    await new Promise<void>((resolve) => setImmediate(resolve));
    console.log(
      `[evdev-capability] PASS native query/start/stop: keyboard=${Boolean(keyboard)} rejection=${Boolean(noEscape)}; no injection or grab`,
    );
  } else {
    console.log(
      "[evdev-capability] SKIP: no accessible devices; no native startup assertion executed",
    );
  }
}
