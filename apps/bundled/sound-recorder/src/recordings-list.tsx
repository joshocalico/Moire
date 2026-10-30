/** Saved recordings, newest first, with play/stop, Show in Files and Move to Trash. */
import React, { type ReactNode } from "react";
import {
  CollectionList,
  CollectionRow,
  Horizontal,
  TextBlock,
  formatPlaybackTime,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { Card, ToolButton, ToolIcon, cardContent } from "@moire/app-tools";
import type { Recording } from "./model";
import type { Playing } from "./use-recorder";

const ROW_HEIGHT = 56;
const BAR_HEIGHT = 36;

export function RecordingsList(props: {
  width: number;
  height: number;
  recordings: readonly Recording[];
  selected: string | null;
  playing: Playing | null;
  onSelect: (file: string) => void;
  onPlay: (file: string) => void;
  onShow: (file: string) => void;
  onTrash: (file: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const inner = cardContent(props.width, props.height).width;
  const listH = cardContent(props.width, props.height).height - BAR_HEIGHT * ui - 8 * ui;
  const selected = props.recordings.find((item) => item.file === props.selected) ?? null;
  const isPlaying = (file: string) => props.playing?.file === file;
  return (
    <Card
      width={props.width}
      height={props.height}
      title="Recordings"
      aside={
        <TextBlock
          text={`${props.recordings.length}`}
          color={pal.muted}
          fontSize={12}
          maxLines={1}
        />
      }
    >
      <Horizontal width={inner} height={BAR_HEIGHT * ui} gap={4 * ui} align="center">
        <ToolButton
          icon={selected && isPlaying(selected.file) ? "stop" : "play"}
          tooltip={selected && isPlaying(selected.file) ? "Stop" : "Play"}
          focusId="recorder:play"
          disabled={!selected}
          onPress={() => selected && props.onPlay(selected.file)}
        />
        <ToolButton
          icon="folder"
          tooltip="Show in Files"
          focusId="recorder:show"
          disabled={!selected}
          onPress={() => selected && props.onShow(selected.file)}
        />
        <ToolButton
          icon="trash"
          tooltip="Move to Trash"
          focusId="recorder:trash"
          disabled={!selected}
          onPress={() => selected && props.onTrash(selected.file)}
        />
      </Horizontal>
      <CollectionList
        y={BAR_HEIGHT * ui + 8 * ui}
        width={inner}
        height={Math.max(ROW_HEIGHT * ui, listH)}
        items={props.recordings}
        getKey={(item) => item.file}
        selectedKey={props.selected}
        onSelect={(item) => props.onSelect(item.file)}
        onActivate={(item) => props.onPlay(item.file)}
        onDelete={(item) => props.onTrash(item.file)}
        focusId="recorder:recordings"
        rowHeight={ROW_HEIGHT * ui}
        emptyMessage="Saved takes appear here."
        renderItem={(item, row) => (
          <CollectionRow
            width={row.width}
            height={row.height}
            selected={row.selected}
            title={item.name.replace(/\.wav$/i, "")}
            subtitle={new Date(item.modified).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            metadata={playbackLabel(item, props.playing)}
            leading={
              <ToolIcon
                name={isPlaying(item.file) ? "pause" : "play"}
                x={10 * ui}
                y={10 * ui}
                size={20 * ui}
                color={isPlaying(item.file) ? pal.accent : pal.muted}
              />
            }
          />
        )}
      />
    </Card>
  );
}

/** "0:12" for a recording, "0:03 / 0:12" while it plays. */
function playbackLabel(item: Recording, playing: Playing | null): string {
  const length = item.seconds === null ? "–" : formatPlaybackTime(item.seconds);
  if (playing?.file !== item.file) return length;
  if (playing.state.kind === "ready")
    return `${formatPlaybackTime(playing.state.position)} / ${length}`;
  return playing.state.kind === "opening" ? "Opening…" : length;
}
