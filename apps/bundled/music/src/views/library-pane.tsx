import React, { type ReactNode } from "react";
import {
  Button,
  CollectionList,
  CollectionRow,
  Icon,
  ImageWidget,
  Label,
  Row,
  ScrollColumn,
  Surface,
  TextField,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import type { Track } from "#music/library";
import {
  artistKey,
  artistName,
  contentTracks,
  type Album,
  type Browse,
  type Content,
} from "#music/model";
import { AlbumDetail } from "./album-detail";
import { TrackList } from "./track-list";

const TOOLBAR_HEIGHT = 54;

/** The middle pane: back or view name with search, then albums, artists, an album or tracks. */
export function LibraryPane(
  props: WindowSize & {
    browse: Browse;
    content: Content;
    /** False shows the import invitation instead of an empty list. */
    hasLibrary: boolean;
    busy: boolean;
    selected: Track | undefined;
    /** Replaces the content below the toolbar, e.g. the import panel. */
    sheet?: (size: WindowSize & { y: number }) => ReactNode;
    onQuery: (query: string) => void;
    onBack: () => void;
    onImport: () => void;
    onOpenAlbum: (album: Album) => void;
    onHighlight: (key: string) => void;
    onOpenArtist: (artist: string) => void;
    onSelectTrack: (track: Track) => void;
    onPlay: (tracks: readonly Track[], start?: number) => void;
    onShuffle: (tracks: readonly Track[]) => void;
    onEnqueue: (tracks: readonly Track[], showQueue: boolean) => void;
    onRemove: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  const { browse, content } = props;
  const top = TOOLBAR_HEIGHT * ui;
  const body = { y: top, width: props.width, height: props.height - top };
  const highlighted = browse.detail.kind === "list" ? browse.detail.highlight : null;
  const searching = !!browse.query;
  const tracks = contentTracks(content);
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg} clip>
      <Row width={props.width} height={top} padding={12 * ui} gap={10 * ui} align="center">
        {content.kind === "album" || browse.detail.kind === "artist" ? (
          <Button
            label={content.kind === "album" ? "Albums" : "Artists"}
            variant="ghost"
            size="small"
            leadingIcon={<Icon name="back" symbolic size={16} />}
            focusId="music:back"
            onPress={props.onBack}
          />
        ) : (
          <Label
            width={Math.max(72 * ui, props.width * 0.3)}
            text={browse.view}
            fontSize={12}
            color={pal.muted}
            maxLines={1}
            overflow="ellipsis"
          />
        )}
        <TextField
          width={Math.max(80 * ui, props.width * 0.7 - 40 * ui)}
          height={32 * ui}
          value={browse.query}
          onChange={props.onQuery}
          placeholder="Search your library"
        />
      </Row>
      {props.sheet ? (
        props.sheet(body)
      ) : !props.hasLibrary ? (
        <ScrollColumn {...body} padding={24 * ui} gap={16 * ui}>
          <Label text="Import your music" fontSize={28} fontWeight="medium" wrap />
          <Label
            text="Import an album or your music folder to browse artists and tracks. Music reads local tags and duration, and keeps a library between sessions."
            fontSize={14}
            wrap
          />
          <Button
            label="Import music…"
            focusId="music:empty-import"
            disabled={props.busy}
            variant="primary"
            onPress={props.onImport}
          />
        </ScrollColumn>
      ) : content.kind === "album" ? (
        <AlbumDetail
          key={`album:${content.album.id}`}
          {...body}
          height={Math.max(1, body.height)}
          album={content.album}
          tracks={content.tracks}
          selected={props.selected}
          searching={searching}
          busy={props.busy}
          onSelect={props.onSelectTrack}
          onPlay={props.onPlay}
          onShuffle={() => props.onShuffle(content.tracks)}
          onEnqueue={() => props.onEnqueue(content.tracks, true)}
          onRemove={props.onRemove}
        />
      ) : content.kind === "albums" ? (
        <CollectionList
          x={8 * ui}
          {...body}
          width={props.width - 16 * ui}
          items={content.albums}
          getKey={(album) => album.id}
          selectedKey={highlighted}
          rowHeight={76 * ui}
          // A click opens the album; arrow keys only move the highlight, Enter opens.
          onSelect={(album, source) =>
            source === "pointer" ? props.onOpenAlbum(album) : props.onHighlight(album.id)
          }
          onActivate={props.onOpenAlbum}
          focusId="music:albums"
          emptyMessage="No albums match your search"
          renderItem={(album, state) => (
            <CollectionRow
              {...state}
              title={album.title}
              subtitle={`${artistName(album.artist)} · ${album.tracks.length} tracks`}
              leading={
                album.artwork ? (
                  <ImageWidget width={40 * ui} height={40 * ui} src={album.artwork} fit="cover" />
                ) : undefined
              }
            />
          )}
        />
      ) : content.kind === "artists" ? (
        <CollectionList
          {...body}
          items={content.artists}
          getKey={(artist) => artistKey(artist.name)}
          selectedKey={highlighted}
          onSelect={(artist, source) =>
            source === "pointer"
              ? props.onOpenArtist(artist.name)
              : props.onHighlight(artistKey(artist.name))
          }
          onActivate={(artist) => props.onOpenArtist(artist.name)}
          focusId="music:artists"
          renderItem={(artist, state) => (
            <CollectionRow
              {...state}
              title={artistName(artist.name)}
              subtitle={`${artist.count} tracks`}
            />
          )}
        />
      ) : (
        <Surface {...body} fill={pal.bg}>
          <Row width={props.width} height={46 * ui} padding={8 * ui} gap={8 * ui}>
            <Button
              label="Play all"
              size="small"
              disabled={!tracks.length}
              onPress={() => props.onPlay(tracks)}
            />
            <Button
              label="Add to queue"
              focusId="music:add-view-to-queue"
              size="small"
              disabled={!tracks.length}
              onPress={() => props.onEnqueue(tracks, false)}
            />
            <Button
              label="Remove selected"
              size="small"
              disabled={!props.selected || props.busy}
              focusId="music:remove-selected"
              onPress={props.onRemove}
            />
          </Row>
          <Surface
            y={46 * ui}
            width={props.width}
            height={Math.max(1, props.height - 100 * ui)}
            fill={pal.bg}
          >
            <TrackList
              width={props.width}
              height={props.height - 100 * ui}
              tracks={tracks}
              selected={props.selected?.id ?? null}
              searching={searching}
              onSelect={props.onSelectTrack}
              onPlay={props.onPlay}
            />
          </Surface>
        </Surface>
      )}
    </Surface>
  );
}
