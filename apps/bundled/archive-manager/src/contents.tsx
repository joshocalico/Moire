/** An archive's contents as a tree, with the edit actions above it. */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  CollectionList,
  Horizontal,
  Icon,
  ListItem,
  TextBlock,
  getUiScaleFactor,
  Vertical,
  usePalette,
} from "@moire/ui";
import { Card, ToolButton, cardContent, type ToolIconName } from "@moire/app-tools";
import { entryTag, type Entry } from "./model";

const ROW_HEIGHT = 32;
const INDENT = 16;
const MAX_DEPTH = 8;
const BAR_HEIGHT = 36;
const NOTE_HEIGHT = 34;

export type EditAction = {
  id: string;
  label: string;
  icon: ToolIconName;
  disabled?: boolean;
  onPress: () => void;
};

export function Contents(props: {
  width: number;
  height: number;
  entries: readonly Entry[];
  selected: string | null;
  actions: readonly EditAction[];
  /** Why editing is unavailable, or the last edit problem. */
  note: string | null;
  noteTone: "muted" | "danger";
  onSelect: (path: string) => void;
  onRename: (path: string) => void;
  onRemove: (path: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const inner = cardContent(props.width, props.height).width;
  const body = cardContent(props.width, props.height).height;
  const noteH = props.note ? NOTE_HEIGHT * ui : 0;
  const listH = Math.max(ROW_HEIGHT * ui, body - BAR_HEIGHT * ui - 8 * ui - noteH);
  const folders = props.entries.filter((entry) => entry.folder).length;
  return (
    <Card
      width={props.width}
      height={props.height}
      title="Contents"
      aside={
        <TextBlock
          text={`${props.entries.length - folders} files · ${folders} folders`}
          color={pal.muted}
          fontSize={12}
          maxLines={1}
        />
      }
    >
      <Vertical width={inner} gap={0}>
        <Box width={inner} height={BAR_HEIGHT * ui}>
          <ActionBar width={inner} actions={props.actions} />
        </Box>
        <Box width={inner} height={8 * ui} />
        {props.note ? (
          <TextBlock
            width={inner}
            height={noteH}
            text={props.note}
            color={props.noteTone === "danger" ? pal.danger : pal.muted}
            fontSize={12}
            wrap
            maxLines={2}
            overflow="ellipsis"
            verticalAlign="center"
          />
        ) : null}
        <CollectionList
          width={inner}
          height={listH}
          items={props.entries}
          getKey={(entry) => entry.path}
          selectedKey={props.selected}
          onSelect={(entry) => props.onSelect(entry.path)}
          onActivate={(entry) => props.onRename(entry.path)}
          onDelete={(entry) => props.onRemove(entry.path)}
          focusId="archive:contents"
          rowHeight={ROW_HEIGHT * ui}
          emptyMessage="Nothing here yet. Add files or folders to fill this archive."
          renderItem={(entry, row) => (
            <EntryRow entry={entry} width={row.width} height={row.height} selected={row.selected} />
          )}
        />
      </Vertical>
    </Card>
  );
}

/**
 * Edit actions as labelled buttons when they fit, and as icon buttons with tooltips when the
 * window is too narrow for the labels.
 */
function ActionBar(props: { width: number; actions: readonly EditAction[] }): ReactNode {
  const ui = getUiScaleFactor();
  const gap = 6 * ui;
  // An estimate of each label's button width; labels are short, so this only decides the mode.
  const labelled = props.actions.reduce(
    (sum, action) => sum + (action.label.length * 7.2 + 28) * ui + gap,
    0,
  );
  const wide = labelled <= props.width;
  return (
    <Horizontal width={props.width} height={BAR_HEIGHT * ui} gap={gap} align="center">
      {props.actions.map((action) =>
        wide ? (
          <Button
            key={action.id}
            height={32 * ui}
            label={action.label}
            variant="secondary"
            focusId={`archive:${action.id}`}
            disabled={action.disabled}
            onPress={action.onPress}
          />
        ) : (
          <ToolButton
            key={action.id}
            icon={action.icon}
            tooltip={action.label}
            focusId={`archive:${action.id}`}
            disabled={action.disabled}
            onPress={action.onPress}
          />
        ),
      )}
    </Horizontal>
  );
}

function EntryRow(props: {
  entry: Entry;
  width: number;
  height: number;
  selected: boolean;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const depth = Math.min(props.entry.path.split("/").length - 1, MAX_DEPTH);
  const tag = entryTag(props.entry);
  const tagW = tag ? 64 * ui : 0;
  const indent = 10 * ui + depth * INDENT * ui;
  return (
    <Box width={props.width} height={props.height}>
      <ListItem
        width={props.width}
        height={props.height}
        title=""
        selected={props.selected}
        interactive={false}
      />
      <Horizontal
        x={indent}
        width={Math.max(1, props.width - indent - 10 * ui)}
        height={props.height}
        gap={8 * ui}
        align="center"
      >
        <Box width={16 * ui} height={16 * ui} flexShrink={0}>
          <Icon
            name={props.entry.folder ? "folder" : "file"}
            size={16 * ui}
            color={props.entry.folder ? pal.accent : pal.muted}
            symbolic
          />
        </Box>
        <TextBlock
          flexGrow={1}
          text={path.posix.basename(props.entry.path)}
          fontSize={13}
          maxLines={1}
          overflow="ellipsis"
        />
        {tag ? (
          <TextBlock
            width={tagW}
            text={tag}
            color={pal.accent}
            fontSize={11}
            horizontalAlign="end"
            maxLines={1}
          />
        ) : null}
      </Horizontal>
    </Box>
  );
}
