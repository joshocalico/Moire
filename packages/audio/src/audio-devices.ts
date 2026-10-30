/**
 * Sound devices and app streams for Settings › Sound: outputs and inputs with the defaults
 * marked, the default input's volume and mute, and the volume and mute of each app playing.
 * Moved from `@moire/prefs` with its API; it now reads PipeWire over the native protocol.
 *
 * Every change re-reads, checks its target is still there, writes once and reads back, so a change
 * is never made against a stale list and what is published is PipeWire's own readback.
 */
import { AudioControl, type AudioNode, type AudioSnapshot } from "./control";
import { PipeWireError } from "./connection";

export type AudioBackend = "pipewire";

/** A device or stream: its PipeWire node id. */
export type AudioDevice = {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
};

/** The default input's level controls. */
export type AudioInput = {
  readonly id: string;
  readonly volume: number;
  readonly muted: boolean;
};

/** An app that is playing sound. */
export type AudioStream = {
  readonly id: string;
  /** The app's name. */
  readonly app: string;
  /** What it is playing, when the app says ("YouTube", "Notification"); may be empty. */
  readonly title: string;
  readonly volume: number;
  readonly muted: boolean;
};

export type AudioDevicesReady = {
  readonly kind: "ready";
  readonly backend: AudioBackend;
  readonly outputs: readonly AudioDevice[];
  readonly inputs: readonly AudioDevice[];
  readonly input: AudioInput | null;
  readonly streams: readonly AudioStream[];
};

export type AudioDevicesStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | AudioDevicesReady;

export type AudioDevicesAdapter = {
  readonly state: AudioDevicesStatus;
  subscribe(listener: (state: AudioDevicesStatus) => void): () => void;
  refresh(signal?: AbortSignal): Promise<AudioDevicesStatus>;
  /** Make a listed output or input the default. */
  setDefault(kind: "output" | "input", id: string): Promise<AudioDevicesStatus>;
  setInputVolume(volume: number): Promise<AudioDevicesStatus>;
  setInputMute(muted: boolean): Promise<AudioDevicesStatus>;
  setStreamVolume(id: string, volume: number): Promise<AudioDevicesStatus>;
  setStreamMute(id: string, muted: boolean): Promise<AudioDevicesStatus>;
  dispose(): void;
};

/** Lists longer than this are cut; nobody has more devices or playing apps than fit a page. */
export const MAX_AUDIO_ITEMS = 32;
const MAX_NAME = 256;

class DevicesFailure extends Error {
  constructor(
    readonly status: Exclude<AudioDevicesStatus, AudioDevicesReady | { kind: "loading" }>,
  ) {
    super(status.message);
  }
}

const fail = (message: string): never => {
  throw new DevicesFailure({ kind: "error", message });
};

/** Names shown to people: control characters dropped, length bounded. */
function cleanName(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const cleaned = [...value]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, MAX_NAME);
  return cleaned || fallback;
}

function checkVolume(volume: number): void {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) fail("Volume must be between 0 and 1.");
}

/** The adapter's view of a snapshot. */
export function devicesFromSnapshot(snapshot: AudioSnapshot): AudioDevicesReady {
  const device = (node: AudioNode, current: string | null, fallback: string): AudioDevice => ({
    id: String(node.id),
    name: cleanName(node.description, `${fallback} ${node.id}`),
    isDefault: node.name === current,
  });
  const sinks = snapshot.nodes.filter((node) => node.kind === "sink");
  const sources = snapshot.nodes.filter((node) => node.kind === "source");
  const source = sources.find((node) => node.name === snapshot.defaultSource);
  const streams = snapshot.nodes.flatMap((node): AudioStream[] => {
    // Recording streams (a meter, a call's microphone) aren't app volumes.
    if (node.kind !== "playback" || node.volume === null) return [];
    const app = cleanName(node.app ?? node.description, `App ${node.id}`);
    const title = cleanName(node.media, "");
    return [
      {
        id: String(node.id),
        app,
        title: title === app ? "" : title,
        volume: node.volume,
        muted: node.muted ?? false,
      },
    ];
  });
  return {
    kind: "ready",
    backend: "pipewire",
    outputs: sinks
      .map((node) => device(node, snapshot.defaultSink, "Output"))
      .slice(0, MAX_AUDIO_ITEMS),
    inputs: sources
      .map((node) => device(node, snapshot.defaultSource, "Input"))
      .slice(0, MAX_AUDIO_ITEMS),
    input:
      source && source.volume !== null
        ? { id: String(source.id), volume: source.volume, muted: source.muted ?? false }
        : null,
    streams: streams.slice(0, MAX_AUDIO_ITEMS),
  };
}

