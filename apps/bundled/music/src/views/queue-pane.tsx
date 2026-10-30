import React, { type ReactNode } from "react";
import {
  Button,
  CollectionList,
  CollectionRow,
  Column,
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
import type { MusicPlayback } from "#music/controller";
import { artistName } from "#music/model";

const HEADER_HEIGHT = 86;

/** The play queue, with recovery actions when an entry cannot play or the queue cannot save. */
export function QueuePane(
  props: WindowSize & {
    player: MusicPlayback;
    selection: string | null;
    confirmingReload: boolean;
    onSelection: (id: string | null) => void;
    onConfirmReload: (confirming: boolean) => void;
    onClose: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  const { player } = props;
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel} clip>
      <Row width={props.width} height={52 * ui} padding={12 * ui} gap={8 * ui}>
        <Label
          width={Math.max(20 * ui, props.width - 84 * ui)}
          text="Queue"
          fontSize={18}
          fontWeight="medium"
        />
        <Button label="Close" size="small" onPress={props.onClose} />
      </Row>
      <Label
        x={14 * ui}
        y={54 * ui}
        width={props.width - 28 * ui}
        height={24 * ui}
        fontSize={11}
        color={pal.muted}
        text={`${Math.max(0, player.queue.length - player.index - 1)} tracks remaining`}
      />
      <ScrollColumn
        y={HEADER_HEIGHT * ui}
        width={props.width}
        height={Math.max(1, props.height - HEADER_HEIGHT * ui)}
        gap={8 * ui}
      >
        {player.state.kind === "error" && player.entry && (
          <Column width={props.width} padding={12 * ui} gap={8 * ui}>
            <Label text={`Cannot play this entry: ${player.state.message}`} fontSize={12} wrap />
            <Button
              label="Remove current entry"
              focusId="music:remove-unavailable"
              onPress={() => {
                if (player.entry) player.remove(player.entry.id);
              }}
            />
            {player.next && (
              <Button label="Next entry" focusId="music:skip-unavailable" onPress={player.next} />
            )}
          </Column>
        )}
        {player.stopped && player.entry && (
          <Column width={props.width} padding={12 * ui} gap={8 * ui}>
            <Label
              text={player.restored ? "Saved queue · Playback is stopped" : "Playback is stopped"}
              fontSize={11}
              color={pal.muted}
              wrap
            />
            <Button
              label={`Resume at ${formatPlaybackTime(player.position)}`}
              focusId="music:resume-queue"
              variant="primary"
              onPress={player.togglePause}
            />
          </Column>
        )}
        {(player.queueSaveError || player.queueSaveWarning) && (
          <Column width={props.width} padding={12 * ui} gap={8 * ui}>
            <Label
              text={
                player.queueSaveError
                  ? `Queue not saved: ${player.queueSaveError}`
                  : `Queue saved; cleanup pending: ${player.queueSaveWarning}`
              }
              fontSize={12}
              wrap
            />
            <Button
              label="Retry save"
              focusId="music:retry-queue-save"
              onPress={player.retrySave}
            />
            <Button
              label="Reload saved queue…"
              focusId="music:reload-queue"
              onPress={() => props.onConfirmReload(true)}
            />
            {props.confirmingReload && (
              <>
                <Label
                  text="Discard this window's queue draft and stop playback?"
                  fontSize={12}
                  wrap
                />
                <Button
                  label="Discard draft and reload"
                  focusId="music:confirm-reload-queue"
                  onPress={() => {
                    player.reloadSavedQueue();
                    props.onConfirmReload(false);
                    props.onSelection(null);
                  }}
                />
                <Button
                  label="Keep draft"
                  focusId="music:cancel-reload-queue"
                  onPress={() => props.onConfirmReload(false)}
                />
              </>
            )}
          </Column>
        )}
        <CollectionList
          width={props.width}
          height={Math.max(1, props.height - 186 * ui)}
          items={player.queue}
          getKey={(entry) => entry.id}
          selectedKey={props.selection ?? player.entry?.id}
          onSelect={(entry) => props.onSelection(entry.id)}
          onActivate={(entry) => player.jump(player.queue.indexOf(entry))}
          focusId="music:queue"
          emptyMessage="Queue is empty. Play an album or add tracks."
          rowHeight={72 * ui}
          renderItem={(entry, state) => (
            <CollectionRow
              {...state}
              title={entry.track.title}
              subtitle={`${entry === player.entry ? "Current · " : ""}${artistName(entry.track.artist)}`}
              metadata={entry.track.duration ? formatPlaybackTime(entry.track.duration) : "—"}
              leading={
                entry.track.artwork ? (
                  <ImageWidget
                    width={40 * ui}
                    height={40 * ui}
                    src={entry.track.artwork}
                    fit="cover"
                  />
                ) : undefined
              }
            />
          )}
        />
        <Column x={12 * ui} width={props.width - 24 * ui} height={86 * ui} gap={6 * ui}>
          <Button
            label="Remove selected"
            focusId="music:remove-queue-selected"
            size="small"
            disabled={
              !props.selection || !player.queue.some((entry) => entry.id === props.selection)
            }
            onPress={() => {
              if (props.selection) player.remove(props.selection);
              props.onSelection(null);
            }}
          />
          <Button
            label="Clear upcoming"
            size="small"
            disabled={player.queue.length <= player.index + 1}
            onPress={player.clearUpcoming}
          />
        </Column>
      </ScrollColumn>
    </Surface>
  );
}
