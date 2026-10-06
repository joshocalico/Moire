import { execFile } from "node:child_process";

export type AudioCommandResult =
  | { kind: "ok"; stdout: string }
  | { kind: "missing" }
  | { kind: "failed"; message: string; exitCode: number | null }
  | { kind: "cancelled" }
  | { kind: "timeout" }
  | { kind: "output-limit" };

export type AudioCommandExecutor = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<AudioCommandResult>;

/** No shell, inherited session credentials/environment, bounded child lifetime/output. */
export const executeAudioCommand: AudioCommandExecutor = (command, args, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ kind: "cancelled" });
      return;
    }
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        timeout: 1500,
        maxBuffer: 64 * 1024,
        killSignal: "SIGKILL",
        signal,
      },
      (error, stdout, stderr) => {
        if (signal.aborted) resolve({ kind: "cancelled" });
        else if (!error) resolve({ kind: "ok", stdout });
        else if (error.code === "ENOENT") resolve({ kind: "missing" });
        else if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
          resolve({ kind: "output-limit" });
        else if (error.killed) resolve({ kind: "timeout" });
        else
          resolve({
            kind: "failed",
            exitCode: typeof error.code === "number" ? error.code : null,
            message: (stderr.trim() || error.message).slice(0, 512),
          });
      },
    );
  });

export type AudioSink = {
  readonly backend: "wpctl" | "pactl";
  readonly id: string;
  readonly identity: string;
  readonly name: string;
  readonly description: string | null;
};
export type AudioReady = {
  readonly kind: "ready";
  readonly sink: AudioSink;
  /** Actual readback; can exceed 1. Pactl reports the largest observed channel. */
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

class AudioFailure extends Error {
  constructor(readonly status: Exclude<AudioStatus, AudioReady | { kind: "loading" }>) {
    super(status.message);
  }
}

function invalid(message: string): never {
  throw new AudioFailure({ kind: "error", reason: "invalid-output", message });
}

function changed(): never {
  throw new AudioFailure({
    kind: "error",
    reason: "default-changed",
    message: "The default audio output changed. Refresh before adjusting it.",
  });
}

function sameSink(a: AudioSink, b: AudioSink): boolean {
  return a.backend === b.backend && a.identity === b.identity;
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
        a.sink.backend === b.sink.backend &&
        a.sink.id === b.sink.id &&
        a.sink.identity === b.sink.identity &&
        a.sink.name === b.sink.name &&
        a.sink.description === b.sink.description
      );
  }
}

function property(text: string, key: string): string | null {
  const lines = text.split("\n").filter((entry) =>
    entry
      .trim()
      .replace(/^\*\s*/, "")
      .startsWith(`${key} = `),
  );
  if (lines.length > 1) invalid(`Ambiguous wpctl ${key}.`);
  const line = lines[0];
  if (!line) return null;
  const value = line.slice(line.indexOf(" = ") + 3).trim();
  if (!value.startsWith('"') || !value.endsWith('"')) return invalid(`Invalid wpctl ${key}.`);
  // wpctl prints properties as quoted strings, not JSON string literals.
  return value.slice(1, -1);
}

