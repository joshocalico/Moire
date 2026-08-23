/** Recipe-driven list rows and a scroll-backed generic list collection. */
import React, { isValidElement, type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureTextBounds,
  type HitPointerEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type WidgetIconStyle,
} from "../widget-theme.js";
import { Pressable } from "./pressable.js";
import { ScrollArea } from "./scroll.js";

export type ListItemSlot =
  | ReactNode
  | ((style: WidgetIconStyle) => ReactNode);

export type ListItemProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  /** Optional leading artwork slot (icon, avatar, status graphic…). */
  leading?: ListItemSlot;
  title: string;
  subtitle?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
  /** When false, no Pressable is emitted because the parent owns hits. */
  interactive?: boolean;
};

export function ListItem(props: ListItemProps): ReactNode {
  const theme = useWidgetTheme();
  const recipe = theme.recipes.listItem[props.size ?? "medium"];
  const height = props.height ?? recipe.metrics.height;
  const interaction = resolveStatefulStyle(recipe.interaction, "rest");
  const hovered = resolveStatefulStyle(recipe.interaction, "hover");
  const pressed = resolveStatefulStyle(recipe.interaction, "pressed");
  const disabledInteraction = resolveStatefulStyle(
    recipe.interaction,
    "disabled",
  );
  const title = resolveStatefulStyle(
    recipe.title,
    props.disabled ? "disabled" : "rest",
  );
  const subtitle = resolveStatefulStyle(
    recipe.subtitle,
    props.disabled ? "disabled" : "rest",
  );
  const leadingStyle = resolveStatefulStyle(
    recipe.leadingIcon,
    props.disabled ? "disabled" : "rest",
  );
  const titleLineHeight = measureTextBounds("Mg", {
    fontSize: title.fontSize,
    fontWeight: title.fontWeight,
  }).height;
  const subtitleLineHeight = measureTextBounds("Mg", {
    fontSize: subtitle.fontSize,
    fontWeight: subtitle.fontWeight,
  }).height;
  const titleY = props.subtitle
    ? Math.floor(
        (height -
          titleLineHeight -
          recipe.metrics.subtitleGap -
          subtitleLineHeight) /
          2,
      )
    : Math.floor((height - titleLineHeight) / 2);
  const subtitleY =
    titleY + titleLineHeight + recipe.metrics.subtitleGap;
  const elementProps = isValidElement(props.leading)
    ? (props.leading.props as { size?: number; height?: number; width?: number })
    : undefined;
  const leadingSize =
    elementProps?.size ??
    elementProps?.height ??
    elementProps?.width ??
    leadingStyle.size;
  const contentX = recipe.indicator.width + recipe.metrics.paddingX;
  const textX = props.leading
    ? contentX + leadingSize + recipe.metrics.leadingGap
    : contentX;
  const leading =
    typeof props.leading === "function"
      ? props.leading(leadingStyle)
      : props.leading;

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={height}
    >
      {props.selected ? (
        <Rect
          x={0}
          y={0}
          width={props.width}
          height={height}
          fill={recipe.selection.fill}
          radius={recipe.selection.radius}
          stroke={recipe.selection.stroke}
          strokeWidth={recipe.selection.strokeWidth}
        />
      ) : null}
      {props.selected ? (
        <Rect
          x={0}
          y={0}
          width={recipe.indicator.width}
          height={height}
          fill={recipe.indicator.fill}
        />
      ) : null}
      {props.interactive !== false ? (
        <Pressable
          x={0}
          y={0}
          width={props.width}
          height={height}
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
      {leading ? (
        <Group
          x={contentX}
          y={Math.floor((height - leadingSize) / 2)}
          width={leadingSize}
          height={leadingSize}
        >
          {leading}
        </Group>
      ) : null}
      <Text
        x={textX}
        y={titleY}
        text={props.title}
        color={title.color}
        fontSize={title.fontSize}
        fontWeight={title.fontWeight}
      />
      {props.subtitle ? (
        <Text
          x={textX}
          y={subtitleY}
          text={props.subtitle}
          color={subtitle.color}
          fontSize={subtitle.fontSize}
          fontWeight={subtitle.fontWeight}
        />
      ) : null}
    </Group>
  );
}

export type ListProps<T = unknown> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  items: T[];
  renderItem: (item: T, index: number, selected: boolean) => ReactNode;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  itemHeight?: number;
  scrollbar?: boolean;
};

export function List<T,>(props: ListProps<T>): ReactNode {
  const itemHeight = props.itemHeight ?? 40;
  const contentHeight = props.items.length * itemHeight;
  return (
    <ScrollArea
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      contentHeight={contentHeight}
      scrollbar={props.scrollbar}
    >
      {props.items.map((item, index) => (
        <Group
          key={index}
          x={0}
          y={index * itemHeight}
          width={props.width}
          height={itemHeight}
        >
          {props.renderItem(item, index, index === props.selectedIndex)}
        </Group>
      ))}
    </ScrollArea>
  );
}
