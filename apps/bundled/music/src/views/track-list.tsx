import React, { type ReactNode } from "react";
import { CollectionList, CollectionRow, formatPlaybackTime, getUiScaleFactor } from "@moire/ui";
import type { Track } from "#music/library";

const ROW_HEIGHT = 44;

/** Numbered tracks; Enter or double-click plays from that track. */
export function TrackList(props: {
  width: number;
  height: number;
  tracks: readonly Track[];
  selected: string | null;
  searching: boolean;
  onSelect: (track: Track) => void;
  onPlay: (tracks: readonly Track[], start: number) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { tracks } = props;
  return (
    <CollectionList
      width={props.width}
      height={Math.max(1, props.height)}
      items={tracks}
      getKey={(track) => track.id}
      rowHeight={ROW_HEIGHT * ui}
      selectedKey={props.selected}
      onSelect={props.onSelect}
      onActivate={(track) =>
        props.onPlay(
          tracks,
          tracks.findIndex((item) => item.id === track.id),
        )
      }
      focusId="music:tracks"
      emptyMessage={props.searching ? "No tracks match your search" : "No tracks in this view"}
      renderItem={(track, state) => (
        <CollectionRow
          {...state}
          title={`${track.number || tracks.indexOf(track) + 1}   ${track.title}`}
          metadata={track.duration ? formatPlaybackTime(track.duration) : "—"}
        />
      )}
    />
  );
}
