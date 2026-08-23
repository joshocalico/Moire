/** Recipe-driven list rows and a scroll-backed generic list collection. */
import React, { isValidElement, type ReactNode } from "react";
import {
  Group,
  Rect,
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
import { Box, Horizontal, Inset, Vertical, useLayoutMetrics } from "./layout.js";
import { TextBlock } from "./primitives.js";

export type ListItemSlot =
  | ReactNode
  | ((style: WidgetIconStyle) => ReactNode);

export type ListItemProps = {
  x?: number;
  y?: number;
  width?: number;
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
  const allocated = useLayoutMetrics();
  const recipe = theme.recipes.listItem[props.size ?? "medium"];
  const width = props.width ?? allocated?.width ?? 0;
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
  const elementProps = isValidElement(props.leading)
    ? (props.leading.props as { size?: number; height?: number; width?: number })
    : undefined;
  const leadingSize =
    elementProps?.size ??
    elementProps?.height ??
    elementProps?.width ??
    leadingStyle.size;
  const textHeight = props.subtitle
    ? titleLineHeight + recipe.metrics.subtitleGap + subtitleLineHeight
    : titleLineHeight;
  const leading =
    typeof props.leading === "function"
      ? props.leading(leadingStyle)
      : props.leading;

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={height}
    >
      {props.selected ? (
        <Rect
          x={0}
          y={0}
          width={width}
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
          width={width}
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
      <Inset
        width={width}
        height={height}
        padding={{
          left: recipe.indicator.width + recipe.metrics.paddingX,
          right: recipe.metrics.paddingX,
        }}
      >
        <Horizontal gap={leading ? recipe.metrics.leadingGap : 0} align="center">
          {leading ? (
            <Box width={leadingSize} height={leadingSize}>
              {leading}
            </Box>
          ) : null}
          <Vertical
            flexGrow={1}
            height={textHeight}
            gap={props.subtitle ? recipe.metrics.subtitleGap : 0}
          >
            <TextBlock
              height={titleLineHeight}
              text={props.title}
              color={title.color}
              fontSize={title.fontSize}
              fontWeight={title.fontWeight}
              overflow="ellipsis"
              maxLines={1}
            />
            {props.subtitle ? (
              <TextBlock
                height={subtitleLineHeight}
                text={props.subtitle}
                color={subtitle.color}
                fontSize={subtitle.fontSize}
                fontWeight={subtitle.fontWeight}
                overflow="ellipsis"
                maxLines={1}
              />
            ) : null}
          </Vertical>
        </Horizontal>
      </Inset>
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
