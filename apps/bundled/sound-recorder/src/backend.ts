import fs, { type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AudioControl,
  encodePcm16,
  MAX_WAV_DATA_BYTES,
  PipeWireError,
  recordStream,
  WAV_HEADER_BYTES,
  wavHeader,
  type AudioSnapshot,
  type StreamOpener,
  type StreamRecording,
} from "@moire/audio";
import { errorText, localPath } from "@moire/app-tools";
import { sortRecordings, wavSeconds, type InputDevice, type Recording } from "./model";
export type RecordingState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; startedAt: number }
  /** `note` says when the take is not everything that was heard (dropouts, an early end). */
  | { kind: "ready"; file: string; seconds: number; note?: string }
  | { kind: "error"; message: string };

/** Takes are 16-bit stereo WAV at 48 kHz, as pw-record made them. */
const RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SECOND = RATE * CHANNELS * 2;

export type RecorderOptions = {
  /** The stream layer; tests pass a fake. */
  open?: StreamOpener;
  /** The input's peak level, 0..1, about ten times a second while recording. */
  onLevel?: (peak: number) => void;
};

/**
 * One take at a time: a PipeWire capture stream (`recordStream`, no child process) drained into a
 * WAV file in a private temporary directory, which Save copies out.
 */
export class Recorder {
  private recording: StreamRecording | null = null;
  private handle: FileHandle | null = null;
  /** File writes, in order; a failure is kept and reported when the take is finished. */
  private writes: Promise<void> = Promise.resolve();
  private writeError: unknown = null;
  private dataBytes = 0;
  private limitNote: string | undefined;
  private directory: string | null = null;
  private file: string | null = null;
  private closed = false;
  private state: RecordingState = { kind: "idle" };
  constructor(
    private readonly change: (value: RecordingState) => void,
    private readonly options: RecorderOptions = {},
  ) {}
  private publish(value: RecordingState) {
    this.state = value;
    if (!this.closed) this.change(value);
  }
  async start(): Promise<void> {
    if (this.closed) throw new Error("The recorder has been closed.");
    if (this.recording || this.state.kind === "starting")
      throw new Error("A recording is already running.");
    this.publish({ kind: "starting" });
    try {
      await this.cleanup();
      this.directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-recording-"));
      this.file = path.join(this.directory, "recording.wav");
      this.handle = await fs.open(this.file, "wx");
      // Sizes are filled in when the take is finished.
      await this.handle.write(wavHeader(RATE, CHANNELS, 0), 0, WAV_HEADER_BYTES, 0);
      this.writes = Promise.resolve();
      this.writeError = null;
      this.dataBytes = 0;
      this.limitNote = undefined;
      const opened = recordStream({
        rate: RATE,
        channels: CHANNELS,
        name: "moire-sound-recorder",
        open: this.options.open,
        onChunk: (samples) => this.append(samples),
        onLevels: (levels) => this.options.onLevel?.(levels.peak),
        onEnd: (message) => void this.ended(message),
      });
      if (opened.kind === "unavailable")
        throw new Error(`PipeWire isn't available, so nothing can be recorded. ${opened.message}`);
      if (opened.kind === "error") throw new Error(opened.message);
      this.recording = opened.recording;
      if (this.closed) {
        await this.close();
        return;
      }
      this.publish({ kind: "recording", startedAt: Date.now() });
    } catch (error) {
      this.publish({ kind: "error", message: errorText(error) });
      await this.cleanup();
      throw error;
    }
  }
  /** Called synchronously from the stream's drain; `samples` is only valid during the call. */
  private append(samples: Float32Array) {
    const handle = this.handle;
    if (!handle || this.limitNote) return;
    let bytes = encodePcm16(samples);
    const room = MAX_WAV_DATA_BYTES - this.dataBytes;
    if (bytes.length > room) {
      bytes = bytes.subarray(0, room - (room % (CHANNELS * 2)));
      this.limitNote = "The recording stopped at the largest size a WAV file can hold.";
      // Not from inside the drain: stop() drains too.
      if (this.recording) queueMicrotask(() => void this.stop().catch(() => {}));
    }
    const at = WAV_HEADER_BYTES + this.dataBytes;
    this.dataBytes += bytes.length;
    this.writes = this.writes.then(async () => {
      if (this.writeError) return;
      try {
        await handle.write(bytes, 0, bytes.length, at);
      } catch (error) {
        this.writeError = error;
      }
    });
  }
  /** PipeWire stopped the stream: keep what was captured, if anything. */
  private async ended(message: string) {
    if (!this.recording) return;
    this.recording = null;
    try {
      await this.finish(`The recording ended early. ${message}`, 0);
    } catch (error) {
      this.publish({ kind: "error", message: errorText(error) });
    }
  }
  async stop(): Promise<void> {
    const recording = this.recording;
    if (!recording || !this.file) throw new Error("There is no active recording.");
    this.recording = null;
    try {
      const { overruns } = recording.stop();
      await this.finish(this.limitNote, overruns);
    } catch (error) {
      this.publish({ kind: "error", message: errorText(error) });
      throw error;
    }
  }
  /** Write the final header and publish the take, or why there is none. */
  private async finish(note: string | undefined, overruns: number): Promise<void> {
    const handle = this.handle;
    const file = this.file;
    if (!handle || !file) return;
    this.handle = null;
    try {
      await this.writes;
      if (this.writeError)
        throw new Error(`The recording couldn't be written: ${errorText(this.writeError)}`);
      await handle.write(wavHeader(RATE, CHANNELS, this.dataBytes), 0, WAV_HEADER_BYTES, 0);
    } finally {
      await handle.close();
    }
    if (this.dataBytes === 0) {
      this.publish({
        kind: "error",
        message: note ?? "No audio was captured. Check the input device and try again.",
      });
      return;
    }
    const dropped = overruns ? "Some audio was dropped because the system was busy." : undefined;
    const joined = [note, dropped].filter(Boolean).join(" ") || undefined;
    this.publish({
      kind: "ready",
      file,
      seconds: this.dataBytes / BYTES_PER_SECOND,
      ...(joined ? { note: joined } : {}),
    });
  }
  async save(value: string): Promise<string> {
    if (this.state.kind !== "ready")
      throw new Error("Stop a recording with captured audio before saving.");
    const destination = localPath(value);
    if (path.extname(destination).toLowerCase() !== ".wav")
      throw new Error("Save recordings with a .wav extension.");
    const directory = await fs.mkdtemp(
      path.join(path.dirname(destination), ".moire-save-recording-"),
    );
    try {
      const staged = path.join(directory, "recording.wav");
      await fs.copyFile(this.state.file, staged);
      await fs.link(staged, destination);
      return destination;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  async discard(): Promise<void> {
    if (this.recording || this.state.kind === "starting")
      throw new Error("Stop recording before discarding a take.");
    await this.cleanup();
    this.publish({ kind: "idle" });
  }
  private async cleanup(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    if (handle) {
      await this.writes;
      await handle.close();
    }
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
    this.directory = null;
    this.file = null;
  }
  async close(): Promise<void> {
    this.closed = true;
    const recording = this.recording;
    this.recording = null;
    recording?.stop();
    await this.cleanup();
  }
}

/**
 * Whether recording can work: PipeWire must have a default source, whose description names it in
 * the window. PipeWire is asked directly (`@moire/audio`); if it can't say, the default input is
 * assumed.
 */
export async function probeInput(
  options: { read?: () => Promise<AudioSnapshot> } = {},
): Promise<InputDevice> {
  let snapshot: AudioSnapshot;
  try {
    snapshot = await (options.read ?? readAudio)();
  } catch (error) {
    if (error instanceof PipeWireError && error.kind === "unavailable")
      return {
        kind: "unavailable",
        message: "PipeWire isn't running, so nothing can be recorded.",
      };
    return { kind: "ready", name: "Default input" };
  }
  const source = snapshot.nodes.find(
    (node) => node.kind === "source" && node.name === snapshot.defaultSource,
  );
  if (!source)
    return {
      kind: "no-device",
      message: "No microphone was found. Connect one, then choose Try again.",
    };
  return { kind: "ready", name: source.description || "Default input" };
}

async function readAudio(): Promise<AudioSnapshot> {
  const control = new AudioControl();
  try {
    return await control.read();
  } finally {
    control.close();
  }
}

/** WAV recordings in `folder`, plus other saved files still on disk, with their lengths. */
export async function listRecordings(
  folder: string,
  others: readonly string[] = [],
): Promise<Recording[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(folder)).filter((name) => /\.wav$/i.test(name));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const files = [...new Set([...names.map((name) => path.join(folder, name)), ...others])];
  const recordings: Recording[] = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;
      const handle = await fs.open(file, "r");
      try {
        const header = Buffer.alloc(LIST_HEADER_BYTES);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        recordings.push({
          file,
          name: path.basename(file),
          modified: stat.mtimeMs,
          seconds: wavSeconds(header.subarray(0, bytesRead), stat.size),
        });
      } finally {
        await handle.close();
      }
    } catch {
      // A recording removed or unreadable since it was listed is simply not shown.
    }
  }
  return sortRecordings(recordings);
}

/** Enough of a WAV file to find its "fmt " and "data" chunks past any metadata chunks. */
const LIST_HEADER_BYTES = 4096;
