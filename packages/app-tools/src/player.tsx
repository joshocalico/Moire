import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Row, Slider, Label, getUiScaleFactor, type WindowSize } from "@moire/ui";
import { AppFrame, FileHeader, errorText } from "./index";
import { PlaybackSession, type PlaybackState } from "./playback";
export function PlayerApp(
  props: WindowSize & {
    initialPaths?: string[];
    video?: boolean;
    playbackOptions?: Pick<
      NonNullable<ConstructorParameters<typeof PlaybackSession>[1]>,
      "binary" | "extraArgs"
    >;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const [queue, setQueue] = useState(props.initialPaths ?? []),
    [index, setIndex] = useState(0),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<PlaybackState>({ kind: "idle" }),
    [session, setSession] = useState<PlaybackSession | null>(null),
    [error, setError] = useState(""),
    [ended, setEnded] = useState(false);
  const autoPlay = useRef(false),
    options = useRef(props.playbackOptions),
    activeSession = useRef<PlaybackSession | null>(null);
  const file = queue[index] ?? "";
  useEffect(() => {
    setEnded(false);
    if (!file) {
      setSession(null);
      setState({ kind: "idle" });
      return;
    }
    let alive = true;
    const shouldPlay = autoPlay.current;
    const next = new PlaybackSession(
      (value) => {
        if (alive) setState(value);
      },
      {
        ...options.current,
        video: props.video,
        onEnded: () => {
          if (!alive || activeSession.current !== next) return;
          if (index + 1 < queue.length) {
            autoPlay.current = true;
            setIndex(index + 1);
          } else setEnded(true);
        },
      },
    );
    activeSession.current = next;
    setSession(next);
    setError("");
    void next
      .open(file)
      .then(async () => {
        if (alive && activeSession.current === next && shouldPlay)
          await next.control(["set_property", "pause", false]);
      })
      .catch((error) => {
        if (alive && activeSession.current === next) setError(errorText(error));
      });
    return () => {
      alive = false;
      if (activeSession.current === next) activeSession.current = null;
      void next.close();
    };
  }, [file, index, revision, props.video]);
  const invoke = (command: readonly (string | number | boolean)[]) => {
    const current = activeSession.current;
    void current?.control(command).catch((error) => {
      if (activeSession.current === current) setError(errorText(error));
    });
  };
  const ready = state.kind === "ready";
  const status =
    error ||
    (state.kind === "error"
      ? state.message
      : state.kind === "ready"
        ? `${state.paused ? "Paused" : "Playing"} · ${Math.floor(state.position)} / ${Math.floor(state.duration)} seconds`
        : state.kind === "opening"
          ? "Starting mpv playback…"
          : ended
            ? "Playback finished. Press Play to replay, or open another file."
            : "Open a local media file.");
  return (
    <AppFrame
      {...props}
      status={status}
      header={
        <FileHeader
          key={file}
          width={props.width}
          value={file}
          onOpen={(value) => {
            autoPlay.current = false;
            setQueue([value]);
            setIndex(0);
            setRevision((value) => value + 1);
          }}
        />
      }
      controls={
        <Row width={props.width} height={44 * ui} padding={6 * ui} gap={6 * ui}>
          <Button
            height={32 * ui}
            width={72 * ui}
            label={ready && !state.paused ? "Pause" : "Play"}
            disabled={!ready && !ended}
            onPress={() => {
              if (ended) {
                autoPlay.current = true;
                setRevision((value) => value + 1);
              } else invoke(["cycle", "pause"]);
            }}
          />
          <Button
            height={32 * ui}
            width={64 * ui}
            label="Stop"
            disabled={!session || state.kind === "idle"}
            onPress={() => {
              autoPlay.current = false;
              activeSession.current = null;
              void session?.close();
              setSession(null);
              setEnded(false);
              setState({ kind: "idle" });
            }}
          />
          <Button
            height={32 * ui}
            width={64 * ui}
            label="Reopen"
            disabled={!file}
            onPress={() => {
              autoPlay.current = false;
              setRevision((value) => value + 1);
            }}
          />
          <Button
            height={32 * ui}
            width={72 * ui}
            label="Previous"
            disabled={index === 0}
            onPress={() => {
              autoPlay.current = false;
              setIndex((value) => value - 1);
            }}
          />
          <Button
            height={32 * ui}
            width={56 * ui}
            label="Next"
            disabled={index >= queue.length - 1}
            onPress={() => {
              autoPlay.current = false;
              setIndex((value) => value + 1);
            }}
          />
          <Label width={44 * ui} height={32 * ui} text="Volume" />
          <Slider
            height={32 * ui}
            width={110 * ui}
            value={ready ? Math.min(1, state.volume / 100) : 1}
            disabled={!ready}
            onChange={(value) => invoke(["set_property", "volume", Math.round(value * 100)])}
          />
          {props.video ? (
            <Button
              height={32 * ui}
              width={92 * ui}
              label="Fullscreen"
              disabled={!ready}
              onPress={() => invoke(["cycle", "fullscreen"])}
            />
          ) : null}
        </Row>
      }
    >
      <Label
        x={20 * ui}
        y={20 * ui}
        width={props.width - 40 * ui}
        height={58 * ui}
        text={file || "No file loaded"}
        fontSize={18}
        wrap
        maxLines={2}
      />
      <Slider
        height={32 * ui}
        x={20 * ui}
        y={100 * ui}
        width={props.width - 40 * ui}
        value={ready && state.duration > 0 ? Math.min(1, state.position / state.duration) : 0}
        disabled={!ready || state.duration <= 0}
        step={0.001}
        onChange={(value) => {
          if (ready) invoke(["seek", value * state.duration, "absolute+exact"]);
        }}
      />
      <Label
        x={20 * ui}
        y={145 * ui}
        width={props.width - 40 * ui}
        height={90 * ui}
        text={
          props.video
            ? "Video plays in mpv's Wayland window. Use this panel to control playback, seek and volume."
            : "Playback starts paused. Press Play to listen. Files passed at launch form a playlist."
        }
        wrap
      />
      <Label
        x={20 * ui}
        y={250 * ui}
        width={props.width - 40 * ui}
        height={72 * ui}
        text={status}
        wrap
      />
    </AppFrame>
  );
}