/** Each operation re-resolves the default. No service, device opening, or preference writes. */
export function createAudioStatusAdapter(
  options: { execute?: AudioCommandExecutor } = {},
): AudioStatusAdapter {
  const execute = options.execute ?? executeAudioCommand;
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
  const run = async (
    backend: AudioSink["backend"],
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<string> => {
    if (signal.aborted)
      throw new AudioFailure({
        kind: "error",
        reason: "cancelled",
        message: "Audio request cancelled.",
      });
    const result = await execute(backend, args, signal);
    if (signal.aborted)
      throw new AudioFailure({
        kind: "error",
        reason: "cancelled",
        message: "Audio request cancelled.",
      });
    switch (result.kind) {
      case "ok":
        if (Buffer.byteLength(result.stdout, "utf8") > 64 * 1024)
          invalid(`${backend} returned too much output.`);
        return result.stdout;
      case "missing":
        throw new AudioFailure({ kind: "unavailable", message: `${backend} is not installed.` });
      case "cancelled":
        throw new AudioFailure({
          kind: "error",
          reason: "cancelled",
          message: "Audio request cancelled.",
        });
      case "timeout":
      case "output-limit":
        throw new AudioFailure({
          kind: "error",
          reason: "command",
          message: `${backend}: ${result.kind === "timeout" ? "request timed out" : "output limit exceeded"}.`,
        });
      case "failed":
        if (backend === "wpctl" && (result.exitCode === 2 || result.exitCode === 3))
          throw new AudioFailure({
            kind: "unavailable",
            message: `${backend}: ${result.message.slice(0, 512)}`,
          });
        throw new AudioFailure({
          kind: "error",
          reason: "command",
          message: `${backend}: ${result.message.slice(0, 512)}`,
        });
      default: {
        const exhaustive: never = result;
        throw new Error(String(exhaustive));
      }
    }
  };
  const resolveSink = async (
    backend: AudioSink["backend"],
    signal: AbortSignal,
  ): Promise<AudioSink> => {
    if (backend === "wpctl") {
      const output = await run(backend, ["inspect", "@DEFAULT_AUDIO_SINK@"], signal);
      const id = output.match(/^\s*id\s+(\d+),/m)?.[1];
      const name = property(output, "node.name");
      const serial = property(output, "object.serial");
      if (!id || !name || !serial || !/^\d+$/.test(serial))
        invalid("wpctl did not report an identifiable default sink.");
      if (property(output, "media.class") !== "Audio/Sink")
        invalid("The wpctl default object is not an audio sink.");
      return Object.freeze({
        backend,
        id,
        identity: `${id}:${serial}:${name}`,
        name,
        description: property(output, "node.description"),
      });
    }
    const name = (await run(backend, ["get-default-sink"], signal)).trim();
    if (
      !name ||
      /\s/.test(name) ||
      [...name].some((character) => character.charCodeAt(0) < 32) ||
      name.startsWith("-")
    )
      invalid("pactl did not report a valid default sink name.");
    let entries: unknown;
    try {
      entries = JSON.parse(await run(backend, ["--format=json", "list", "sinks"], signal));
    } catch (error) {
      if (error instanceof AudioFailure) throw error;
      invalid("pactl returned malformed sink metadata.");
    }
    if (!Array.isArray(entries)) invalid("pactl returned malformed sink metadata.");
    const matches: unknown[] = entries.filter(
      (entry: unknown) =>
        typeof entry === "object" && entry !== null && "name" in entry && entry.name === name,
    );
    const entry = matches.length === 1 ? matches[0] : undefined;
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("index" in entry) ||
      typeof entry.index !== "number" ||
      !Number.isSafeInteger(entry.index) ||
      entry.index < 0
    )
      invalid("pactl default sink metadata is missing or ambiguous.");
    const description =
      "description" in entry && typeof entry.description === "string" ? entry.description : null;
    return Object.freeze({
      backend,
      id: String(entry.index),
      identity: `${entry.index}:${name}`,
      name,
      description,
    });
  };
  const read = async (backend: AudioSink["backend"], signal: AbortSignal): Promise<AudioReady> => {
    const sink = await resolveSink(backend, signal);
    let volume: number;
    let muted: boolean;
    if (backend === "wpctl") {
      const text = await run(backend, ["get-volume", sink.id], signal);
      const match = text.trim().match(/^Volume:\s+(\d+(?:\.\d+)?)\s*(\[MUTED\])?$/);
      if (!match?.[1]) invalid("wpctl returned invalid volume or mute information.");
      volume = Number(match[1]);
      muted = !!match[2];
    } else {
      const text = await run(backend, ["get-sink-volume", sink.id], signal);
      const line = text.trim().split("\n")[0];
      if (!line?.startsWith("Volume:")) invalid("pactl returned invalid channel volumes.");
      const channels = line.slice("Volume:".length).split(",");
      const values = channels.map((channel) => {
        const match = channel
          .trim()
          .match(/^[\w-]+:\s*\d+\s*\/\s*(\d+)%\s*\/\s*[-+]?(?:\d+(?:\.\d+)?|inf)\s*dB$/i);
        if (!match?.[1]) invalid("pactl returned invalid channel volumes.");
        return Number(match[1]) / 100;
      });
      volume = Math.max(...values);
      const mute = (await run(backend, ["get-sink-mute", sink.id], signal)).trim();
      if (mute !== "Mute: yes" && mute !== "Mute: no")
        invalid("pactl returned invalid mute information.");
      muted = mute === "Mute: yes";
    }
    if (!Number.isFinite(volume) || volume < 0)
      invalid("Audio volume is not a finite nonnegative value.");
    if (!sameSink(sink, await resolveSink(backend, signal))) changed();
    return Object.freeze({ kind: "ready", sink, volume, muted });
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
    // A background read retains the last observation until its result changes.
    // Mutations still revoke the ready snapshot while their outcome is pending.
    if (kind === "change") publish({ kind: "loading" });
    try {
      const next = await work(controller.signal);
      if (controller.signal.aborted)
        throw new AudioFailure({
          kind: "error",
          reason: "cancelled",
          message: "Audio request cancelled.",
        });
      return token === generation ? publish(next) : state;
    } catch (error) {
      const next: AudioStatus =
        error instanceof AudioFailure
          ? error.status
          : {
              kind: "error",
              reason: "command",
              message:
                error instanceof Error ? error.message.slice(0, 512) : "Audio request failed.",
            };
      return token === generation ? publish(next) : state;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (token === generation) active = null;
    }
  };
  const change = (
    expected: AudioReady,
    args: readonly string[],
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
        const current = await resolveSink(expected.sink.backend, requestSignal);
        if (!sameSink(current, expected.sink)) changed();
        await run(current.backend, args, requestSignal);
        const actual = await read(current.backend, requestSignal);
        if (!sameSink(current, actual.sink)) changed();
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
        async (requestSignal) => {
          try {
            return await read("wpctl", requestSignal);
          } catch (first) {
            if (
              !(first instanceof AudioFailure) ||
              (first.status.kind === "error" &&
                (first.status.reason === "cancelled" || first.status.reason === "default-changed"))
            )
              throw first;
            try {
              return await read("pactl", requestSignal);
            } catch (second) {
              if (!(second instanceof AudioFailure)) throw second;
              if (second.status.kind === "error") throw second;
              if (first.status.kind === "error") throw first;
              throw new AudioFailure({
                kind: "unavailable",
                message: `${first.message} ${second.message}`,
              });
            }
          }
        },
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
        [
          expected.sink.backend === "wpctl" ? "set-volume" : "set-sink-volume",
          expected.sink.id,
          `${Math.round(volume * 10000) / 100}%`,
        ],
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
        [
          expected.sink.backend === "wpctl" ? "set-mute" : "set-sink-mute",
          expected.sink.id,
          muted ? "1" : "0",
        ],
        signal,
      );
    },
    dispose() {
      disposed = true;
      ++generation;
      active?.abort();
      active = null;
      listeners.clear();
      state = Object.freeze({
        kind: "error",
        reason: "disposed",
        message: "Audio adapter is closed.",
      });
    },
  };
}
