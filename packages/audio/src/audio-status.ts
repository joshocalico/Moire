/**
 * The default output's volume and mute, for Quick Settings and the volume keys. Each operation
 * re-resolves the default from PipeWire; a write is refused if the default changed since the
 * caller's snapshot, and what is published is always PipeWire's readback. Failures are states.
 * Moved from `@moire/prefs` with its API; it now speaks the native protocol (`AudioControl`)
 * instead of running `wpctl`/`pactl`.
 */
import { AudioControl, type AudioSnapshot } from "./control";
import { PipeWireError } from "./connection";

export type AudioSink = {
  readonly backend: "pipewire";
  /** The PipeWire node id. */
  readonly id: string;
  /** Id, serial and name: a different node is never mistaken for this one. */
  readonly identity: string;
  readonly name: string;
  readonly description: string | null;
};
export type AudioReady = {
  readonly kind: "ready";
  readonly sink: AudioSink;
  /** Actual readback (slider scale, loudest channel); can exceed 1. */
  readonly volume: number;
  readonly muted: boolean;
};
export type AudioStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | AudioReady
  | {
      readonly kind: "error";
      readonly reason:
        | "command"
        | "invalid-output"
        | "cancelled"
        | "stale"
        | "default-changed"
        | "invalid-value"
        | "disposed";
      readonly message: string;
    };

export type AudioStatusAdapter = {
  readonly state: AudioStatus;
  subscribe(listener: (state: AudioStatus) => void): () => void;
  refresh(signal?: AbortSignal): Promise<AudioStatus>;
  setVolume(expected: AudioReady, volume: number, signal?: AbortSignal): Promise<AudioStatus>;
  setMute(expected: AudioReady, muted: boolean, signal?: AbortSignal): Promise<AudioStatus>;
  dispose(): void;
};

type Failure = Exclude<AudioStatus, AudioReady | { kind: "loading" }>;

class AudioFailure extends Error {
  constructor(readonly status: Failure) {
    super(status.message);
  }
}

function failure(error: unknown): Failure {
  if (error instanceof AudioFailure) return error.status;
  if (error instanceof PipeWireError) {
    if (error.kind === "unavailable") return { kind: "unavailable", message: error.message };
    return {
      kind: "error",
      reason: error.kind === "cancelled" ? "cancelled" : "command",
      message: error.message.slice(0, 512),
    };
  }
  return {
    kind: "error",
    reason: "command",
    message: error instanceof Error ? error.message.slice(0, 512) : "Audio request failed.",
  };
}

function changed(): never {
  throw new AudioFailure({
    kind: "error",
    reason: "default-changed",
    message: "The default audio output changed. Refresh before adjusting it.",
  });
}

function sameSink(a: AudioSink, b: AudioSink): boolean {
  return a.identity === b.identity;
}

function sameStatus(a: AudioStatus, b: AudioStatus): boolean {
  switch (a.kind) {
    case "loading":
      return b.kind === "loading";
    case "unavailable":
      return b.kind === "unavailable" && a.message === b.message;
    case "error":
      return b.kind === "error" && a.reason === b.reason && a.message === b.message;
    case "ready":
      return (
        b.kind === "ready" &&
        a.volume === b.volume &&
        a.muted === b.muted &&
        a.sink.identity === b.sink.identity &&
        a.sink.name === b.sink.name &&
        a.sink.description === b.sink.description
      );
  }
}

/** The default output in a snapshot, as a ready state. */
export function defaultOutput(snapshot: AudioSnapshot): AudioReady {
  if (!snapshot.hasDefaults)
    throw new AudioFailure({
      kind: "unavailable",
      message: "No session manager (WirePlumber) is choosing a default output.",
    });
  const node = snapshot.nodes.find(
    (item) => item.kind === "sink" && item.name === snapshot.defaultSink,
  );
  if (!node) throw new AudioFailure({ kind: "unavailable", message: "There is no sound output." });
  if (node.volume === null || node.muted === null || !Number.isFinite(node.volume))
    throw new AudioFailure({
      kind: "error",
      reason: "invalid-output",
      message: "The default output reports no volume.",
    });
  return {
    kind: "ready",
    sink: Object.freeze({
      backend: "pipewire",
      id: String(node.id),
      identity: `${node.id}:${node.serial}:${node.name}`,
      name: node.name,
      description: node.description === node.name ? null : node.description,
    }),
    volume: node.volume,
    muted: node.muted,
  };
}

