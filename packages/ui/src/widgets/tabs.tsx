/** Recipe-driven tabs with slots, pointer feedback, and keyboard navigation. */
import React, { useId, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type WidgetIconStyle,
  type WidgetState,
} from "#ui/widget-theme";
import { Pressable } from "./pressable";
import { Box, Horizontal, Inset, Measure, registerIntrinsicSize } from "./layout";
import { TextBlock } from "./primitives";
import { IconButton } from "./icon-button";
import { Icon } from "./icon";
import { DropZone } from "./dnd";
import { getUiScaleFactor } from "#ui/font";

export type TabSlot = ReactNode | ((style: WidgetIconStyle) => ReactNode);

export type TabItem = {
  id: string;
  label: string;
  leading?: TabSlot;
  disabled?: boolean;
  closable?: boolean;
  /** Accept drops onto this tab; exposed through `hitTestDropData`, highlighted while hovered. */
  dropData?: unknown;
};

export type TabsProps = {
  x?: number;
  y?: number;
  width: number;
  tabs: readonly (string | TabItem)[];
  active: number;
  onChange?: (index: number) => void;
  height?: number;
  size?: ButtonSize;
  disabled?: boolean;
  variant?: "standard" | "titlebar";
  onClose?: (index: number) => void;
  onAdd?: () => void;
  /** Secondary click or the Menu key on a tab. */
  onContextMenu?: (index: number, event: HitPointerEvent) => void;
};

function normalizeTab(tab: string | TabItem, index: number): TabItem {
  return typeof tab === "string" ? { id: `tab-${index}`, label: tab } : tab;
}

function renderSlot(slot: TabSlot, style: WidgetIconStyle): ReactNode {
  return typeof slot === "function" ? slot(style) : slot;
}

/**
 * Recipes give icon sizes and spacing at UI scale 1; labels already grow with the scale (fonts
 * scale), so leading icons and the room around them must grow too.
 */
function scaledIcon(style: WidgetIconStyle, ui: number): WidgetIconStyle {
  return { ...style, size: Math.round(style.size * ui) };
}

