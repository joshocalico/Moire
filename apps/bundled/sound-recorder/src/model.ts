/**
 * Sound Recorder's rules, as pure functions: what to call a take, what each recorder state says,
 * when closing must wait, and how long a WAV file plays. The window and I/O live elsewhere.
 */
import type { RecordingState } from "./backend";

/** Whether there is something to record from. */
export type InputDevice =
  | { kind: "checking" }
  | { kind: "ready"; name: string }
  | { kind: "no-device"; message: string }
  | { kind: "unavailable"; message: string };

/** A saved recording in the list. */
export type Recording = { file: string; name: string; modified: number; seconds: number | null };

const pad = (value: number) => String(value).padStart(2, "0");

/** "Recording 2026-10-10 14.03.22": sorts by time, and has no characters file systems refuse. */
export function defaultRecordingName(date: Date): string {
  return `Recording ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/** Save as names get .wav when the person leaves it off. */
export function withWavExtension(file: string): string {
  return /\.wav$/i.test(file) ? file : `${file}.wav`;
}

/** Why closing must wait, or null when the window may close. */
export function closeBlockReason(
  state: RecordingState,
  saved: boolean,
  busy: boolean,
): string | null {
  if (busy || state.kind === "starting")
    return "Close blocked: wait for the current operation, then Stop and Save or Discard take before closing.";
  if (state.kind === "recording")
    return "Close blocked: recording is active. Stop, then Save or Discard take before closing.";
  if (state.kind === "ready" && !saved)
    return "Close blocked: this take is unsaved. Save it or choose Discard take, then close.";
  return null;
}

/** The short label under the timer and the longer status line, for each state. */
export function describe(
  state: RecordingState,
  saved: string | null,
  device: InputDevice,
): { label: string; detail: string } {
  switch (state.kind) {
    case "starting":
      return { label: "Starting…", detail: "Starting the recorder…" };
    case "recording":
      return { label: "Recording", detail: `Recording from ${deviceName(device)}` };
    case "ready":
      return saved
        ? { label: "Saved", detail: `Saved to ${saved}. Record again to start a new take.` }
        : {
            label: "Take ready",
            detail: `${state.note ? `${state.note} ` : ""}${state.seconds.toFixed(1)} seconds captured. Save it, or discard it.`,
          };
    case "error":
      return { label: "Can't record", detail: state.message };
    default:
      if (device.kind === "checking")
        return { label: "Checking input…", detail: "Looking for a microphone…" };
      if (device.kind !== "ready") return { label: "Can't record", detail: device.message };
      return { label: "Ready to record", detail: `Records from ${device.name}.` };
  }
}

export function deviceName(device: InputDevice): string {
  return device.kind === "ready" ? device.name : "the default input";
}

/**
 * How long a WAV plays, from its header: the byte rate in "fmt " and the size of "data". A
 * recorder that was stopped hard may leave the data size unset, so the file size stands in.
 */
export function wavSeconds(header: Uint8Array, fileSize: number): number | null {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const tag = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
  if (header.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= header.length;) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 16 <= header.length) byteRate = view.getUint32(offset + 16, true);
    if (id === "data") {
      if (!byteRate) return null;
      const available = fileSize - offset - 8;
      const bytes = size === 0 || size === 0xffffffff || size > available ? available : size;
      return Math.max(0, bytes / byteRate);
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** The list shows newest first; files without a readable time sort last. */
export function sortRecordings(recordings: readonly Recording[]): Recording[] {
  return [...recordings].sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}