/**
 * `control` is shared with the devices adapter in the management service; one made here is
 * closed on dispose.
 */
export function createAudioStatusAdapter(
  options: { control?: AudioControl } = {},
): AudioStatusAdapter {
  const control = options.control ?? new AudioControl();
  const owned = !options.control;
  let state: AudioStatus = Object.freeze({ kind: "loading" });
  let active: AbortController | null = null;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<(state: AudioStatus) => void>();
  const publish = (next: AudioStatus): AudioStatus => {
    if (sameStatus(state, next)) return state;
    state = Object.freeze(next);
    for (const listener of listeners) listener(state);
    return state;
  };
  const operation = async (
    kind: "refresh" | "change",
    work: (signal: AbortSignal) => Promise<AudioReady>,
    signal?: AbortSignal,
  ): Promise<AudioStatus> => {
    if (disposed) return { kind: "error", reason: "disposed", message: "Audio adapter is closed." };
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const token = ++generation;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    // A background read keeps the last observation until its result differs; a write revokes
    // the ready snapshot while its outcome is pending.
    if (kind === "change") publish({ kind: "loading" });
    try {
      const next = await work(controller.signal);
      if (controller.signal.aborted)
        throw new PipeWireError("cancelled", "Audio request cancelled.");
      return token === generation ? publish(next) : state;
    } catch (error) {
      return token === generation ? publish(failure(error)) : state;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (token === generation) active = null;
    }
  };
  const change = (
    expected: AudioReady,
    write: (nodeId: number, signal: AbortSignal) => Promise<AudioSnapshot>,
    signal?: AbortSignal,
  ): Promise<AudioStatus> => {
    if (disposed)
      return Promise.resolve({
        kind: "error",
        reason: "disposed",
        message: "Audio adapter is closed.",
      });
    if (state !== expected)
      return Promise.resolve({
        kind: "error",
        reason: "stale",
        message: "Audio controls changed. Refresh before adjusting them.",
      });
    return operation(
      "change",
      async (requestSignal) => {
        const current = defaultOutput(await control.read(requestSignal));
        if (!sameSink(current.sink, expected.sink)) changed();
        const actual = defaultOutput(await write(Number(current.sink.id), requestSignal));
        if (!sameSink(current.sink, actual.sink)) changed();
        return actual;
      },
      signal,
    );
  };
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh(signal) {
      return operation(
        "refresh",
        async (requestSignal) => defaultOutput(await control.read(requestSignal)),
        signal,
      );
    },
    setVolume(expected, volume, signal) {
      if (!Number.isFinite(volume) || volume < 0 || volume > 1)
        return Promise.resolve({
          kind: "error",
          reason: "invalid-value",
          message: "Volume must be between 0 and 1.",
        });
      return change(
        expected,
        (id, requestSignal) => control.setVolume(id, volume, requestSignal),
        signal,
      );
    },
    setMute(expected, muted, signal) {
      if (typeof muted !== "boolean")
        return Promise.resolve({
          kind: "error",
          reason: "invalid-value",
          message: "Mute must be true or false.",
        });
      return change(
        expected,
        (id, requestSignal) => control.setMute(id, muted, requestSignal),
        signal,
      );
    },
    dispose() {
      disposed = true;
      ++generation;
      active?.abort();
      active = null;
      listeners.clear();
      if (owned) control.close();
      state = Object.freeze({
        kind: "error",
        reason: "disposed",
        message: "Audio adapter is closed.",
      });
    },
  };
}
