/**
 * The input level meter for Settings › Sound: a PipeWire capture stream from the default input
 * (`recordLevels`), reduced to one peak per tick. It runs only between `start` and `stop` (Settings
 * holds it while Sound is open), stops itself after `maxMs`, and only the level leaves this
 * module — never the audio. Moved from `@moire/prefs`, where it ran `pw-record`.
 */
import { recordLevels, type RecordLevelsResult, type Levels } from "./sound";

export type InputMeterState =
  | { readonly kind: "off" }
  | { readonly kind: "on" }
  | { readonly kind: "unavailable"; readonly message: string };

export type InputMeter = {
  readonly state: InputMeterState;
  start(): void;
  stop(): void;
};

/** What the meter records with; a fake in smokes. */
export type LevelRecorder = (options: {
  onLevels: (levels: Levels) => void;
  onEnd: (message: string) => void;
  intervalMs: number;
}) => RecordLevelsResult;

/** Ticks per second; the meter is a glance, not a VU. */
const TICK_MS = 100;
/** A meter left running (a forgotten window) stops on its own. */
const MAX_MS = 10 * 60_000;

export function createInputMeter(options: {
  onLevel: (level: number) => void;
  onState?: (state: InputMeterState) => void;
  record?: LevelRecorder;
  tickMs?: number;
  maxMs?: number;
}): InputMeter {
  const record = options.record ?? recordLevels;
  let state: InputMeterState = { kind: "off" };
  let stopRecording: (() => void) | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  const setState = (next: InputMeterState) => {
    state = next;
    options.onState?.(next);
  };
  const halt = () => {
    if (deadline) clearTimeout(deadline);
    deadline = null;
    const running = stopRecording;
    stopRecording = null;
    running?.();
  };
  return {
    get state() {
      return state;
    },
    start() {
      if (stopRecording) return;
      let current: (() => void) | null = null;
      const result = record({
        intervalMs: options.tickMs ?? TICK_MS,
        onLevels: ({ peak }) => {
          if (stopRecording === current) options.onLevel(peak);
        },
        onEnd: (message) => {
          if (stopRecording !== current) return;
          halt();
          setState({
            kind: "unavailable",
            message: `The input level can't be read: ${message}`.slice(0, 512),
          });
        },
      });
      if (result.kind !== "recording") {
        setState({
          kind: "unavailable",
          message: `The input level can't be shown: ${result.message}`.slice(0, 512),
        });
        return;
      }
      current = () => result.recording.stop();
      stopRecording = current;
      deadline = setTimeout(() => {
        halt();
        setState({ kind: "off" });
      }, options.maxMs ?? MAX_MS);
      deadline.unref?.();
      setState({ kind: "on" });
    },
    stop() {
      if (!stopRecording) return;
      halt();
      setState({ kind: "off" });
    },
  };
}
