/**
 * Playing a video from its preview: an mpv window (`PlaybackSession` with video) opened on the
 * first press and closed when the previewed file changes or the pane closes. Without mpv the
 * state says so, and the caller opens the file in its application instead.
 */
import { useEffect, useRef, useState } from "react";
import { PlaybackSession, errorText, type PlaybackState } from "@moire/app-tools";

export type VideoPlayback = {
  state: PlaybackState;
  playing: boolean;
  toggle(): void;
  stop(): void;
};

export function useVideoPlayback(
  file: string | null,
  options?: { binary?: string; extraArgs?: string[] },
): VideoPlayback {
  const [state, setState] = useState<PlaybackState>({ kind: "idle" });
  const session = useRef<PlaybackSession | null>(null);
  const stop = () => {
    void session.current?.close();
    session.current = null;
    setState({ kind: "idle" });
  };
  useEffect(() => {
    setState({ kind: "idle" });
    return () => {
      void session.current?.close();
      session.current = null;
    };
  }, [file]);
  return {
    state,
    playing: state.kind === "ready" && !state.paused,
    stop,
    toggle() {
      if (!file) return;
      const current = session.current;
      if (current) {
        if (state.kind === "ready")
          current
            .control(["set_property", "pause", !state.paused])
            .catch((error: unknown) => setState({ kind: "error", message: errorText(error) }));
        return;
      }
      let latest: PlaybackState = { kind: "opening" };
      const started = new PlaybackSession(
        (value) => {
          latest = value;
          if (session.current === started) setState(value);
        },
        { video: true, binary: options?.binary, extraArgs: options?.extraArgs },
      );
      session.current = started;
      void started
        .open(file)
        .then(() => {
          if (latest.kind === "ready") return started.control(["set_property", "pause", false]);
        })
        .catch((error: unknown) => {
          if (session.current === started) setState({ kind: "error", message: errorText(error) });
        });
    },
  };
}
