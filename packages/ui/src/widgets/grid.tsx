/** Recipe-driven grid cells and a scroll-backed generic grid collection. */
import React, { type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureText,
  measureTextBounds,
  type HitPointerEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
} from "../widget-theme.js";
import { Pressable } from "./pressable.js";
import { ScrollArea } from "./scroll.js";

function ellipsize(text: string, maxWidth: number, fontSize: number): string {
  const scale = fontSize / 14;
  if (measureText(text, scale) <= maxWidth) return text;
  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, middle) + ellipsis;
    if (measureText(candidate, scale) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return low > 0 ? text.slice(0, low) + ellipsis : ellipsis;
}

export type GridItemProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  size?: ButtonSize;
  /** Icon or image shown in the upper portion. */
  icon?: ReactNode;
  /** Explicit graphic size, overriding the selected recipe. */
  iconSize?: number;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  /** Live compatible-drag highlight. */
  dropHover?: boolean;
  onPress?: () => void;
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
  /** Soft recipe-defined scrim behind labels shown over wallpaper. */
  labelScrim?: boolean;
  /** When false, a semantic parent such as Draggable owns the hits. */
  interactive?: boolean;
};

export function GridItem(props: GridItemProps): ReactNode {
  const theme = useWidgetTheme();
  const recipe = theme.recipes.gridItem[props.size ?? "medium"];
  const interaction = resolveStatefulStyle(recipe.interaction, "rest");
  const hovered = resolveStatefulStyle(recipe.interaction, "hover");
  const pressed = resolveStatefulStyle(recipe.interaction, "pressed");
  const disabledInteraction = resolveStatefulStyle(
    recipe.interaction,
    "disabled",
  );
  const labelStyle = resolveStatefulStyle(
    recipe.label,
    props.disabled ? "disabled" : "rest",
  );
  const textHeight = measureTextBounds("Mg", {
    fontSize: labelStyle.fontSize,
    fontWeight: labelStyle.fontWeight,
  }).height;
  const labelHeight = textHeight + recipe.metrics.labelHeightPadding;
  const iconSize =
    props.iconSize ??
    Math.max(
      recipe.metrics.iconMin,
      Math.min(
        recipe.metrics.iconMax,
        props.height - labelHeight - recipe.metrics.iconGap,
      ),
    );
  const iconAreaHeight = props.height - labelHeight - 6;
  const iconX = Math.floor((props.width - iconSize) / 2);
  const iconY = Math.max(4, Math.floor((iconAreaHeight - iconSize) / 2));
  const labelY = iconAreaHeight + 2;
  const labelMaxWidth = Math.max(
    8,
    props.width - recipe.metrics.labelPadding * 2,
  );
  const label = ellipsize(props.label, labelMaxWidth, labelStyle.fontSize);
  const textWidth = measureText(label, labelStyle.fontSize / 14);
  const textX = Math.max(
    recipe.metrics.labelPadding,
    Math.floor((props.width - textWidth) / 2),
  );
  const highlight = props.dropHover
    ? recipe.dropTarget
    : props.selected
      ? recipe.selection
      : null;

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
    >
      {highlight ? (
        <Rect
          x={0}
          y={0}
          width={props.width}
          height={props.height}
          fill={highlight.fill}
          radius={highlight.radius}
          stroke={highlight.stroke}
          strokeWidth={highlight.strokeWidth}
        />
      ) : null}
      {props.interactive !== false ? (
        <Pressable
          x={0}
          y={0}
          width={props.width}
          height={props.height}
          fill={interaction.fill}
          hoverFill={hovered.fill}
          pressedFill={pressed.fill}
          disabledFill={disabledInteraction.fill}
          radius={interaction.radius}
          disabled={props.disabled}
          onPress={props.onPress}
          onDoublePress={props.onDoublePress}
          onContextMenu={props.onContextMenu}
        />
      ) : null}
      {props.icon ? (
        <Group
          x={iconX}
          y={iconY}
          width={iconSize}
          height={iconSize}
        >
          {props.icon}
        </Group>
      ) : null}
      {props.labelScrim ? (
        <Rect
          x={Math.max(0, textX - 4)}
          y={labelY - 1}
          width={Math.min(props.width, textWidth + 8)}
          height={labelHeight}
          fill={recipe.labelScrim.fill}
          radius={recipe.labelScrim.radius}
        />
      ) : null}
      <Text
        x={textX}
        y={labelY + Math.floor((labelHeight - textHeight) / 2)}
        text={label}
        color={labelStyle.color}
        fontSize={labelStyle.fontSize}
        fontWeight={labelStyle.fontWeight}
      />
    </Group>
  );
}

export type GridProps<T = unknown> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemWidth: number;
  itemHeight: number;
  gap?: number;
  padding?: number;
  scrollbar?: boolean;
};

export function Grid<T,>(props: GridProps<T>): ReactNode {
  const gap = props.gap ?? 8;
  const padding = props.padding ?? 0;
  const innerWidth = Math.max(1, props.width - padding * 2);
  const columns = Math.max(
    1,
    Math.floor((innerWidth + gap) / (props.itemWidth + gap)),
  );
  const rows = Math.ceil(props.items.length / columns);
  const contentHeight =
    padding * 2 + (rows > 0 ? rows * (props.itemHeight + gap) - gap : 0);

  return (
    <ScrollArea
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      contentHeight={Math.max(props.height, contentHeight)}
      scrollbar={props.scrollbar}
    >
      {props.items.map((item, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return (
          <Group
            key={index}
            x={padding + column * (props.itemWidth + gap)}
            y={padding + row * (props.itemHeight + gap)}
            width={props.itemWidth}
            height={props.itemHeight}
          >
            {props.renderItem(item, index)}
          </Group>
        );
      })}
    </ScrollArea>
  );
}
