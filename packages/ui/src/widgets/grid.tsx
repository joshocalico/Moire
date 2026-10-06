/** Recipe-driven grid cells and a scroll-backed generic grid collection. */
import React, { useEffect, useState, type ReactNode } from "react";
import { Group, Rect, measureTextBounds, type HitPointerEvent } from "@moire/react-host";
import { resolveStatefulStyle, useWidgetTheme, type ButtonSize } from "#ui/widget-theme";
import { Pressable } from "./pressable";
import { ScrollArea } from "./scroll";
import { Align, Box, Inset, Stack, Vertical } from "./layout";
import { TextBlock } from "./primitives";

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
  const disabledInteraction = resolveStatefulStyle(recipe.interaction, "disabled");
  const labelStyle = resolveStatefulStyle(recipe.label, props.disabled ? "disabled" : "rest");
  const textHeight = measureTextBounds("Mg", {
    fontSize: labelStyle.fontSize,
    fontWeight: labelStyle.fontWeight,
  }).height;
  const labelHeight = textHeight + recipe.metrics.labelHeightPadding;
  const iconSize =
    props.iconSize ??
    Math.max(
      recipe.metrics.iconMin,
      Math.min(recipe.metrics.iconMax, props.height - labelHeight - recipe.metrics.iconGap),
    );
  const highlight = props.dropHover ? recipe.dropTarget : props.selected ? recipe.selection : null;

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
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
      <Inset width={props.width} height={props.height} padding={{ vertical: 4 }}>
        <Vertical gap={2} align="stretch">
          <Align flexGrow={1} minHeight={1} alignX="center" alignY="center">
            {props.icon ? (
              <Box width={iconSize} height={iconSize}>
                {props.icon}
              </Box>
            ) : null}
          </Align>
          <Inset height={labelHeight} padding={{ horizontal: recipe.metrics.labelPadding }}>
            <Stack alignX="stretch" alignY="stretch">
              {props.labelScrim ? (
                <Rect
                  width={Math.max(1, props.width - recipe.metrics.labelPadding * 2)}
                  height={labelHeight}
                  fill={recipe.labelScrim.fill}
                  radius={recipe.labelScrim.radius}
                />
              ) : null}
              <TextBlock
                text={props.label}
                color={labelStyle.color}
                fontSize={labelStyle.fontSize}
                fontWeight={labelStyle.fontWeight}
                horizontalAlign="center"
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={1}
              />
            </Stack>
          </Inset>
        </Vertical>
      </Inset>
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
  fill?: number;
  getKey?: (item: T, index: number) => string | number;
  focusedKey?: string | number | null;
  scrollY?: number;
  onScroll?: (offset: number) => void;
};

export function Grid<T>(props: GridProps<T>): ReactNode {
  const gap = props.gap ?? 8;
  const padding = props.padding ?? 0;
  const innerWidth = Math.max(1, props.width - padding * 2);
  const columns = Math.max(1, Math.floor((innerWidth + gap) / (props.itemWidth + gap)));
  const rows = Math.ceil(props.items.length / columns);
  const contentHeight = padding * 2 + (rows > 0 ? rows * (props.itemHeight + gap) - gap : 0);
  const [internalScroll, setInternalScroll] = useState(0);
  const scrollY = Math.max(
    0,
    Math.min(Math.max(0, contentHeight - props.height), props.scrollY ?? internalScroll),
  );
  const setScroll = (offset: number) => {
    if (props.scrollY === undefined) setInternalScroll(offset);
    props.onScroll?.(offset);
  };
  const focusIndex =
    props.focusedKey == null
      ? -1
      : props.items.findIndex(
          (item, index) => (props.getKey?.(item, index) ?? index) === props.focusedKey,
        );
  useEffect(() => {
    if (focusIndex < 0) return;
    const top = padding + Math.floor(focusIndex / columns) * (props.itemHeight + gap);
    if (top < scrollY) setScroll(top);
    else if (top + props.itemHeight > scrollY + props.height)
      setScroll(top + props.itemHeight - props.height);
    // Manual scrolling does not repeatedly snap back to the focused cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex, props.focusedKey, columns, props.height, props.itemHeight]);
  const first = Math.max(
    0,
    (Math.floor((scrollY - padding) / (props.itemHeight + gap)) - 2) * columns,
  );
  const last = Math.min(
    props.items.length,
    (Math.ceil((scrollY + props.height) / (props.itemHeight + gap)) + 2) * columns,
  );

  return (
    <ScrollArea
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      contentHeight={Math.max(props.height, contentHeight)}
      scrollbar={props.scrollbar}
      fill={props.fill}
      scrollY={scrollY}
      onScroll={setScroll}
    >
      {props.items.slice(first, last).map((item, offset) => {
        const index = first + offset;
        const column = index % columns;
        const row = Math.floor(index / columns);
        return (
          <Group
            key={props.getKey?.(item, index) ?? index}
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
