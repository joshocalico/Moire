/** Shared menu surface and item primitives for app and compositor popups. */
import React, { useId, useState, type ReactNode } from "react";
import {
  Group,
  measureTextBounds,
  type HitKeyEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type WidgetIconStyle,
  type WidgetState,
  type WidgetTextStyle,
} from "../widget-theme.js";
import { Pressable } from "./pressable.js";
import { Align, Box, Horizontal, Inset, Measure, Vertical } from "./layout.js";
import { Separator, Surface, TextBlock } from "./primitives.js";

export type MenuItemSlot =
  | ReactNode
  | ((style: WidgetIconStyle) => ReactNode);

export type MenuTrailingSlot =
  | string
  | ReactNode
  | ((style: WidgetTextStyle) => ReactNode);

export type MenuItemProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  label: string;
  description?: string;
  leading?: MenuItemSlot;
  trailing?: MenuTrailingSlot;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  indicator?: boolean;
  autoFocus?: boolean;
  focusId?: string;
  onPress?: () => void;
};

function renderLeading(slot: MenuItemSlot, style: WidgetIconStyle): ReactNode {
  return typeof slot === "function" ? slot(style) : slot;
}

function renderTrailing(
  slot: MenuTrailingSlot,
  style: WidgetTextStyle,
): ReactNode {
  return typeof slot === "function" ? slot(style) : slot;
}

export function MenuItem(props: MenuItemProps): ReactNode {
  const recipe = useWidgetTheme().recipes.menu[props.size ?? "medium"];
  const generatedId = useId();
  const [focused, setFocused] = useState(false);
  const height = props.height ?? recipe.metrics.rowHeight;
  const states: WidgetState[] = [];
  if (focused) states.push("focused");
  if (props.selected) states.push("selected");
  if (props.danger) states.push("danger");
  if (props.disabled) states.push("disabled");
  const root = resolveStatefulStyle(recipe.item, ...states);
  const hovered = resolveStatefulStyle(recipe.item, "hover");
  const pressed = resolveStatefulStyle(recipe.item, "pressed");
  const label = resolveStatefulStyle(recipe.label, ...states);
  const description = resolveStatefulStyle(recipe.description, ...states);
  const leading = resolveStatefulStyle(recipe.leadingIcon, ...states);
  const trailing = resolveStatefulStyle(recipe.trailingText, ...states);
  const indicator = resolveStatefulStyle(recipe.indicator, ...states);
  const labelBounds = measureTextBounds("Mg", {
    fontSize: label.fontSize,
    fontWeight: label.fontWeight,
  });
  const descriptionBounds = props.description
    ? measureTextBounds("Mg", {
        fontSize: description.fontSize,
        fontWeight: description.fontWeight,
      })
    : null;
  const blockHeight =
    labelBounds.height +
    (descriptionBounds
      ? recipe.metrics.descriptionGap + descriptionBounds.height
      : 0);
  const trailingBounds = typeof props.trailing === "string"
    ? measureTextBounds(props.trailing, {
        fontSize: trailing.fontSize,
        fontWeight: trailing.fontWeight,
      })
    : null;

  const handleKey = (event: HitKeyEvent) => {
    if (event.repeat || props.disabled) return;
    if (
      event.code === 28 ||
      event.code === 57 ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      props.onPress?.();
    }
  };

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={height}
      clip
    >
      <Pressable
        width={props.width}
        height={height}
        fill={root.fill}
        hoverFill={hovered.fill}
        pressedFill={pressed.fill}
        disabledFill={root.fill}
        radius={root.radius}
        stroke={root.stroke}
        strokeWidth={root.strokeWidth}
        indicatorColor={props.indicator ? indicator.fill : undefined}
        indicatorWidth={indicator.width}
        disabled={props.disabled}
        focusable={!!props.onPress}
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? `menu-item:${generatedId}`}
        onFocusChange={setFocused}
        onKeyDown={handleKey}
        onPress={props.onPress}
      />
      <Inset width={props.width} height={height} padding={{ horizontal: recipe.metrics.paddingX }}>
        <Horizontal gap={recipe.metrics.contentGap} align="center">
          {props.leading ? (
            <Box width={leading.size} height={leading.size}>
              {renderLeading(props.leading, leading)}
            </Box>
          ) : null}
          <Vertical flexGrow={1} height={blockHeight} gap={props.description ? recipe.metrics.descriptionGap : 0}>
            <TextBlock
              height={labelBounds.height}
              text={props.label}
              color={label.color}
              fontSize={label.fontSize}
              fontWeight={label.fontWeight}
              overflow="ellipsis"
              maxLines={1}
            />
            {props.description && descriptionBounds ? (
              <TextBlock
                height={descriptionBounds.height}
                text={props.description}
                color={description.color}
                fontSize={description.fontSize}
                fontWeight={description.fontWeight}
                overflow="ellipsis"
                maxLines={1}
              />
            ) : null}
          </Vertical>
          {props.trailing ? (
            typeof props.trailing === "string" && trailingBounds ? (
              <TextBlock
                width={trailingBounds.width}
                height={trailingBounds.height}
                text={props.trailing}
                color={trailing.color}
                fontSize={trailing.fontSize}
                fontWeight={trailing.fontWeight}
                verticalAlign="center"
              />
            ) : (
              <Box width={leading.size} height={leading.size}>
                {renderTrailing(props.trailing, trailing)}
              </Box>
            )
          ) : null}
        </Horizontal>
      </Inset>
    </Group>
  );
}

