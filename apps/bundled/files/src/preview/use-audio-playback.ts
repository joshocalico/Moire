/**
 * Play, pause and scrub for an audio preview: an mpv session (`PlaybackSession` from
 * `@moire/app-tools`) made on the first press or seek, closed when the previewed file changes or
 * the sheet closes. Without mpv the state says so and the preview stays usable.
 */
import { useEffect, useRef, useState } from "react";
import { PlaybackSession, errorText, type PlaybackState } from "@moire/app-tools";

export type AudioPlayback = {
  state: PlaybackState;
  playing: boolean;
  /** Seconds from the start, while ready; 0 otherwise. */
  position: number;
  duration: number;
  toggle(): void;
  seek(seconds: number): void;
};

export type AudioPlaybackOptions = {
  /** The mpv binary; smokes pass a fixture. */
  binary?: string;
  extraArgs?: string[];
};

/** mpv absent from PATH, as PlaybackSession reports it. */
const MISSING_MPV = /backend unavailable|ENOENT/;
const NO_PLAYER = "Playing needs mpv, which isn't installed.";

/** What to do once a session that is still opening becomes ready. */
type Intent = { play: boolean; seek: number | null };

export function useAudioPlayback(
  file: string | null,
  options: AudioPlaybackOptions = {},
): AudioPlayback {
  const [state, setState] = useState<PlaybackState>({ kind: "idle" });
  const session = useRef<PlaybackSession | null>(null);
  const intent = useRef<Intent>({ play: false, seek: null });
  useEffect(() => {
    setState({ kind: "idle" });
    return () => {
      void session.current?.close();
      session.current = null;
    };
  }, [file]);

  const fail = (started: PlaybackSession, message: string) => {
    if (session.current !== started) return;
    session.current = null;
    setState({ kind: "error", message: MISSING_MPV.test(message) ? NO_PLAYER : message });
    void started.close();
  };

  const start = (path: string, wanted: Intent) => {
    intent.current = wanted;
    // A missing or failing mpv resolves `open` with an error state, which is what to show.
    let latest: PlaybackState = { kind: "opening" };
    const started = new PlaybackSession(
      (value) => {
        latest = value;
        if (session.current === started) setState(value);
      },
      { binary: options.binary, extraArgs: options.extraArgs },
    );
    session.current = started;
    void started
      .open(path)
      .then(async () => {
        if (latest.kind !== "ready") {
          fail(started, latest.kind === "error" ? latest.message : "Playback could not start.");
          return;
        }
        const { play, seek } = intent.current;
        if (seek !== null) await started.seek(seek);
        if (play) await started.control(["set_property", "pause", false]);
      })
      .catch((error: unknown) => fail(started, errorText(error)));
  };

  const report = (error: unknown) => setState({ kind: "error", message: errorText(error) });
  const ready = state.kind === "ready" ? state : null;
  return {
    state,
    playing: ready ? !ready.paused : false,
    position: ready?.position ?? 0,
    duration: ready?.duration ?? 0,
    toggle() {
      if (!file) return;
      const current = session.current;
      if (!current) return start(file, { play: true, seek: null });
      if (ready) current.control(["set_property", "pause", !ready.paused]).catch(report);
      else intent.current = { ...intent.current, play: !intent.current.play };
    },
    seek(seconds) {
      if (!file) return;
      const current = session.current;
      if (!current) return start(file, { play: false, seek: seconds });
      if (ready) current.seek(seconds).catch(report);
      else intent.current = { ...intent.current, seek: seconds };
    },
  };
}
