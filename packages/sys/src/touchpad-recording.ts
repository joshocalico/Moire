/**
 * Touchpad recordings in the evemu text format, so a stream captured on real hardware (with
 * `touchpad-record.ts`, or `evemu-record` on any Linux machine) replays through the same
 * decoder and gesture machine the compositor uses.
 *
 *   N: <device name>
 *   P: <INPUT_PROP_* bitmap bytes, hex>
 *   B: <event type, hex> <capability bitmap bytes, hex>   (repeated lines append)
 *   A: <abs code, hex> <min> <max> <fuzz> <flat> <resolution>
 *   E: <seconds.microseconds> <type, hex> <code, hex> <value>
 *
 * Moire adds one line kind evemu ignores as a comment, for disable-while-typing:
 *
 *   # K: <seconds.microseconds> <key code> <value>
 */
import {
  EV_ABS,
  EV_KEY,
  touchpadGeometryFrom,
  TouchpadDecoder,
  type AbsInfo,
  type EvdevCapabilities,
  type TouchpadGeometry,
} from "./touchpad-device";
import { TouchpadGestures, type TouchpadOptions, type TouchpadOutput } from "./touchpad-gesture";

export type RecordedEvent = { timeMs: number; type: number; code: number; value: number };
export type RecordedKey = { timeMs: number; code: number; value: number };

export type TouchpadRecording = {
  name: string;
  capabilities: EvdevCapabilities;
  events: RecordedEvent[];
  keys: RecordedKey[];
};

function hexBytes(fields: readonly string[]): number[] {
  return fields.map((field) => {
    const byte = Number.parseInt(field, 16);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error(`Bad byte ${field}`);
    return byte;
  });
}

function seconds(field: string): number {
  const value = Number(field);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Bad timestamp ${field}`);
  return Math.round(value * 1e6) / 1e3;
}

export function parseTouchpadRecording(text: string): TouchpadRecording {
  let name = "";
  const props: number[] = [];
  const bits = new Map<number, number[]>();
  const absInfo = new Map<number, AbsInfo>();
  const events: RecordedEvent[] = [];
  const keys: RecordedKey[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const fail = (why: string) => {
      throw new Error(`Recording line ${index + 1}: ${why}`);
    };
    const key = /^#\s*K:\s+(\S+)\s+(\d+)\s+(-?\d+)/.exec(line);
    if (key) {
      keys.push({ timeMs: seconds(key[1]!), code: Number(key[2]), value: Number(key[3]) });
      return;
    }
    if (!line || line.startsWith("#")) return;
    const [kind, ...fields] = line.split(/\s+/);
    switch (kind) {
      case "N:":
        name = line.slice(2).trim();
        return;
      case "I:":
        return;
      case "P:":
        props.push(...hexBytes(fields));
        return;
      case "B:": {
        const type = Number.parseInt(fields[0] ?? "", 16);
        if (!Number.isInteger(type)) fail("bad bitmap type");
        bits.set(type, [...(bits.get(type) ?? []), ...hexBytes(fields.slice(1))]);
        return;
      }
      case "A:": {
        const [code, min, max, , , res] = fields;
        if (code === undefined || max === undefined) fail("short absinfo");
        absInfo.set(Number.parseInt(code!, 16), {
          minimum: Number(min),
          maximum: Number(max),
          resolution: Number(res ?? 0),
        });
        return;
      }
      case "E:": {
        const [time, type, code, value] = fields;
        if (value === undefined) fail("short event");
        events.push({
          timeMs: seconds(time!),
          type: Number.parseInt(type!, 16),
          code: Number.parseInt(code!, 16),
          value: Number(value),
        });
        return;
      }
      default:
        fail(`unknown line ${kind}`);
    }
  });
  const buffer = (values: readonly number[], size: number) => {
    const out = Buffer.alloc(Math.max(size, values.length));
    Buffer.from(values).copy(out);
    return out;
  };
  return {
    name,
    capabilities: {
      props: buffer(props, 4),
      absBits: buffer(bits.get(EV_ABS) ?? [], 8),
      keyBits: buffer(bits.get(EV_KEY) ?? [], 96),
      absInfo,
    },
    events,
    keys,
  };
}

const hex = (value: number, width: number) => value.toString(16).padStart(width, "0");
const stamp = (timeMs: number) => (timeMs / 1000).toFixed(6);

export function formatTouchpadRecording(recording: TouchpadRecording): string {
  const { capabilities: caps } = recording;
  const bytes = (buffer: Uint8Array) => [...buffer].map((byte) => hex(byte, 2)).join(" ");
  const lines = [
    "# EVEMU 1.3",
    `N: ${recording.name}`,
    `P: ${bytes(caps.props)}`,
    `B: ${hex(EV_KEY, 2)} ${bytes(caps.keyBits)}`,
    `B: ${hex(EV_ABS, 2)} ${bytes(caps.absBits)}`,
    ...[...caps.absInfo].map(
      ([code, info]) =>
        `A: ${hex(code, 2)} ${info.minimum} ${info.maximum} 0 0 ${info.resolution}`,
    ),
  ];
  // Keys interleave with events by time so a reader sees the order they happened in.
  const merged = [
    ...recording.events.map((event) => ({
      timeMs: event.timeMs,
      line: `E: ${stamp(event.timeMs)} ${hex(event.type, 4)} ${hex(event.code, 4)} ${event.value}`,
    })),
    ...recording.keys.map((key) => ({
      timeMs: key.timeMs,
      line: `# K: ${stamp(key.timeMs)} ${key.code} ${key.value}`,
    })),
  ].sort((a, b) => a.timeMs - b.timeMs);
  return [...lines, ...merged.map((entry) => entry.line), ""].join("\n");
}

export function recordingGeometry(recording: TouchpadRecording): TouchpadGeometry {
  const caps = recording.capabilities;
  const geometry = touchpadGeometryFrom({
    ...caps,
    abs: (code) => caps.absInfo.get(code) ?? null,
  });
  if (!geometry) throw new Error(`${recording.name || "Recording"} is not a touchpad`);
  return geometry;
}

/** Bound on timer runs after the last event, so a bug can't loop a smoke forever. */
const MAX_TRAILING_TICKS = 1000;

/**
 * Replay through decoder and gestures with a virtual clock: timers fire at their deadlines
 * between events, and after the last event until nothing is pending.
 */
export function replayTouchpadRecording(
  recording: TouchpadRecording,
  options: Partial<TouchpadOptions> = {},
): TouchpadOutput[] {
  const geometry = recordingGeometry(recording);
  const decoder = new TouchpadDecoder(geometry);
  const gestures = new TouchpadGestures(geometry, options);
  const out: TouchpadOutput[] = [];
  const runTimers = (until: number) => {
    for (let deadline = gestures.deadline(); deadline !== null && deadline <= until; ) {
      out.push(...gestures.tick(deadline));
      const next = gestures.deadline();
      if (next === deadline) break;
      deadline = next;
    }
  };
  const keys = [...recording.keys];
  for (const event of recording.events) {
    while (keys.length && keys[0]!.timeMs <= event.timeMs) {
      const key = keys.shift()!;
      runTimers(key.timeMs);
      gestures.key(key.code, key.value, key.timeMs);
    }
    runTimers(event.timeMs);
    const frame = decoder.push(event.type, event.code, event.value, event.timeMs);
    if (frame) out.push(...gestures.frame(frame));
  }
  for (let ticks = 0; ticks < MAX_TRAILING_TICKS; ticks++) {
    const deadline = gestures.deadline();
    if (deadline === null) break;
    out.push(...gestures.tick(deadline));
  }
  return out;
}