export type MenuEntry = Omit<
  MenuItemProps,
  "x" | "y" | "width" | "height" | "size"
> & {
  id?: string;
  separatorBefore?: boolean;
};

export type MenuProps = {
  x?: number;
  y?: number;
  width: number;
  size?: ButtonSize;
  title?: string;
  items: readonly MenuEntry[];
};

export function Menu(props: MenuProps): ReactNode {
  const recipe = useWidgetTheme().recipes.menu[props.size ?? "medium"];
  const separators = props.items.filter((item) => item.separatorBefore).length;
  const titleHeight = props.title ? recipe.metrics.headerHeight : 0;
  const height =
    recipe.metrics.surfacePadding * 2 +
    titleHeight +
    props.items.length * recipe.metrics.rowHeight +
    separators * recipe.metrics.separatorGap;
  const contentWidth = Math.max(1, props.width - recipe.metrics.surfacePadding * 2);
  const itemWidth = Math.max(1, contentWidth - recipe.metrics.itemInset * 2);
  const rows: ReactNode[] = [];
  props.items.forEach((item, index) => {
    if (item.separatorBefore) {
      rows.push(
        <Inset
          key={`${item.id ?? index}:separator`}
          height={recipe.metrics.separatorGap}
          padding={{ horizontal: recipe.metrics.paddingX }}
        >
          <Align alignY="center">
            <Measure height={recipe.separator.height}>{({ width }) => (
              <Separator width={width} height={recipe.separator.height} color={recipe.separator.fill} />
            )}</Measure>
          </Align>
        </Inset>,
      );
    }
    rows.push(
      <Inset
        key={item.id ?? index}
        height={recipe.metrics.rowHeight}
        padding={{ horizontal: recipe.metrics.itemInset }}
      >
        <MenuItem
          {...item}
          width={itemWidth}
          height={recipe.metrics.rowHeight}
          size={props.size}
        />
      </Inset>,
    );
  });

  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      fill={recipe.surface.fill}
      radius={recipe.surface.radius}
      stroke={recipe.surface.stroke}
      strokeWidth={recipe.surface.strokeWidth}
      elevation="medium"
      clip
    >
      <Inset width={props.width} height={height} padding={recipe.metrics.surfacePadding}>
        <Vertical gap={0}>
          {props.title ? (
            <Inset height={titleHeight} padding={{ horizontal: recipe.metrics.itemInset }}>
              <TextBlock
                text={props.title}
                color={recipe.header.color}
                fontSize={recipe.header.fontSize}
                fontWeight={recipe.header.fontWeight}
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={1}
              />
            </Inset>
          ) : null}
          {rows}
        </Vertical>
      </Inset>
    </Surface>
  );
}