export function Tabs(props: TabsProps): ReactNode {
  const recipe = useWidgetTheme().recipes.tabs[props.size ?? "medium"];
  const ui = getUiScaleFactor();
  const paddingX = Math.round(recipe.metrics.paddingX * ui);
  const gap = Math.round(recipe.metrics.gap * ui);
  const actionIcon = Math.round(16 * ui);
  const generatedId = useId();
  const [focused, setFocused] = useState<number | null>(null);
  const height = props.height ?? recipe.metrics.height;
  const tabs = props.tabs.map(normalizeTab);

  const nextEnabled = (from: number, direction: -1 | 1): number => {
    for (let offset = 1; offset <= tabs.length; offset++) {
      const candidate = (from + direction * offset + tabs.length) % tabs.length;
      if (!props.disabled && !tabs[candidate]?.disabled) return candidate;
    }
    return from;
  };

  const handleKey = (event: HitKeyEvent, index: number) => {
    if (event.repeat || props.disabled || tabs[index]?.disabled) return;
    let target: number | null = null;
    if (event.code === 105 || event.key === "ArrowLeft") {
      target = nextEnabled(index, -1);
    } else if (event.code === 106 || event.key === "ArrowRight") {
      target = nextEnabled(index, 1);
    } else if (event.code === 102 || event.key === "Home") {
      target = nextEnabled(-1, 1);
    } else if (event.code === 107 || event.key === "End") {
      target = nextEnabled(0, -1);
    } else if (
      event.code === 28 ||
      event.code === 57 ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      target = index;
    }
    if (target != null) {
      setFocused(target);
      props.onChange?.(target);
    }
  };

  if (props.variant === "titlebar") {
    // Older families keep their header appearance; new header recipes own the
    // resolved selected paint instead of being bypassed by root/divider colors.
    const header = recipe.titlebar ?? {
      tab: {
        ...recipe.tab,
        base: { ...recipe.tab.base, radius: recipe.root.radius },
        states: {
          ...recipe.tab.states,
          selected: { fill: recipe.root.fill, stroke: recipe.divider.fill, strokeWidth: 1 },
        },
      },
      label: recipe.label,
      icon: recipe.icon,
    };
    const actionWidth = Math.min(height, Math.max(1, props.width / 2));
    const addWidth = props.onAdd ? actionWidth : 0;
    const canShowArrows = props.width >= height * 4;
    const capacity = Math.max(
      1,
      Math.floor((props.width - addWidth - (canShowArrows ? actionWidth * 2 : 0)) / 120),
    );
    const start = Math.max(0, Math.min(tabs.length - capacity, props.active - capacity + 1));
    const shown = tabs.slice(start, start + capacity);
    const overflow = tabs.length > capacity && canShowArrows;
    let previous = -1;
    let next = -1;
    for (let index = 0; index < tabs.length; index++) {
      if (props.disabled || tabs[index]?.disabled) continue;
      if (index < start) previous = index;
      if (index >= start + capacity && next < 0) next = index;
    }
    const tabWidth = Math.max(
      1,
      Math.min(
        200,
        (props.width - addWidth - (overflow ? actionWidth * 2 : 0)) / Math.max(1, shown.length),
      ),
    );
    const offset = overflow ? actionWidth : 0;
    return (
      <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height} clip>
        {overflow ? (
          <IconButton
            width={actionWidth}
            height={height}
            variant="ghost"
            icon={<Icon symbolic name="back" size={actionIcon} />}
            disabled={previous < 0}
            onPress={() => props.onChange?.(previous)}
            tooltip="Previous tabs"
          />
        ) : null}
        {shown.map((tab, visibleIndex) => {
          const index = start + visibleIndex;
          const selected = index === props.active;
          const disabled = !!props.disabled || !!tab.disabled;
          const states: WidgetState[] = selected ? ["selected"] : [];
          if (focused === index) states.push("focused");
          if (disabled && recipe.titlebar) states.push("disabled");
          const closable = tab.closable && tabWidth >= actionWidth * 2;
          const paintStates: WidgetState[] =
            !recipe.titlebar && selected ? [...states.slice(1), "selected"] : states;
          const style = resolveStatefulStyle(header.tab, ...paintStates);
          const icon = scaledIcon(resolveStatefulStyle(header.icon, ...states), ui);
          const label = resolveStatefulStyle(header.label, ...states);
          return (
            <Group
              key={tab.id}
              x={offset + visibleIndex * tabWidth}
              width={tabWidth}
              height={height}
            >
              <Pressable
                width={tabWidth}
                height={height}
                fill={style.fill}
                hoverFill={
                  selected && recipe.titlebar?.selectedInteraction
                    ? recipe.titlebar.selectedInteraction.hoverFill
                    : resolveStatefulStyle(header.tab, "hover", ...(recipe.titlebar ? states : []))
                        .fill
                }
                pressedFill={
                  selected && recipe.titlebar?.selectedInteraction
                    ? recipe.titlebar.selectedInteraction.pressedFill
                    : resolveStatefulStyle(
                        header.tab,
                        "pressed",
                        ...(recipe.titlebar ? states : []),
                      ).fill
                }
                disabledFill={style.fill}
                radius={style.radius}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                focusable
                focusId={`tabs:${generatedId}:${tab.id}`}
                disabled={disabled}
                onPress={() => props.onChange?.(index)}
                autoFocus={focused === index}
                onFocusChange={(next) => {
                  if (next) setFocused(index);
                  else setFocused((current) => (current === index ? null : current));
                }}
                onKeyDown={(event) => handleKey(event, index)}
                onContextMenu={
                  props.onContextMenu ? (event) => props.onContextMenu?.(index, event) : undefined
                }
              />
              {tab.dropData !== undefined ? (
                <DropZone width={tabWidth} height={height} id={tab.dropData} />
              ) : null}
              <Inset
                width={Math.max(1, tabWidth - (closable ? actionWidth : 0))}
                height={height}
                padding={{ horizontal: paddingX }}
              >
                <Horizontal gap={gap} align="center">
                  {tab.leading ? (
                    <Box width={icon.size} height={icon.size}>
                      {renderSlot(tab.leading, icon)}
                    </Box>
                  ) : null}
                  <TextBlock
                    text={tab.label}
                    color={label.color}
                    fontSize={label.fontSize}
                    fontWeight={recipe.titlebar ? label.fontWeight : undefined}
                    flexShrink={1}
                    maxLines={1}
                    overflow="ellipsis"
                  />
                </Horizontal>
              </Inset>
              {closable ? (
                <IconButton
                  x={tabWidth - actionWidth}
                  width={actionWidth}
                  height={height}
                  variant="ghost"
                  icon={<Icon symbolic name="close" size={Math.round(14 * ui)} />}
                  tooltip={`Close ${tab.label}`}
                  disabled={props.disabled || tab.disabled}
                  onPress={() => props.onClose?.(index)}
                />
              ) : null}
            </Group>
          );
        })}
        {overflow ? (
          <IconButton
            x={offset + shown.length * tabWidth}
            width={actionWidth}
            height={height}
            variant="ghost"
            icon={<Icon symbolic name="forward" size={actionIcon} />}
            disabled={next < 0}
            onPress={() => props.onChange?.(next)}
            tooltip="Next tabs"
          />
        ) : null}
        {props.onAdd ? (
          <IconButton
            x={offset + shown.length * tabWidth + (overflow ? actionWidth : 0)}
            width={actionWidth}
            height={height}
            variant="ghost"
            icon={<Icon symbolic name="plus" size={actionIcon} />}
            tooltip="New folder tab"
            disabled={props.disabled}
            onPress={props.onAdd}
          />
        ) : null}
      </Group>
    );
  }

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height} clip>
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={height}
        fill={recipe.root.fill}
        radius={recipe.root.radius}
        stroke={recipe.root.stroke}
        strokeWidth={recipe.root.strokeWidth}
      />
      <Horizontal width={props.width} height={height} gap={0} align="stretch">
        {tabs.map((tab, index) => {
          const selected = index === props.active;
          const disabled = !!props.disabled || !!tab.disabled;
          const states: WidgetState[] = [];
          if (focused === index) states.push("focused");
          if (selected) states.push("selected");
          if (disabled) states.push("disabled");
          const root = resolveStatefulStyle(recipe.tab, ...states);
          const hovered = resolveStatefulStyle(recipe.tab, "hover");
          const pressed = resolveStatefulStyle(recipe.tab, "pressed");
          const label = resolveStatefulStyle(recipe.label, ...states);
          const icon = scaledIcon(resolveStatefulStyle(recipe.icon, ...states), ui);

          return (
            <Measure key={tab.id} flexGrow={1} minWidth={1}>
              {({ width: tabWidth }) => (
                <Group width={tabWidth} height={height}>
                  <Pressable
                    width={tabWidth}
                    height={height - recipe.metrics.indicatorHeight}
                    fill={root.fill}
                    hoverFill={hovered.fill}
                    pressedFill={pressed.fill}
                    disabledFill={root.fill}
                    radius={root.radius}
                    stroke={root.stroke}
                    strokeWidth={root.strokeWidth}
                    disabled={disabled}
                    focusable
                    focusId={`tabs:${generatedId}:${tab.id}`}
                    autoFocus={focused === index}
                    onFocusChange={(next) => {
                      if (next) setFocused(index);
                      else {
                        setFocused((current) => (current === index ? null : current));
                      }
                    }}
                    onKeyDown={(event) => handleKey(event, index)}
                    onPress={() => props.onChange?.(index)}
                  />
                  <Inset
                    width={tabWidth}
                    height={height - recipe.metrics.indicatorHeight}
                    padding={{ horizontal: paddingX }}
                  >
                    <Horizontal gap={gap} justify="center" align="center">
                      {tab.leading ? (
                        <Box width={icon.size} height={icon.size}>
                          {renderSlot(tab.leading, icon)}
                        </Box>
                      ) : null}
                      <TextBlock
                        flexShrink={1}
                        text={tab.label}
                        color={label.color}
                        fontSize={label.fontSize}
                        fontWeight={label.fontWeight}
                        overflow="ellipsis"
                        maxLines={1}
                      />
                    </Horizontal>
                  </Inset>
                  {selected ? (
                    <Rect
                      x={recipe.metrics.indicatorInsetX}
                      y={height - recipe.metrics.indicatorHeight}
                      width={Math.max(1, tabWidth - recipe.metrics.indicatorInsetX * 2)}
                      height={recipe.metrics.indicatorHeight}
                      fill={recipe.indicator.fill}
                      radius={recipe.indicator.radius}
                    />
                  ) : null}
                </Group>
              )}
            </Measure>
          );
        })}
      </Horizontal>
      <Rect
        x={0}
        y={height - recipe.divider.height}
        width={props.width}
        height={recipe.divider.height}
        fill={recipe.divider.fill}
      />
    </Group>
  );
}

registerIntrinsicSize(Tabs, (props, theme) => ({
  width: props.width,
  height: props.height ?? theme.recipes.tabs[props.size ?? "medium"].metrics.height,
}));
