/** A grid tile for a file or folder: thumbnail or kind icon, then its name and detail. */
import React, { useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { foregroundOn, mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { DndFeedback, type DragSourceOptions } from "./dnd";
import { Icon, type IconName } from "./icon";
import { CollectionItem } from "./interaction";
import { registerIntrinsicSize } from "./layout";
import { TextBlock, measureWrappedText } from "./primitives";

export type FileTileProps = {
  x?: number;
  y?: number;
  /** Side of the square tile; 128 by default. The name and detail go below it. */
  width?: number;
  name: string;
  detail?: string;
  /** Image preview filling the tile, drawn by the caller at the given size. */
  thumbnail?: ReactNode | ((size: { width: number; height: number }) => ReactNode);
  /** Shown without a thumbnail; "file" by default. */
  icon?: IconName;
  /** Kind colour for the icon and its extension badge; the accent by default. */
  tint?: number;
  /** Short type label on a badge under the icon, e.g. "PDF". */
  extension?: string;
  /** Lines the name may take before it ends in an ellipsis; 2 by default. */
  nameLines?: 1 | 2;
  selected?: boolean;
  /** Force the hover look, e.g. for previews; the pointer drives it otherwise. */
  hovered?: boolean;
  /** Force the focus ring, for hosts that track focus themselves. */
  focused?: boolean;
  /** Force the drop-target highlight; `dropData` drives it during a real drag. */
  dropTarget?: boolean;
  disabled?: boolean;
  /** Accept drops onto this tile (a folder); exposed through `hitTestDropData`. */
  dropData?: unknown;
  dragSource?: Omit<DragSourceOptions, "width" | "height">;
  focusId?: string;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  /** Return true after handling a key to suppress Enter/Space activation. */
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  onPress?: (event?: HitPointerEvent) => void;
  /** Double click, or Enter. */
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
};

const TILE = 128;
const NAME_SIZE = 12;
const NAME_LINE = 17;
const DETAIL_LINE = 15;
const LABEL_GAP = 6;

/** The tile's full height for a width (scaled default when omitted), name lines and detail. */
export function fileTileHeight(
  props: Pick<FileTileProps, "width" | "nameLines" | "detail">,
): number {
  const ui = getUiScaleFactor();
  const width = props.width ?? TILE * ui;
  return Math.ceil(
    width +
      (LABEL_GAP + (props.nameLines ?? 2) * NAME_LINE + (props.detail ? DETAIL_LINE : 0) + 4) * ui,
  );
}

export function FileTile(props: FileTileProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const [pointerOver, setPointerOver] = useState(false);
  const width = props.width ?? TILE * ui;
  const height = fileTileHeight(props);
  const hovered = props.hovered ?? pointerOver;
  const tint = props.tint ?? pal.accentLine;
  const radius = 12 * ui;
  const fill = props.selected
    ? pal.selection
    : hovered
      ? mixColor(pal.surface, pal.hover, 0.7)
      : pal.surface;
  const inset = 6 * ui;
  const folder = props.icon === "folder" || props.icon === "folder-filled";
  const iconSize = Math.round(width * (folder ? 0.5 : 0.375));
  const badge = !props.thumbnail && !folder && props.extension ? props.extension.toUpperCase() : "";
  const badgeWidth = Math.min(width - inset * 2, 40 * ui);
  const badgeHeight = 16 * ui;
  const badgeFill = mixColor(pal.surface, tint, 0.85);
  const iconY = Math.round((width - iconSize) / 2 - (badge ? 8 * ui : 0));
  const nameWidth = width - 4 * ui;
  const nameLines = Math.min(
    props.nameLines ?? 2,
    measureWrappedText(props.name, nameWidth, { fontSize: NAME_SIZE }).lines.length,
  );
  const nameY = width + LABEL_GAP * ui;
  const thumbnailSize = { width: width - inset * 2, height: width - inset * 2 };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      <Rect
        width={width}
        height={width}
        fill={fill}
        radius={radius}
        stroke={props.selected ? pal.accentLine : undefined}
        strokeWidth={props.selected ? theme.foundations.borders.control : undefined}
      />
      {props.thumbnail ? (
        <Group x={inset} y={inset} width={thumbnailSize.width} height={thumbnailSize.height} clip>
          {typeof props.thumbnail === "function" ? props.thumbnail(thumbnailSize) : props.thumbnail}
        </Group>
      ) : (
        <Icon
          x={Math.round((width - iconSize) / 2)}
          y={iconY}
          name={props.icon ?? "file"}
          size={iconSize}
          color={props.disabled ? pal.muted : tint}
          symbolic
        />
      )}
      {badge ? (
        <Group
          x={Math.round((width - badgeWidth) / 2)}
          y={width - 30 * ui}
          width={badgeWidth}
          height={badgeHeight}
        >
          <Rect width={badgeWidth} height={badgeHeight} fill={badgeFill} radius={4 * ui} />
          <TextBlock
            width={badgeWidth}
            height={badgeHeight}
            text={badge}
            color={foregroundOn(badgeFill)}
            fontSize={9}
            fontWeight="medium"
            horizontalAlign="center"
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
        </Group>
      ) : null}
      <TextBlock
        x={2 * ui}
        y={nameY}
        width={nameWidth}
        height={nameLines * NAME_LINE * ui}
        text={props.name}
        color={props.disabled ? pal.muted : pal.text}
        fontSize={NAME_SIZE}
        fontWeight={props.selected ? "medium" : "regular"}
        horizontalAlign="center"
        verticalAlign="center"
        wrap={nameLines > 1}
        maxLines={nameLines}
        overflow="ellipsis"
      />
      {props.detail ? (
        <TextBlock
          x={2 * ui}
          y={nameY + nameLines * NAME_LINE * ui}
          width={nameWidth}
          height={DETAIL_LINE * ui}
          text={props.detail}
          color={pal.muted}
          fontSize={10}
          horizontalAlign="center"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : null}
      <CollectionItem
        width={width}
        height={height}
        focusId={props.focusId}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        focused={props.focused}
        dropData={props.dropData}
        dragSource={props.dragSource}
        onFocusChange={props.onFocusChange}
        onHoverChange={setPointerOver}
        onKeyDown={props.onKeyDown}
        onPress={props.onPress}
        onDoublePress={props.onDoublePress}
        onContextMenu={props.onContextMenu}
      />
      {props.dropTarget ? <DndFeedback width={width} height={height} kind="drop-target" /> : null}
    </Group>
  );
}

registerIntrinsicSize(FileTile, (props) => {
  const width = props.width ?? TILE * getUiScaleFactor();
  return { width, height: fileTileHeight(props) };
});