function sameStatus(a: AudioDevicesStatus, b: AudioDevicesStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `control` is shared with the status adapter in the management service; one made here is closed
 * on dispose.
 */
export function createAudioDevicesAdapter(
  options: { control?: AudioControl } = {},
): AudioDevicesAdapter {
  const control = options.control ?? new AudioControl();
  const owned = !options.control;
  let state: AudioDevicesStatus = Object.freeze({ kind: "loading" });
  let disposed = false;
  const scope = new AbortController();
  const listeners = new Set<(state: AudioDevicesStatus) => void>();
  /** Reads and changes run one at a time so a readback can't race a write. */
  let queue: Promise<unknown> = Promise.resolve();

  const publish = (next: AudioDevicesStatus): AudioDevicesStatus => {
    if (sameStatus(state, next)) return state;
    state = Object.freeze(next);
    for (const listener of listeners) listener(state);
    return state;
  };

  const asStatus = (error: unknown): AudioDevicesStatus => {
    if (error instanceof DevicesFailure) return error.status;
    if (error instanceof PipeWireError && error.kind === "unavailable")
      return { kind: "unavailable", message: error.message };
    return {
      kind: "error",
      message: error instanceof Error ? error.message.slice(0, 512) : "Audio request failed.",
    };
  };

  const read = async (signal: AbortSignal) => devicesFromSnapshot(await control.read(signal));

  /**
   * Queue work. A failed read becomes the published state; a failed change is returned, and the
   * devices are read again so the published state stays the actual one.
   */
  const operation = (
    work: (signal: AbortSignal) => Promise<AudioDevicesReady>,
    kind: "read" | "change" = "read",
  ): Promise<AudioDevicesStatus> => {
    if (disposed) return Promise.resolve({ kind: "error", message: "Audio adapter is closed." });
    const next = queue.then(async (): Promise<AudioDevicesStatus> => {
      if (disposed) return state;
      try {
        return publish(await work(scope.signal));
      } catch (error) {
        const status = asStatus(error);
        if (disposed) return state;
        if (kind === "read") return publish(status);
        try {
          publish(await read(scope.signal));
        } catch {
          // The change's own failure is the one to report.
        }
        return status;
      }
    });
    queue = next.catch(() => {});
    return next;
  };

  /** Re-read, find the target in the fresh list, write, and publish the readback. */
  const change = (
    write: (current: AudioDevicesReady, signal: AbortSignal) => Promise<AudioSnapshot>,
  ): Promise<AudioDevicesStatus> =>
    operation(
      async (signal) => devicesFromSnapshot(await write(await read(signal), signal)),
      "change",
    );

  const findDevice = (list: readonly AudioDevice[], id: string, what: string): AudioDevice =>
    list.find((item) => item.id === id) ?? fail(`That ${what} is no longer connected.`);
  const findStream = (current: AudioDevicesReady, id: string): AudioStream =>
    current.streams.find((item) => item.id === id) ?? fail("That app stopped playing.");
  const inputOf = (current: AudioDevicesReady) =>
    current.input ?? fail("There is no input device.");

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh(signal) {
      return operation((own) => read(signal ? AbortSignal.any([own, signal]) : own));
    },
    setDefault(kind, id) {
      return change((current, signal) => {
        const device = findDevice(kind === "output" ? current.outputs : current.inputs, id, kind);
        return control.setDefault(kind === "output" ? "sink" : "source", Number(device.id), signal);
      });
    },
    setInputVolume(volume) {
      return change((current, signal) => {
        checkVolume(volume);
        return control.setVolume(Number(inputOf(current).id), volume, signal);
      });
    },
    setInputMute(muted) {
      return change((current, signal) => {
        if (typeof muted !== "boolean") fail("Mute must be true or false.");
        return control.setMute(Number(inputOf(current).id), muted, signal);
      });
    },
    setStreamVolume(id, volume) {
      return change((current, signal) => {
        checkVolume(volume);
        return control.setVolume(Number(findStream(current, id).id), volume, signal);
      });
    },
    setStreamMute(id, muted) {
      return change((current, signal) => {
        if (typeof muted !== "boolean") fail("Mute must be true or false.");
        return control.setMute(Number(findStream(current, id).id), muted, signal);
      });
    },
    dispose() {
      disposed = true;
      scope.abort();
      listeners.clear();
      if (owned) control.close();
      state = Object.freeze({ kind: "error", message: "Audio adapter is closed." });
    },
  };
}
