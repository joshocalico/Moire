/** A media player window over an mpv PlaybackSession: open files, a queue, transport controls. */
import path from "node:path";
import React, { useReducer, useState, type ReactNode } from "react";
import {
  PlaybackBar,
  ShortcutManager,
  formatPlaybackTime,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { FileChooser } from "./file-chooser";
import { tidyPath } from "./format";
import {
  AppFrame,
  OpenButton,
  OpenFileState,
  TitleActions,
  ToolButton,
  appFrameBody,
} from "./frame";
import { currentEntry, initialQueue, reduceQueue } from "./player-model";
import { usePlayback, type PlaybackOptions } from "./player-session";
import { NowPlaying } from "./player-views";

const VIDEO_EXTENSIONS = ["mp4", "mkv", "webm", "mov", "avi", "m4v", "ogv"];
const AUDIO_EXTENSIONS = ["mp3", "flac", "ogg", "oga", "opus", "wav", "m4a", "aac"];

/** What the file chooser was opened for: a new queue, or more of it. */
type Choosing = "open" | "add" | null;

export function PlayerApp(
  props: WindowSize & {
    initialPaths?: string[];
    video?: boolean;
    /** Recent-files key; defaults to the bundled Video Player's id. */
    appId?: string;
    playbackOptions?: PlaybackOptions;
    /** The window the header bar controls; see AppFrame. */
    window?: WindowActions | null;
  },
): ReactNode {
  const video = !!props.video;
  const appId = props.appId ?? (video ? "org.moire.VideoPlayer" : "org.moire.AudioPlayer");
  const [queue, dispatch] = useReducer(reduceQueue, props.initialPaths, initialQueue);
  const [choosing, setChoosing] = useState<Choosing>(null);
  const playback = usePlayback(queue, dispatch, {
    video,
    appId,
    playback: props.playbackOptions,
  });
  const { state, error } = playback;
  const entry = currentEntry(queue);
  const file = entry?.path ?? "";
  const ready = state.kind === "ready";
  const count = queue.entries.length;
  const status =
    error ||
    (state.kind === "error"
      ? state.message
      : ready
        ? `${state.paused ? "Paused" : "Playing"} · ${formatPlaybackTime(state.position)} of ${formatPlaybackTime(state.duration)}`
        : state.kind === "opening"
          ? "Starting mpv playback…"
          : queue.ended
            ? "Playback finished. Press Play to replay, or open another file."
            : file
              ? "Stopped. Press Play to start again."
              : "Open a local media file.");
  const title = video ? "Video Player" : "Audio Player";
  const icon = video ? "video" : "music";
  const body = appFrameBody({ height: props.height, title });
  const choose = (chosen: string) => {
    dispatch({ type: choosing === "add" ? "append" : "replace", paths: [chosen] });
    setChoosing(null);
  };

  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      enabled={!choosing}
      shortcuts={[{ id: "open", key: "o", ctrl: true, onInvoke: () => setChoosing("open") }]}
    >
      <AppFrame
        {...props}
        title={title}
        icon={icon}
        subtitle={file ? path.basename(file) : undefined}
        status={status}
        statusEnd={count > 1 ? `${queue.index + 1} of ${count}` : undefined}
        actions={
          file ? (
            <TitleActions>
              <ToolButton
                icon="restart"
                tooltip="Reopen from the start"
                focusId="player:reopen"
                onPress={() => dispatch({ type: "restart", play: false })}
              />
              {video ? (
                <ToolButton
                  icon="fullscreen"
                  tooltip="Fullscreen video"
                  focusId="player:fullscreen"
                  disabled={!ready}
                  onPress={() => playback.invoke(["cycle", "fullscreen"])}
                />
              ) : null}
              <ToolButton
                icon="plus"
                tooltip="Add to queue"
                focusId="player:add"
                onPress={() => setChoosing("add")}
              />
              <OpenButton focusId="player:open" onPress={() => setChoosing("open")} />
            </TitleActions>
          ) : null
        }
      >
        {file ? (
          <NowPlaying
            width={props.width}
            height={body.height}
            video={video}
            entries={queue.entries}
            index={queue.index}
            state={state}
            ended={queue.ended}
            error={error}
            onSelect={(index) => dispatch({ type: "select", index, play: true })}
            onClear={() => dispatch({ type: "clear" })}
            bar={
              <PlaybackBar
                width={props.width}
                title={path.basename(file)}
                subtitle={tidyPath(path.dirname(file))}
                status={state.kind === "opening" ? "Opening…" : undefined}
                ready={ready}
                canPlay={ready || queue.ended || state.kind === "idle"}
                paused={!ready || state.paused}
                position={ready ? state.position : 0}
                duration={ready ? state.duration : 0}
                volume={ready ? Math.min(100, state.volume) : 100}
                onTogglePause={() => {
                  if (queue.ended || state.kind === "idle")
                    dispatch({ type: "restart", play: true });
                  else playback.invoke(["cycle", "pause"]);
                }}
                onPrevious={
                  queue.index > 0
                    ? () => dispatch({ type: "select", index: queue.index - 1, play: false })
                    : undefined
                }
                onNext={
                  queue.index < count - 1
                    ? () => dispatch({ type: "select", index: queue.index + 1, play: false })
                    : undefined
                }
                onStop={playback.stop}
                onSeek={(seconds) => {
                  if (ready) playback.invoke(["seek", seconds, "absolute+exact"]);
                }}
                onVolume={(volume) =>
                  playback.invoke(["set_property", "volume", Math.round(volume)])
                }
              />
            }
          />
        ) : (
          <OpenFileState
            width={props.width}
            height={body.height}
            appId={appId}
            icon={icon}
            title={video ? "Open a video" : "Open an audio file"}
            message={
              video
                ? "Video plays in its own window; this one controls playback, seeking and the queue."
                : "Audio starts paused. Press Play to listen."
            }
            error={error}
            onBrowse={() => setChoosing("open")}
            onOpen={(value) => dispatch({ type: "replace", paths: [value] })}
          />
        )}
      </AppFrame>
      {choosing ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="open"
          title={choosing === "add" ? "Add to queue" : video ? "Open a video" : "Open audio"}
          appId={appId}
          accept={video ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS}
          directory={file ? path.dirname(file) : undefined}
          onChoose={choose}
          onCancel={() => setChoosing(null)}
        />
      ) : null}
    </ShortcutManager>
  );
}
