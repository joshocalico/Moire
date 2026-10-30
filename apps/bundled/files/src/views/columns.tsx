/**
 * Miller columns from Home down to the current folder, each 220px, with the way down
 * highlighted, and a preview of the selection in the last column. Below 760px only the last
 * two columns show. Choosing a folder opens it as the deepest column.
 */
import React, { useState, type ReactNode } from "react";
import {
  Box,
  CollectionItem,
  EmptyState,
  Icon,
  ScrollArea,
  Separator,
  Surface,
  TextBlock,
  foregroundOn,
  getUiScaleFactor,
  usePalette,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/ui";
import type { Entry } from "#files/filesystem";
import type { InspectorActions } from "#files/inspector-actions";
import { entryKind, kindIcon, kindTint } from "#files/kind-style";
import { entryFocusId } from "#files/model";
import type { ColumnListing } from "#files/use-columns";
import { ColumnsPreviewPane } from "./inspector/columns-pane";

const COLUMN_WIDTH = 220;
const ITEM_HEIGHT = 32;
const ITEM_PITCH = 34;
const PREVIEW_MIN = 240;
/** Narrower than this, the preview column gives way to the two columns. */
const PREVIEW_NARROW_MIN = 180;
/** Narrower than this, only the last two columns show. */
const NARROW = 760;
const OVERSCAN = 6;

type ColumnsProps = {
  width: number;
  height: number;
  /** Ancestors first; the last is the current folder. */
  columns: readonly ColumnListing[];
  /** The current folder's own listing, kept live by the page. */
  current: readonly Entry[];
  selectedKey: string | null;
  focusEntries: boolean;
  refresh: number;
  isSelected(file: string): boolean;
  onOpenFolder(directory: string): void;
  onSelect(entry: Entry, event?: HitPointerEvent): void;
  /** Select a file in an ancestor's column: open that folder with the file selected. */
  onReveal(entry: Entry): void;
  onOpen(entry: Entry): void;
  onContextMenu(entry: Entry, event: HitPointerEvent): void;
  onKey(entry: Entry, event: HitKeyEvent): boolean;
  onFocusEntry(entry: Entry): void;
  /** What the preview pane's controls do. */
  inspector: InspectorActions;
};

/** How many columns show, how wide each is, and whether the preview fits beside them. */
function columnsLayout(width: number, total: number) {
  const ui = getUiScaleFactor();
  const column = Math.round(COLUMN_WIDTH * ui);
  if (width >= NARROW * ui) {
    const count = Math.min(total, Math.max(1, Math.floor((width - PREVIEW_MIN * ui) / column)));
    return { count, column, preview: true };
  }
  // Narrow: the last two columns; the preview only if it still has room.
  const count = Math.min(total, 2);
  if (width - count * column >= PREVIEW_NARROW_MIN * ui) return { count, column, preview: true };
  return { count, column: Math.floor(width / count), preview: false };
}

function ColumnItem(props: {
  width: number;
  entry: Entry;
  /** On the way down to the current folder, or selected in it. */
  marked: boolean;
  /** Selected in the deepest column: drawn in the accent. */
  strong: boolean;
  focusId: string;
  autoFocus: boolean;
  onPress(event?: HitPointerEvent): void;
  onDoublePress(): void;
  onContextMenu(event: HitPointerEvent): void;
  onKeyDown?(event: HitKeyEvent): boolean;
  onFocus?(): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const height = px(ITEM_HEIGHT);
  const kind = entryKind(props.entry);
  const fill = props.strong ? pal.accent : props.marked ? pal.selection : 0x00000000;
  const ink = props.strong ? foregroundOn(pal.accent) : pal.text;
  return (
    <CollectionItem
      width={props.width}
      height={height}
      focusId={props.focusId}
      autoFocus={props.autoFocus}
      onFocusChange={(focused) => focused && props.onFocus?.()}
      onPress={props.onPress}
      onDoublePress={props.onDoublePress}
      onContextMenu={props.onContextMenu}
      onKeyDown={props.onKeyDown}
    >
      <Surface width={props.width} height={height} radius={px(8)} fill={fill} />
      <Icon
        x={px(10)}
        y={Math.round((height - px(16)) / 2)}
        name={kindIcon(kind)}
        size={px(16)}
        color={props.strong ? ink : kindTint(kind, pal)}
        symbolic
      />
      <TextBlock
        x={px(34)}
        width={Math.max(1, props.width - px(34) - px(props.entry.isDir ? 30 : 8))}
        height={height}
        text={props.entry.name}
        color={ink}
        fontSize={13}
        fontWeight={props.marked ? "medium" : "regular"}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {props.entry.isDir ? (
        <Icon
          x={props.width - px(24)}
          y={Math.round((height - px(12)) / 2)}
          name="chevron-right"
          size={px(12)}
          color={props.marked ? ink : pal.muted}
          symbolic
        />
      ) : null}
    </CollectionItem>
  );
}

function Column(props: {
  width: number;
  height: number;
  entries: readonly Entry[];
  error: string | null;
  render(entry: Entry, width: number): ReactNode;
  /** Kept in view: the marked or focused item. */
  anchor: string | null;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pitch = Math.round(ITEM_PITCH * ui);
  const inset = Math.round(6 * ui);
  const [scrollY, setScrollY] = useState(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.anchor);
    return index < 0 ? 0 : Math.max(0, (index + 1) * pitch - props.height / 2);
  });
  if (props.error)
    return (
      <EmptyState
        width={props.width}
        height={props.height}
        icon="folder"
        title="Cannot open"
        message={props.error}
      />
    );
  const contentHeight = props.entries.length * pitch + inset * 2;
  const first = Math.max(0, Math.floor(scrollY / pitch) - OVERSCAN);
  const last = Math.min(
    props.entries.length,
    Math.ceil((scrollY + props.height) / pitch) + OVERSCAN,
  );
  const anchorIndex = props.entries.findIndex((entry) => entry.path === props.anchor);
  const shown = props.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => (index >= first && index < last) || index === anchorIndex);
  return (
    <ScrollArea
      width={props.width}
      height={props.height}
      contentHeight={contentHeight}
      scrollY={scrollY}
      onScroll={setScrollY}
      smooth={false}
      fill={0x00000000}
    >
      {shown.map(({ entry, index }) => (
        <Box
          key={entry.path}
          x={inset}
          y={inset + index * pitch}
          width={props.width - inset * 2}
          height={pitch}
        >
          {props.render(entry, props.width - inset * 2)}
        </Box>
      ))}
    </ScrollArea>
  );
}

