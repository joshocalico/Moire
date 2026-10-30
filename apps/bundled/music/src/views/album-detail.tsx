import React, { type ReactNode } from "react";
import {
  Button,
  Column,
  ContentCard,
  ImageWidget,
  Label,
  Row,
  ScrollColumn,
  Surface,
  formatPlaybackTime,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import type { Track } from "#music/library";
import { artistName, type Album } from "#music/model";
import { TrackList } from "./track-list";

/** Below this content width the album header stacks smaller artwork and type. */
const COMPACT_WIDTH = 650;

/** An album: artwork, title and actions above its (possibly search-filtered) tracks. */
export function AlbumDetail(
  props: WindowSize & {
    y: number;
    album: Album;
    tracks: readonly Track[];
    selected: Track | undefined;
    searching: boolean;
    busy: boolean;
    onSelect: (track: Track) => void;
    onPlay: (tracks: readonly Track[], start?: number) => void;
    onShuffle: () => void;
    onEnqueue: () => void;
    onRemove: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  const { album, tracks, selected } = props;
  const compact = props.width < COMPACT_WIDTH * ui;
  const art = (compact ? 96 : 220) * ui;
  const heroHeight = (compact ? 204 : 320) * ui;
  // The track list keeps a usable height; the column scrolls when the window is short.
  const trackHeight = Math.max(180 * ui, props.height - heroHeight - 68 * ui);
  return (
    <ScrollColumn y={props.y} width={props.width} height={Math.max(1, props.height)} gap={0}>
      <ContentCard width={props.width} fill={pal.bg} padding={16 * ui} gap={12 * ui}>
        <Row width={props.width - 32 * ui} height={(compact ? 120 : 236) * ui} gap={20 * ui}>
          {album.artwork ? (
            <ImageWidget width={art} height={art} src={album.artwork} fit="cover" />
          ) : (
            <Surface width={art} height={art} fill={pal.surface}>
              <Label
                width={art}
                height={art}
                text="ALBUM"
                color={pal.muted}
                fontSize={11}
                horizontalAlign="center"
                verticalAlign="center"
              />
            </Surface>
          )}
          <Column
            width={Math.max(1, props.width - (compact ? 148 : 272) * ui)}
            gap={(compact ? 6 : 8) * ui}
          >
            <Label text="ALBUM" fontSize={10} color={pal.muted} />
            <Label
              text={album.title}
              fontSize={compact ? 22 : 40}
              fontWeight="medium"
              wrap
              maxLines={2}
              overflow="ellipsis"
            />
            <Label text={artistName(album.artist)} fontSize={15} maxLines={1} overflow="ellipsis" />
            <Label
              text={`${album.year ? `${album.year.slice(0, 4)} · ` : ""}${album.tracks.length} tracks · ${formatPlaybackTime(album.tracks.reduce((sum, track) => sum + track.duration, 0))}`}
              fontSize={11}
              color={pal.muted}
              wrap
            />
          </Column>
        </Row>
        <Row width={props.width - 32 * ui} height={40 * ui} gap={8 * ui}>
          <Button
            label="Play album"
            variant="primary"
            focusId="music:play-album"
            disabled={!tracks.length}
            onPress={() => props.onPlay(tracks)}
          />
          <Button label="Shuffle" disabled={!tracks.length} onPress={props.onShuffle} />
          <Button
            label="Add to queue"
            focusId="music:add-album-to-queue"
            disabled={!tracks.length}
            onPress={props.onEnqueue}
          />
        </Row>
      </ContentCard>
      <Label
        x={14 * ui}
        width={props.width - 28 * ui}
        height={26 * ui}
        text="TRACKS"
        fontSize={10}
        color={pal.muted}
        maxLines={1}
        overflow="ellipsis"
      />
      <Surface width={props.width} height={trackHeight} fill={pal.bg}>
        <TrackList
          width={props.width}
          height={trackHeight}
          tracks={tracks}
          selected={selected?.id ?? null}
          searching={props.searching}
          onSelect={props.onSelect}
          onPlay={props.onPlay}
        />
      </Surface>
      <Row width={props.width} height={42 * ui} padding={8 * ui} gap={8 * ui}>
        <Button
          label="Play selected"
          size="small"
          disabled={!selected}
          onPress={() => {
            if (selected) props.onPlay(tracks, tracks.indexOf(selected));
          }}
        />
        <Button
          label="Remove from library"
          size="small"
          disabled={!selected || props.busy}
          onPress={props.onRemove}
        />
      </Row>
    </ScrollColumn>
  );
}
