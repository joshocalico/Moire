/** A 46px file row: picture, name over caption, and the date or the row's actions on hover. */
import React, { useState, type ReactNode } from "react";
import {
  Box,
  CollectionItem,
  HoverActions,
  Surface,
  TextBlock,
  getUiScaleFactor,
  hoverActionsWidth,
  mixColor,
  usePalette,
  type CollectionItemProps,
  type HoverAction,
} from "@moire/ui";
import { Thumbnail, type ThumbnailEntry } from "./thumbnail";

const ROW_HEIGHT = 46;
/** Rows sit this far apart. */
export const ROW_PITCH = 50;
const PICTURE = 36;
const TRAILING = 150;

/** What every item on a page shares with its CollectionItem: focus, presses, menus, drag and drop. */
export type ItemInteraction = Omit<
  CollectionItemProps,
  "x" | "y" | "width" | "height" | "children"
>;

export function FileRow(props: {
  y?: number;
  width: number;
  entry: ThumbnailEntry;
  caption: string;
  trailing: string;
  actions: readonly HoverAction[];
  selected: boolean;
  /** Highlighted without being selected: the active search result. */
  highlighted?: boolean;
  interaction: ItemInteraction;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const [hovered, setHovered] = useState(false);
  const height = px(ROW_HEIGHT);
  const picture = px(PICTURE);
  const slot = Math.min(
    Math.max(px(TRAILING), hoverActionsWidth(props.actions.length)),
    Math.max(px(60), props.width / 2),
  );
  const textX = px(56);
  const textWidth = Math.max(1, props.width - textX - slot - px(16));
  const fill = props.selected
    ? pal.selection
    : props.highlighted
      ? mixColor(pal.bg, pal.selection, 0.6)
      : hovered
        ? pal.surface
        : 0x00000000;
  return (
    <Box y={props.y ?? 0} width={props.width} height={height}>
      <CollectionItem
        width={props.width}
        height={height}
        {...props.interaction}
        onHoverChange={(next) => {
          setHovered(next);
          props.interaction.onHoverChange?.(next);
        }}
      >
        <Surface width={props.width} height={height} radius={px(10)} fill={fill} />
        <Box x={px(8)} y={Math.round((height - picture) / 2)} width={picture} height={picture}>
          <Thumbnail
            entry={props.entry}
            width={picture}
            radius={px(8)}
            backdrop={props.selected ? pal.selection : pal.bg}
          />
        </Box>
        <TextBlock
          x={textX}
          y={px(5)}
          width={textWidth}
          height={px(20)}
          text={props.entry.name}
          fontSize={13}
          fontWeight="medium"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
        <TextBlock
          x={textX}
          y={px(24)}
          width={textWidth}
          height={px(16)}
          text={props.caption}
          color={pal.muted}
          fontSize={11}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      </CollectionItem>
      <HoverActions
        x={props.width - slot - px(12)}
        y={px(7)}
        width={slot}
        height={px(32)}
        // Keyboard users have shortcuts and the menu; the date stays on the focused row.
        active={hovered}
        trailing={props.trailing}
        actions={props.actions}
      />
    </Box>
  );
}
