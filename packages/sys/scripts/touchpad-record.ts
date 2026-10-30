/**
 * Record a touchpad for replay: `tsx packages/sys/scripts/touchpad-record.ts [/dev/input/eventN]
 * [seconds] > pad.evemu`. With no device it picks the first touchpad it can open. Run it on a
 * laptop (as a user in the `input` group, or root) and replay the file with
 * `parseTouchpadRecording` + `replayTouchpadRecording`, as `touchpad.smoke.ts` does.
 *
 * Capabilities come from the same EVIOCGPROP/EVIOCGBIT/EVIOCGABS reads the compositor uses; events
 * are the kernel's 24-byte `input_event` records, read with plain read(2).
 */
import fs from "node:fs";
import { readEvdevCapabilities, readTouchpadGeometry } from "../src/touchpad-device";
import { formatTouchpadRecording, type TouchpadRecording } from "../src/touchpad-recording";

const INPUT_EVENT_SIZE = 24;
const [deviceArg, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg ?? 10);

function openTouchpad(): { path: string; fd: number } {
  const candidates = deviceArg
    ? [deviceArg]
    : fs
        .readdirSync("/dev/input")
        .filter((name) => /^event\d+$/.test(name))
        .map((name) => `/dev/input/${name}`);
  for (const path of candidates) {
    let fd: number;
    try {
      fd = fs.openSync(path, fs.constants.O_RDONLY);
    } catch {
      continue;
    }
    if (deviceArg || readTouchpadGeometry(fd)) return { path, fd };
    fs.closeSync(fd);
  }
  throw new Error("No touchpad found; pass /dev/input/eventN (and check read access)");
}

const { path, fd } = openTouchpad();
const capabilities = readEvdevCapabilities(fd);
if (!capabilities) throw new Error(`${path} is not an evdev device`);
let name = path;
try {
  const sysName = `/sys/class/input/${path.split("/").pop()}/device/name`;
  name = fs.readFileSync(sysName, "utf8").trim() || path;
} catch {
  // The name is only a label in the recording.
}
const recording: TouchpadRecording = { name, capabilities, events: [], keys: [] };
process.stderr.write(`[touchpad-record] ${name} (${path}) for ${seconds} s\n`);
const buffer = Buffer.alloc(INPUT_EVENT_SIZE * 64);
const deadline = Date.now() + seconds * 1000;
let start: number | null = null;
while (Date.now() < deadline) {
  const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
  for (let offset = 0; offset + INPUT_EVENT_SIZE <= bytes; offset += INPUT_EVENT_SIZE) {
    const timeMs =
      Number(buffer.readBigInt64LE(offset)) * 1000 +
      Number(buffer.readBigInt64LE(offset + 8)) / 1000;
    start ??= timeMs;
    recording.events.push({
      timeMs: Math.max(0, timeMs - start),
      type: buffer.readUInt16LE(offset + 16),
      code: buffer.readUInt16LE(offset + 18),
      value: buffer.readInt32LE(offset + 20),
    });
  }
}
fs.closeSync(fd);
process.stdout.write(formatTouchpadRecording(recording));
