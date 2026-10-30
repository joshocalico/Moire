/**
 * Touchpad probing through the real koffi/libc ioctl boundary on Linux. Without input devices
 * (the nix build sandbox) it checks that a non-evdev descriptor is refused rather than misread
 * and that capability bitmaps and absinfo decode through the native path; on a machine with
 * readable /dev/input nodes it also reports each touchpad's geometry, so a VM or laptop run says
 * which devices the multitouch driver would take.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  readEvdevCapabilities,
  readTouchpadGeometry,
  touchpadGeometryFrom,
} from "../src/touchpad-device";
import { ioctlFd } from "../src/libc";
import { eviocgprop } from "../src/touchpad-device";

if (process.platform !== "linux") {
  console.log("[touchpad-native] skipped: Linux only");
  process.exit(0);
}

// A character device that isn't evdev: every query fails, nothing is guessed.
const devNull = fs.openSync("/dev/null", fs.constants.O_RDONLY);
try {
  assert.ok(ioctlFd(devNull, eviocgprop(8), Buffer.alloc(8)) < 0, "EVIOCGPROP on /dev/null fails");
  assert.equal(readEvdevCapabilities(devNull), null);
  assert.equal(readTouchpadGeometry(devNull), null);
} finally {
  fs.closeSync(devNull);
}
assert.ok(ioctlFd(-1, eviocgprop(8), Buffer.alloc(8)) < 0, "a bad descriptor reports an error");

// The pure geometry path the native reads feed: a clickpad with resolution.
const bits = (codes: number[], size: number) => {
  const buffer = Buffer.alloc(size);
  for (const code of codes) buffer[code >> 3]! |= 1 << (code & 7);
  return buffer;
};
const geometry = touchpadGeometryFrom({
  props: bits([0, 2], 8),
  absBits: bits([0x00, 0x01, 0x2f, 0x35, 0x36, 0x39], 8),
  keyBits: bits([0x110, 0x145, 0x14a, 0x14d, 0x14e], 96),
  abs: (code) =>
    code === 0x35 || code === 0x00
      ? { minimum: 0, maximum: 1200, resolution: 12 }
      : code === 0x36 || code === 0x01
        ? { minimum: 0, maximum: 800, resolution: 12 }
        : code === 0x2f
          ? { minimum: 0, maximum: 4, resolution: 0 }
          : null,
});
assert.ok(geometry, "a clickpad's capabilities make a touchpad");

let probed = 0;
const found: string[] = [];
for (const name of fs.existsSync("/dev/input") ? fs.readdirSync("/dev/input") : []) {
  if (!/^event\d+$/.test(name)) continue;
  let fd: number;
  try {
    fd = fs.openSync(`/dev/input/${name}`, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch {
    continue;
  }
  try {
    probed++;
    const pad = readTouchpadGeometry(fd);
    if (pad) found.push(`${name}: ${JSON.stringify(pad)}`);
  } finally {
    fs.closeSync(fd);
  }
}
for (const line of found) console.log(`[touchpad-native] touchpad ${line}`);
console.log(
  JSON.stringify({
    suite: "touchpad native probe",
    probedDevices: probed,
    touchpads: found.length,
  }),
);