export function ColumnsView(props: ColumnsProps): ReactNode {
  const layout = columnsLayout(props.width, props.columns.length);
  const columnWidth = layout.column;
  const count = layout.count;
  const shown = props.columns.slice(props.columns.length - count);
  const deepest = props.columns.length - 1;
  const previewX = shown.length * columnWidth;
  const selected =
    props.current.find(
      (entry) => entry.path === props.selectedKey && props.isSelected(entry.path),
    ) ?? null;
  return (
    <Box width={props.width} height={props.height}>
      {shown.map((column, offset) => {
        const index = props.columns.length - count + offset;
        const last = index === deepest;
        const next = props.columns[index + 1]?.directory ?? null;
        const entries = last ? props.current : column.entries;
        return (
          <Box
            key={column.directory}
            x={offset * columnWidth}
            width={columnWidth}
            height={props.height}
          >
            <Column
              width={columnWidth - 1}
              height={props.height}
              entries={entries}
              error={last ? null : column.error}
              anchor={last ? props.selectedKey : next}
              render={(entry, width) =>
                last ? (
                  <ColumnItem
                    width={width}
                    entry={entry}
                    marked={props.isSelected(entry.path)}
                    strong={props.isSelected(entry.path)}
                    focusId={entryFocusId(entry.path)}
                    autoFocus={props.focusEntries && props.selectedKey === entry.path}
                    onFocus={() => props.onFocusEntry(entry)}
                    // A folder opens as the next column; a file shows in the preview.
                    onPress={(event) =>
                      entry.isDir && !event?.ctrlKey && !event?.shiftKey && !event?.metaKey
                        ? props.onOpenFolder(entry.path)
                        : props.onSelect(entry, event)
                    }
                    onDoublePress={() => props.onOpen(entry)}
                    onContextMenu={(event) => props.onContextMenu(entry, event)}
                    onKeyDown={(event) => props.onKey(entry, event)}
                  />
                ) : (
                  <ColumnItem
                    width={width}
                    entry={entry}
                    marked={entry.path === next}
                    strong={false}
                    focusId={`column:${entry.path}`}
                    autoFocus={false}
                    onPress={() =>
                      entry.isDir ? props.onOpenFolder(entry.path) : props.onReveal(entry)
                    }
                    onDoublePress={() => props.onOpen(entry)}
                    onContextMenu={(event) => props.onContextMenu(entry, event)}
                  />
                )
              }
            />
            <Separator x={columnWidth - 1} width={1} height={props.height} />
          </Box>
        );
      })}
      {layout.preview ? (
        <Box x={previewX} width={Math.max(1, props.width - previewX)} height={props.height}>
          <ColumnsPreviewPane
            width={Math.max(1, props.width - previewX)}
            height={props.height}
            entry={selected}
            refresh={props.refresh}
            actions={props.inspector}
          />
        </Box>
      ) : null}
    </Box>
  );
}
