/** The media player's body: the open file, what the player is doing, and the queue. */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  Pressable,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  playbackBarHeight,
  registerIntrinsicSize,
  usePalette,
} from "@moire/ui";
import { IconTile } from "./frame";
import type { PlaybackState } from "./playback";
import type { QueueEntry } from "./player-model";

const ROW_HEIGHT = 32;
const ICON_SIZE = 72;
const CLEAR_WIDTH = 64;

export function NowPlaying(props: {
  width: number;
  height: number;
  video: boolean;
  entries: readonly QueueEntry[];
  index: number;
  state: PlaybackState;
  ended: boolean;
  error: string;
  bar: ReactNode;
  onSelect: (index: number) => void;
  onClear: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const barH = playbackBarHeight(props.width);
  const areaH = Math.max(1, props.height - barH);
  const file = props.entries[props.index]?.path ?? "";
  const caption =
    props.error ||
    (props.state.kind === "error"
      ? props.state.message
      : props.state.kind === "opening"
        ? "Opening…"
        : props.state.kind === "ready"
          ? props.video
            ? `Showing in its own window · ${props.state.paused ? "paused" : "playing"}`
            : props.state.paused
              ? "Paused"
              : "Playing"
          : props.ended
            ? "Finished"
            : "Stopped");
  const contentW = Math.min(480 * ui, props.width - 48 * ui);
  const rowH = ROW_HEIGHT * ui;
  const count = props.entries.length;
  const visibleRows = Math.max(0, Math.min(count, Math.floor((areaH - 200 * ui) / rowH) - 1));
  // Keep the current entry in view, one row from the top when it can be.
  const first = Math.max(0, Math.min(props.index - 1, count - Math.max(1, visibleRows)));
  const showQueue = count > 1 && visibleRows >= 2;
  const contentH =
    (ICON_SIZE + 14 + 26 + 20) * ui + (showQueue ? 24 * ui + 28 * ui + visibleRows * rowH : 0);
  return (
    <Box width={props.width} height={props.height}>
      <Vertical
        x={(props.width - contentW) / 2}
        y={Math.max(12 * ui, (areaH - contentH) / 2)}
        width={contentW}
        gap={0}
        align="center"
      >
        <IconTile icon={props.video ? "video" : "music"} size={ICON_SIZE} />
        <Box width={contentW} height={14 * ui} />
        <TextBlock
          width={contentW}
          height={26 * ui}
          text={path.basename(file)}
          fontSize={17}
          fontWeight="medium"
          horizontalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
        <TextBlock
          width={contentW}
          height={20 * ui}
          text={caption}
          color={props.error || props.state.kind === "error" ? pal.danger : pal.muted}
          fontSize={12}
          horizontalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
        {showQueue ? (
          <>
            <Box width={contentW} height={24 * ui} />
            <Horizontal width={contentW} height={28 * ui} gap={8 * ui} align="center">
              <TextBlock
                width={contentW - CLEAR_WIDTH * ui - 8 * ui}
                text={`QUEUE · ${count}`}
                color={pal.muted}
                fontSize={11}
                fontWeight="medium"
              />
              <Button
                width={CLEAR_WIDTH * ui}
                height={26 * ui}
                size="small"
                variant="ghost"
                label="Clear"
                focusId="player:clear-queue"
                onPress={props.onClear}
              />
            </Horizontal>
            {props.entries.slice(first, first + visibleRows).map((entry, offset) => (
              <QueueRow
                key={entry.id}
                width={contentW}
                position={first + offset}
                name={path.basename(entry.path)}
                current={first + offset === props.index}
                onPress={() => props.onSelect(first + offset)}
              />
            ))}
          </>
        ) : null}
      </Vertical>
      <Box y={areaH} width={props.width} height={barH}>
        {props.bar}
      </Box>
    </Box>
  );
}

/** A queued file; pressing it plays it. */
function QueueRow(props: {
  width: number;
  position: number;
  name: string;
  current: boolean;
  onPress: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const rowH = ROW_HEIGHT * ui;
  return (
    <Pressable
      width={props.width}
      height={rowH}
      radius={8 * ui}
      fill={props.current ? pal.selection : 0x00000000}
      hoverFill={props.current ? pal.selection : pal.hover}
      pressedFill={pal.pressed}
      focusId={`player:queue:${props.position + 1}`}
      onPress={props.onPress}
    >
      <Horizontal
        x={10 * ui}
        width={props.width - 20 * ui}
        height={rowH}
        gap={10 * ui}
        align="center"
      >
        <TextBlock
          width={20 * ui}
          text={String(props.position + 1)}
          color={pal.muted}
          fontSize={11}
          horizontalAlign="end"
        />
        <TextBlock
          width={props.width - 50 * ui}
          text={props.name}
          fontSize={13}
          fontWeight={props.current ? "medium" : "regular"}
          maxLines={1}
          overflow="ellipsis"
        />
      </Horizontal>
    </Pressable>
  );
}

registerIntrinsicSize(QueueRow, (props) => ({
  width: props.width,
  height: ROW_HEIGHT * getUiScaleFactor(),
}));
