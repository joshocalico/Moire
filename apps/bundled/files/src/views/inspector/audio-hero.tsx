/** A track's cover and tags with a mini player: play/pause, a scrubber and the time. */
import React, { useState, type ReactNode } from "react";
import {
  Box,
  IconButton,
  MediaGlyph,
  Slider,
  Surface,
  TextBlock,
  formatPlaybackTime,
  usePalette,
} from "@moire/ui";
import type { Entry } from "#files/filesystem";
import type { Preview } from "#files/preview/model";
import { useAudioPlayback } from "#files/preview/use-audio-playback";
import { Thumbnail } from "#files/views/thumbnail";
import { px } from "./cards";

export const AUDIO_HERO_HEIGHT = 176;
const ART = 104;
const PLAY = 36;
const TIME = 84;

export function AudioHero(props: {
  entry: Entry;
  preview: Extract<Preview, { kind: "audio" }>;
  width: number;
  height: number;
}): ReactNode {
  const pal = usePalette();
  const { preview, entry } = props;
  const playback = useAudioPlayback(entry.path);
  // While the scrubber is held, it shows where it will seek to.
  const [scrub, setScrub] = useState<number | null>(null);
  const art = px(ART);
  const textX = art + px(28);
  const textWidth = Math.max(1, props.width - textX - px(14));
  const duration = playback.duration || preview.duration || 0;
  const position = scrub ?? playback.position;
  const state = playback.state;
  const status =
    state.kind === "error"
      ? state.message
      : state.kind === "opening"
        ? "Starting…"
        : `${formatPlaybackTime(position)} / ${formatPlaybackTime(duration)}`;
  const controlsY = art + px(24);
  const timeWidth = state.kind === "error" ? props.width - px(60 + 14) : px(TIME);
  return (
    <Surface
      width={props.width}
      height={props.height}
      fill={pal.bg}
      radius={px(10)}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      <Box x={px(14)} y={px(14)} width={art} height={art}>
        <Thumbnail entry={entry} width={art} height={art} radius={px(8)} backdrop={pal.bg} />
      </Box>
      <TextBlock
        x={textX}
        y={px(18)}
        width={textWidth}
        height={px(22)}
        text={preview.title ?? entry.name}
        fontSize={15}
        fontWeight="medium"
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={textX}
        y={px(40)}
        width={textWidth}
        height={px(18)}
        text={preview.artist ?? ""}
        fontSize={12}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={textX}
        y={px(58)}
        width={textWidth}
        height={px(18)}
        text={[preview.album, preview.year].filter(Boolean).join(" · ")}
        color={pal.muted}
        fontSize={12}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={textX}
        y={px(84)}
        width={textWidth}
        height={px(18)}
        text={preview.track ? `Track ${preview.track}` : ""}
        color={pal.muted}
        fontSize={11}
        verticalAlign="center"
        maxLines={1}
      />
      <IconButton
        x={px(14)}
        y={controlsY}
        width={px(PLAY)}
        height={px(PLAY)}
        variant="standard"
        focusId="inspector:play"
        tooltip={playback.playing ? "Pause" : "Play"}
        disabled={state.kind === "opening"}
        icon={(style) => (
          <MediaGlyph
            kind={playback.playing ? "pause" : "play"}
            size={px(14)}
            color={style.color}
          />
        )}
        onPress={playback.toggle}
      />
      {state.kind === "error" ? null : (
        <Slider
          x={px(60)}
          y={controlsY + px(6)}
          width={Math.max(1, props.width - px(60) - px(TIME + 4))}
          size="small"
          focusId="inspector:scrub"
          disabled={!duration}
          value={duration ? Math.min(1, position / duration) : 0}
          onChange={(value) => setScrub(value * duration)}
          onCommit={(value) => {
            setScrub(null);
            playback.seek(value * duration);
          }}
          onCancel={() => setScrub(null)}
        />
      )}
      <TextBlock
        x={props.width - timeWidth - px(14)}
        y={controlsY}
        width={timeWidth}
        height={px(PLAY)}
        text={status}
        color={state.kind === "error" ? pal.danger : pal.muted}
        fontSize={11}
        horizontalAlign="end"
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
    </Surface>
  );
}
