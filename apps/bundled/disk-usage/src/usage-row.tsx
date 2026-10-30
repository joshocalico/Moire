/** One measured item: its name, a bar for its share of the folder, and its size. */
import React, { type ReactNode } from "react";
import { Icon, Label, ListItem, Surface, getUiScaleFactor, usePalette } from "@moire/ui";
import { formatBytes } from "@moire/app-tools";
import { percent } from "./model";
import type { UsageNode } from "./backend";

export const USAGE_ROW_HEIGHT = 52;
const ICON = 20;
const SIZE_WIDTH = 92;
const CHEVRON = 16;
const BAR = 6;

export function UsageRow(props: {
  width: number;
  height: number;
  item: UsageNode;
  total: number;
  selected: boolean;
  /** Shown instead of the name in "Largest files", where items come from many folders. */
  location?: string;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const directory = props.item.kind === "directory";
  const pad = 12 * ui;
  const textX = pad + ICON * ui + 10 * ui;
  const sizeW = SIZE_WIDTH * ui;
  const barW = Math.max(1, props.width - textX - sizeW - CHEVRON * ui - pad - 12 * ui);
  const share = props.total ? props.item.allocated / props.total : 0;
  const barY = props.height - 15 * ui;
  return (
    <Surface width={props.width} height={props.height} fill={0x00000000}>
      <ListItem
        width={props.width}
        height={props.height}
        title=""
        selected={props.selected}
        interactive={false}
      />
      <Icon
        x={pad}
        y={(props.height - ICON * ui) / 2}
        name={directory ? "folder-filled" : "file"}
        size={ICON * ui}
        color={directory ? pal.accent : pal.muted}
        symbolic
      />
      <Label
        x={textX}
        y={8 * ui}
        width={barW}
        height={20 * ui}
        text={
          (props.item.kind === "symlink" ? `${props.item.name} (link)` : props.item.name) +
          (props.location ? `  ·  ${props.location}` : "")
        }
        fontSize={13}
        maxLines={1}
        overflow="ellipsis"
      />
      <Surface
        x={textX}
        y={barY}
        width={barW}
        height={BAR * ui}
        radius={(BAR / 2) * ui}
        fill={pal.borderSubtle}
      />
      {share > 0 ? (
        <Surface
          x={textX}
          y={barY}
          width={Math.max(BAR * ui, barW * share)}
          height={BAR * ui}
          radius={(BAR / 2) * ui}
          fill={directory ? pal.accent : pal.muted}
        />
      ) : null}
      <Label
        x={props.width - pad - CHEVRON * ui - 8 * ui - sizeW}
        y={8 * ui}
        width={sizeW}
        height={20 * ui}
        text={formatBytes(props.item.allocated)}
        fontSize={12}
        fontFamily="mono"
        horizontalAlign="end"
      />
      <Label
        x={props.width - pad - CHEVRON * ui - 8 * ui - sizeW}
        y={props.height - 22 * ui}
        width={sizeW}
        height={18 * ui}
        text={percent(props.item.allocated, props.total)}
        fontSize={11}
        color={pal.muted}
        horizontalAlign="end"
      />
      {directory ? (
        <Icon
          x={props.width - pad - CHEVRON * ui}
          y={(props.height - CHEVRON * ui) / 2}
          name="chevron-right"
          size={CHEVRON * ui}
          color={pal.muted}
          symbolic
        />
      ) : null}
    </Surface>
  );
}
