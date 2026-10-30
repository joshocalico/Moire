/**
 * Moire's small sound API over libpipewire streams (`@moire/sys`): play a WAV or PCM, meter or
 * record the default input, and the notification alert player. Failures come back as values; nothing here
 * throws for a missing PipeWire.
 */
import fs from "node:fs/promises";
import { openPipeWireStream, type PipeWireStream } from "@moire/sys";
import { ALERT_SOUND_PATH } from "./alert";
import { encodePod, P, type Pod } from "./pod";
import {
  SpaAudioFormat,
  SpaChannel,
  SpaFormat,
  SpaMediaSubtype,
  SpaMediaType,
  SpaObjectType,
  SpaParam,
} from "./spa";
import { decodeWav, durationMs, MAX_WAV_BYTES, WavError, type Pcm } from "./wav";

export type StreamOpener = typeof openPipeWireStream;

export type PlayResult =
  | { readonly kind: "played" }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export type PlayOptions = {
  /** Slider volume 0..1 (cubic, like the volume controls); default 1. */
  volume?: number;
  /** WirePlumber's routing role; default "notification". */
  role?: "notification" | "event";
  /** The stream's `node.name`; default "moire-alert". */
  name?: string;
  signal?: AbortSignal;
  open?: StreamOpener;
};

const POLL_MS = 10;
/** A stream that hasn't started moving audio by now isn't going to. */
const START_TIMEOUT_MS = 2000;
/** After the ring empties PipeWire still holds about one quantum; let it play out. */
const TAIL_MS = 80;
const RING_SECONDS = 1;

const POSITIONS: Readonly<Record<number, readonly number[]>> = {
  1: [SpaChannel.MONO],
  2: [SpaChannel.FL, SpaChannel.FR],
  4: [SpaChannel.FL, SpaChannel.FR, SpaChannel.RL, SpaChannel.RR],
  6: [SpaChannel.FL, SpaChannel.FR, SpaChannel.FC, SpaChannel.LFE, SpaChannel.RL, SpaChannel.RR],
  8: [
    SpaChannel.FL,
    SpaChannel.FR,
    SpaChannel.FC,
    SpaChannel.LFE,
    SpaChannel.RL,
    SpaChannel.RR,
    SpaChannel.SL,
    SpaChannel.SR,
  ],
};

