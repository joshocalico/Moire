/** Recipe-driven tabs with slots, pointer feedback, and keyboard navigation. */
import React, { useId, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
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

export type TabSlot = ReactNode | ((style: WidgetIconStyle) => ReactNode);

export type TabItem = {
  id: string;
  label: string;
  leading?: TabSlot;
  disabled?: boolean;
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
};

function normalizeTab(tab: string | TabItem, index: number): TabItem {
  return typeof tab === "string" ? { id: `tab-${index}`, label: tab } : tab;
}

function renderSlot(slot: TabSlot, style: WidgetIconStyle): ReactNode {
  return typeof slot === "function" ? slot(style) : slot;
}

export function Tabs(props: TabsProps): ReactNode {
  const recipe = useWidgetTheme().recipes.tabs[props.size ?? "medium"];
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
    if (target != null) props.onChange?.(target);
  };

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
          const icon = resolveStatefulStyle(recipe.icon, ...states);

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
                    padding={{ horizontal: recipe.metrics.paddingX }}
                  >
                    <Horizontal gap={recipe.metrics.gap} justify="center" align="center">
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
