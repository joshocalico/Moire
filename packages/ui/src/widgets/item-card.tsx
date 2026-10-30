/** A tinted card for a place: pinned folders, folder shortcuts, drives. */
import React, { useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import type { DragSourceOptions } from "./dnd";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { CollectionItem } from "./interaction";
import { registerIntrinsicSize } from "./layout";
import { TextBlock } from "./primitives";

export type ItemCardProps = {
  x?: number;
  y?: number;
  width: number;
  /** 56 for "row" and 84 for "stacked" by default. */
  height?: number;
  icon: IconName;
  /** Colour of the icon and the card's tint; the accent by default. */
  tint?: number;
  title: string;
  detail?: string;
  /**
   * "row": a neutral card with the icon in a tinted square beside the text (folder cards).
   * "stacked": a card washed in the tint, icon above the text (pinned places).
   */
  layout?: "row" | "stacked";
  selected?: boolean;
  disabled?: boolean;
  /** Shows a ⋯ button that calls this. */
  onMenu?: (event?: HitPointerEvent) => void;
  menuLabel?: string;
  /** Accept drops onto the card; exposed through `hitTestDropData`, highlighted while hovered. */
  dropData?: unknown;
  dragSource?: Omit<DragSourceOptions, "width" | "height">;
  focusId?: string;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  onPress?: (event?: HitPointerEvent) => void;
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
};

const ROW_H = 56;
const STACKED_H = 84;
const MENU = 28;

function cardHeight(props: Pick<ItemCardProps, "height" | "layout">): number {
  return props.height ?? (props.layout === "stacked" ? STACKED_H : ROW_H) * getUiScaleFactor();
}

export function ItemCard(props: ItemCardProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const [pointerOver, setPointerOver] = useState(false);
  // The ⋯ button takes the pointer from the card beneath it; the card stays lit meanwhile.
  const [menuHovered, setMenuHovered] = useState(false);
  const hovered = pointerOver || menuHovered;
  const height = cardHeight(props);
  const tint = props.tint ?? pal.accentLine;
  const stacked = props.layout === "stacked";
  const menu = MENU * ui;
  const menuSpace = props.onMenu ? menu + 8 * ui : 0;
  const fill = props.selected
    ? pal.selection
    : stacked
      ? mixColor(pal.bg, tint, hovered ? 0.22 : 0.16)
      : hovered
        ? mixColor(pal.surface, pal.hover, 0.7)
        : pal.surface;
  const stroke = props.selected
    ? pal.accentLine
    : stacked
      ? mixColor(pal.bg, tint, 0.3)
      : undefined;
  const ink = props.disabled ? pal.muted : pal.text;

  let content: ReactNode;
  if (stacked) {
    const pad = 16 * ui;
    const icon = 28 * ui;
    const textWidth = Math.max(1, props.width - pad * 2);
    const titleY = Math.max(pad + icon + 4 * ui, height - (props.detail ? 36 : 26) * ui);
    content = (
      <>
        <Icon x={pad} y={pad} name={props.icon} size={icon} color={tint} symbolic />
        <TextBlock
          x={pad}
          y={titleY}
          width={textWidth}
          height={18 * ui}
          text={props.title}
          color={ink}
          fontSize={14}
          fontWeight="medium"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
        {props.detail ? (
          <TextBlock
            x={pad}
            y={titleY + 16 * ui}
            width={textWidth}
            height={14 * ui}
            text={props.detail}
            color={pal.muted}
            fontSize={11}
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
        ) : null}
      </>
    );
  } else {
    const square = 36 * ui;
    const squareX = 10 * ui;
    const squareY = Math.round((height - square) / 2);
    const icon = 20 * ui;
    const textX = squareX + square + 10 * ui;
    const textWidth = Math.max(1, props.width - textX - 12 * ui - menuSpace);
    const textTop = Math.round((height - (props.detail ? 36 : 20) * ui) / 2);
    content = (
      <>
        <Rect
          x={squareX}
          y={squareY}
          width={square}
          height={square}
          fill={mixColor(props.selected ? pal.selection : pal.surface, tint, 0.22)}
          radius={10 * ui}
        />
        <Icon
          x={squareX + (square - icon) / 2}
          y={squareY + (square - icon) / 2}
          name={props.icon}
          size={icon}
          color={tint}
          symbolic
        />
        <TextBlock
          x={textX}
          y={textTop}
          width={textWidth}
          height={20 * ui}
          text={props.title}
          color={ink}
          fontSize={13}
          fontWeight="medium"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
        {props.detail ? (
          <TextBlock
            x={textX}
            y={textTop + 19 * ui}
            width={textWidth}
            height={16 * ui}
            text={props.detail}
            color={pal.muted}
            fontSize={11}
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
        ) : null}
      </>
    );
  }

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      <Rect
        width={props.width}
        height={height}
        fill={fill}
        radius={(stacked ? 14 : 12) * ui}
        stroke={stroke}
        strokeWidth={stroke === undefined ? undefined : theme.foundations.borders.hairline}
      />
      {content}
      <CollectionItem
        width={props.width}
        height={height}
        focusId={props.focusId}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        dropData={props.dropData}
        dragSource={props.dragSource}
        onFocusChange={props.onFocusChange}
        onHoverChange={setPointerOver}
        onKeyDown={props.onKeyDown}
        onPress={props.onPress}
        onDoublePress={props.onDoublePress}
        onContextMenu={props.onContextMenu}
      />
      {props.onMenu ? (
        <IconButton
          x={props.width - menu - (stacked ? 10 : 8) * ui}
          y={stacked ? 10 * ui : Math.round((height - menu) / 2)}
          width={menu}
          height={menu}
          variant="ghost"
          size="small"
          tooltip={props.menuLabel ?? "More actions"}
          disabled={props.disabled}
          icon={(style) => <Icon name="more" size={14 * ui} color={style.color} symbolic />}
          onHoverChange={setMenuHovered}
          onPress={props.onMenu}
        />
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(ItemCard, (props) => ({
  width: props.width,
  height: cardHeight(props),
}));
