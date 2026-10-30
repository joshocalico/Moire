/** The media player's effect: one mpv PlaybackSession for the queue's current entry. */
import { useEffect, useRef, useState, type Dispatch } from "react";
import { rememberRecentFile } from "./frame";
import { errorText } from "./index";
import { PlaybackSession, type PlaybackState } from "./playback";
import { currentEntry, type PlayerQueue, type QueueAction } from "./player-model";

export type PlaybackOptions = Pick<
  NonNullable<ConstructorParameters<typeof PlaybackSession>[1]>,
  "binary" | "extraArgs"
>;

export type Playback = {
  state: PlaybackState;
  /** The last failure starting playback or sending it a command. */
  error: string;
  /** Send mpv a command (pause, seek, volume); failures land in `error`. */
  invoke(command: readonly (string | number | boolean)[]): void;
  /** Close the session; the entry stays queued, ready to start again. */
  stop(): void;
};

/**
 * Opens the current entry in a fresh session whenever it changes (or the queue asks to open it
 * again), and closes the session on change or unmount.
 */
export function usePlayback(
  queue: PlayerQueue,
  dispatch: Dispatch<QueueAction>,
  options: { video: boolean; appId: string; playback?: PlaybackOptions },
): Playback {
  const [state, setState] = useState<PlaybackState>({ kind: "idle" });
  const [error, setError] = useState("");
  const active = useRef<PlaybackSession | null>(null);
  // Fixed for the window's life: changing the binary mid-session isn't supported.
  const playback = useRef(options.playback);
  const entry = currentEntry(queue);
  useEffect(() => {
    if (!entry) {
      setState({ kind: "idle" });
      return;
    }
    let alive = true;
    const play = queue.play;
    let latest: PlaybackState = { kind: "idle" };
    const session = new PlaybackSession(
      (value) => {
        latest = value;
        if (alive) setState(value);
      },
      {
        ...playback.current,
        video: options.video,
        onEnded: () => {
          if (alive && active.current === session) dispatch({ type: "ended" });
        },
      },
    );
    active.current = session;
    setError("");
    session
      .open(entry.path)
      .then(async () => {
        // A missing or failing backend resolves with an error state; only real opens are recent.
        if (!alive || active.current !== session || latest.kind !== "ready") return;
        rememberRecentFile(options.appId, entry.path);
        if (play) await session.control(["set_property", "pause", false]);
      })
      .catch((cause: unknown) => {
        if (alive && active.current === session) setError(errorText(cause));
      });
    return () => {
      alive = false;
      if (active.current === session) active.current = null;
      void session.close();
    };
  }, [entry?.id, queue.revision, options.video]);
  return {
    state,
    error,
    invoke: (command) => {
      const session = active.current;
      session?.control(command).catch((cause: unknown) => {
        if (active.current === session) setError(errorText(cause));
      });
    },
    stop: () => {
      const session = active.current;
      active.current = null;
      void session?.close();
      setState({ kind: "idle" });
      dispatch({ type: "stopped" });
    },
  };
}