/** `EnumFormat` for interleaved F32 at a fixed rate and channel count. */
export function audioFormatPod(rate: number, channels: number): Pod {
  const positions = POSITIONS[channels];
  return P.object(SpaObjectType.Format, SpaParam.EnumFormat, {
    [SpaFormat.mediaType]: P.id(SpaMediaType.audio),
    [SpaFormat.mediaSubtype]: P.id(SpaMediaSubtype.raw),
    [SpaFormat.audioFormat]: P.id(SpaAudioFormat.F32LE),
    [SpaFormat.audioRate]: P.int(rate),
    [SpaFormat.audioChannels]: P.int(channels),
    ...(positions ? { [SpaFormat.audioPosition]: P.ids(positions) } : {}),
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadPcm(source: { path: string } | { pcm: Pcm }): Promise<Pcm> {
  if ("pcm" in source) return source.pcm;
  const handle = await fs.open(source.path, "r");
  try {
    const { size } = await handle.stat();
    if (size > MAX_WAV_BYTES) throw new WavError("The sound file is too large.");
    return decodeWav(await handle.readFile());
  } finally {
    await handle.close();
  }
}

/** Play a WAV file or PCM once, to the default output, and resolve when it has played. */
export async function playSound(
  source: { path: string } | { pcm: Pcm },
  options: PlayOptions = {},
): Promise<PlayResult> {
  let pcm: Pcm;
  try {
    pcm = await loadPcm(source);
  } catch (error) {
    return {
      kind: "error",
      message: `Can't read the sound: ${(error as Error).message}`.slice(0, 512),
    };
  }
  const volume = options.volume ?? 1;
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    return { kind: "error", message: "Volume must be between 0 and 1." };
  if (!pcm.samples.length) return { kind: "played" };
  const gain = volume ** 3;
  const samples = gain === 1 ? pcm.samples : pcm.samples.map((sample) => sample * gain);
  const opened = (options.open ?? openPipeWireStream)({
    direction: "playback",
    name: options.name ?? "moire-alert",
    properties: {
      "media.type": "Audio",
      "media.category": "Playback",
      "media.role": options.role === "event" ? "Event" : "Notification",
      "application.name": "Moire",
      "node.name": options.name ?? "moire-alert",
      "node.description": "Moire alert",
    },
    format: encodePod(audioFormatPod(pcm.rate, pcm.channels)),
    channels: pcm.channels,
    ringBytes: pcm.rate * pcm.channels * 4 * RING_SECONDS,
  });
  if (opened.kind !== "ok") return opened;
  const stream = opened.stream;
  try {
    return await pump(stream, samples, pcm, options.signal);
  } finally {
    stream.close();
  }
}

async function pump(
  stream: PipeWireStream,
  samples: Float32Array,
  pcm: Pcm,
  signal?: AbortSignal,
): Promise<PlayResult> {
  const deadline = performance.now() + durationMs(pcm) + START_TIMEOUT_MS + 1000;
  let offset = 0;
  let startedBy = performance.now() + START_TIMEOUT_MS;
  for (;;) {
    if (signal?.aborted) return { kind: "error", message: "Playback cancelled." };
    const { state, error } = stream.state();
    if (state === "error")
      return { kind: "error", message: `PipeWire stopped the sound${error ? `: ${error}` : "."}` };
    if (offset < samples.length) offset += stream.write(samples.subarray(offset)) * pcm.channels;
    if (offset >= samples.length) {
      stream.finish();
      if (stream.bufferedFrames === 0) break;
    }
    const now = performance.now();
    if (stream.counters().frames > 0) startedBy = Infinity;
    if (now > startedBy)
      return { kind: "error", message: "PipeWire didn't start playing the sound." };
    if (now > deadline) return { kind: "error", message: "The sound didn't finish playing." };
    await sleep(POLL_MS);
  }
  await sleep(TAIL_MS);
  return { kind: "played" };
}

export type Levels = { readonly peak: number; readonly rms: number };

export type LevelRecording = { stop(): void };

export type RecordLevelsResult =
  | { readonly kind: "recording"; readonly recording: LevelRecording }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const METER_RATE = 16000;

/**
 * Meter the default input: peak and RMS every `intervalMs`. Only levels leave this function, never
 * audio. `onEnd` hears about a stream PipeWire stops; `stop()` is silent.
 */
export function recordLevels(options: {
  onLevels: (levels: Levels) => void;
  onEnd?: (message: string) => void;
  intervalMs?: number;
  open?: StreamOpener;
}): RecordLevelsResult {
  const opened = (options.open ?? openPipeWireStream)({
    direction: "capture",
    name: "moire-input-meter",
    properties: {
      "media.type": "Audio",
      "media.category": "Capture",
      "media.role": "Production",
      "application.name": "Moire",
      "node.name": "moire-input-meter",
      "node.description": "Moire input level",
    },
    format: encodePod(audioFormatPod(METER_RATE, 1)),
    channels: 1,
    ringBytes: 0,
  });
  if (opened.kind !== "ok") return opened;
  const stream = opened.stream;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream.close();
  };
  const timer = setInterval(() => {
    const { state, error } = stream.state();
    if (state === "error") {
      stop();
      options.onEnd?.(`PipeWire stopped the input${error ? `: ${error}` : "."}`);
      return;
    }
    const { peak, rms } = stream.takeLevels();
    options.onLevels({ peak: Math.min(1, peak), rms: Math.min(1, rms) });
  }, options.intervalMs ?? 100);
  timer.unref?.();
  return { kind: "recording", recording: { stop } };
}

export type CaptureEnd = { readonly frames: number; readonly overruns: number };

export type StreamRecording = {
  /** Deliver what is still in the ring, close the stream, and say how much was captured. */
  stop(): CaptureEnd;
};

export type RecordStreamResult =
  | { readonly kind: "recording"; readonly recording: StreamRecording }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/**
 * The ring holds this much audio, so the JS event loop may stall this long between drains before
 * PipeWire's buffers start being dropped (counted as overruns).
 */
const CAPTURE_RING_SECONDS = 2;
const MAX_CAPTURE_RATE = 192000;

/**
 * Capture audio: interleaved F32 at `rate` and `channels` from the default source (or the node
 * named `target`). Every `intervalMs` the ring is drained into `onChunk` (a view that is only valid
 * during the call) and the stretch's levels go to `onLevels`. `onEnd` hears about a stream
 * PipeWire stops or one that never delivers audio; `stop()` is silent and hands over whatever is
 * still buffered first.
 */
export function recordStream(options: {
  onChunk: (samples: Float32Array) => void;
  onLevels?: (levels: Levels) => void;
  onEnd?: (message: string) => void;
  rate?: number;
  channels?: number;
  target?: string;
  name?: string;
  intervalMs?: number;
  open?: StreamOpener;
}): RecordStreamResult {
  const rate = options.rate ?? 48000;
  const channels = options.channels ?? 2;
  if (!Number.isInteger(rate) || rate < 8000 || rate > MAX_CAPTURE_RATE)
    return { kind: "error", message: "The recording rate is out of range." };
  if (!Number.isInteger(channels) || channels < 1 || channels > 8)
    return { kind: "error", message: "A recording has 1 to 8 channels." };
  const name = options.name ?? "moire-recorder";
  const opened = (options.open ?? openPipeWireStream)({
    direction: "capture",
    name,
    properties: {
      "media.type": "Audio",
      "media.category": "Capture",
      "media.role": "Production",
      "application.name": "Moire",
      "node.name": name,
      "node.description": "Moire recording",
      ...(options.target ? { "target.object": options.target } : {}),
    },
    format: encodePod(audioFormatPod(rate, channels)),
    channels,
    ringBytes: rate * channels * 4 * CAPTURE_RING_SECONDS,
  });
  if (opened.kind !== "ok") return opened;
  const stream = opened.stream;
  // Reused for every drain; a drain loops until the ring is empty.
  const scratch = new Float32Array(Math.ceil(rate * 0.25) * channels);
  let ended: CaptureEnd | null = null;
  let startedBy = performance.now() + START_TIMEOUT_MS;
  const drain = () => {
    for (let frames = stream.read(scratch); frames > 0; frames = stream.read(scratch))
      options.onChunk(scratch.subarray(0, frames * channels));
  };
  const close = (): CaptureEnd => {
    if (ended) return ended;
    clearInterval(timer);
    const { frames, overruns } = stream.counters();
    stream.close();
    ended = { frames, overruns };
    return ended;
  };
  const timer = setInterval(() => {
    if (ended) return;
    const { state, error } = stream.state();
    drain();
    if (state === "error") {
      close();
      options.onEnd?.(`PipeWire stopped the recording${error ? `: ${error}` : "."}`);
      return;
    }
    const { peak, rms } = stream.takeLevels();
    options.onLevels?.({ peak: Math.min(1, peak), rms: Math.min(1, rms) });
    if (stream.counters().frames > 0) startedBy = Infinity;
    else if (performance.now() > startedBy) {
      close();
      options.onEnd?.("No audio arrived from the input. Check the input device.");
    }
  }, options.intervalMs ?? 100);
  return {
    kind: "recording",
    recording: {
      stop() {
        if (!ended) drain();
        return close();
      },
    },
  };
}

/**
 * The notification alert: plays `assets/alert.wav`, one at a time and at most once per
 * `minGapMs`, so a burst of notifications is one chime. Failures go to `onError` once each.
 */
export function createAlertPlayer(
  options: {
    play?: (source: { path: string }) => Promise<PlayResult>;
    onError?: (message: string) => void;
    minGapMs?: number;
    now?: () => number;
  } = {},
) {
  const play = options.play ?? ((source) => playSound(source, { role: "notification" }));
  const minGap = options.minGapMs ?? 250;
  const now = options.now ?? Date.now;
  let playing = false;
  let last = -Infinity;
  let lastError = "";
  return {
    /** True when a chime was started. */
    play(): boolean {
      const at = now();
      if (playing || at - last < minGap) return false;
      playing = true;
      last = at;
      void play({ path: ALERT_SOUND_PATH })
        .then((result) => {
          if (result.kind !== "played" && result.message !== lastError) {
            lastError = result.message;
            options.onError?.(result.message);
          }
        })
        .finally(() => {
          playing = false;
        });
      return true;
    },
  };
}
