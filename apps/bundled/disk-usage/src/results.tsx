/** A scanned folder: its size, how to show and order its items, and the items themselves. */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  CollectionList,
  Horizontal,
  Label,
  SegmentedControl,
  Surface,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { formatBytes } from "@moire/app-tools";
import type { UsageNode } from "./backend";
import type { Sort, View } from "./model";
import { USAGE_ROW_HEIGHT, UsageRow } from "./usage-row";

const PAD = 16;
const HEADER = 52;
const OPTIONS = 40;
const VIEW_WIDTH = 220;
const SORT_WIDTH = 140;

export function Results(props: {
  width: number;
  height: number;
  current: UsageNode;
  items: readonly UsageNode[];
  view: View;
  sort: Sort;
  selected: string | null;
  filtered: boolean;
  onView: (view: View) => void;
  onSort: (sort: Sort) => void;
  onSelect: (item: UsageNode) => void;
  onActivate: (item: UsageNode) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const pad = PAD * ui;
  const width = Math.max(1, props.width - pad * 2);
  const listY = pad + HEADER * ui + OPTIONS * ui;
  const listH = Math.max(USAGE_ROW_HEIGHT * ui, props.height - listY - pad);
  const files = props.current.children.length;
  return (
    <Box width={props.width} height={props.height}>
      <Label
        x={pad}
        y={pad}
        width={Math.max(1, width - 140 * ui)}
        height={28 * ui}
        text={props.current.name}
        fontSize={18}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <Label
        x={pad + width - 140 * ui}
        y={pad}
        width={140 * ui}
        height={28 * ui}
        text={formatBytes(props.current.allocated)}
        fontSize={18}
        fontWeight="medium"
        horizontalAlign="end"
      />
      <Label
        x={pad}
        y={pad + 28 * ui}
        width={width}
        height={18 * ui}
        text={`${files} ${files === 1 ? "item" : "items"} · ${formatBytes(props.current.logical)} of file data`}
        fontSize={12}
        color={pal.muted}
        maxLines={1}
        overflow="ellipsis"
      />
      <Horizontal
        x={pad}
        y={pad + HEADER * ui}
        width={width}
        height={32 * ui}
        gap={8 * ui}
        align="center"
      >
        <SegmentedControl
          width={Math.min(VIEW_WIDTH * ui, width * 0.55)}
          height={32 * ui}
          value={props.view}
          options={[
            { id: "contents", label: "Contents" },
            { id: "largest", label: "Largest files" },
          ]}
          onChange={(value) => props.onView(value as View)}
        />
        <Box flexGrow={1} height={1} />
        <SegmentedControl
          width={Math.min(SORT_WIDTH * ui, width * 0.4)}
          height={32 * ui}
          value={props.sort}
          options={[
            { id: "size", label: "Size" },
            { id: "name", label: "Name" },
          ]}
          onChange={(value) => props.onSort(value as Sort)}
        />
      </Horizontal>
      <Surface
        x={pad}
        y={listY}
        width={width}
        height={listH}
        fill={pal.surface}
        radius={12 * ui}
        stroke={pal.borderSubtle}
        strokeWidth={1}
        clip
      >
        <CollectionList
          x={4 * ui}
          y={4 * ui}
          width={width - 8 * ui}
          height={listH - 8 * ui}
          items={props.items}
          getKey={(item) => item.path}
          selectedKey={props.selected}
          onSelect={props.onSelect}
          onActivate={props.onActivate}
          focusId="usage:list"
          rowHeight={USAGE_ROW_HEIGHT * ui}
          emptyMessage={
            props.filtered
              ? "Nothing here matches the filter."
              : props.view === "largest"
                ? "There are no files under this folder."
                : "This folder is empty."
          }
          renderItem={(item, row) => (
            <UsageRow
              width={row.width}
              height={row.height}
              item={item}
              total={props.current.allocated}
              selected={row.selected}
              location={
                props.view === "largest"
                  ? path.relative(props.current.path, path.dirname(item.path)) || undefined
                  : undefined
              }
            />
          )}
        />
      </Surface>
    </Box>
  );
}
