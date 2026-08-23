import React, { useId, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import { Pressable } from "./pressable.js";
import { Tabs, type TabItem } from "./tabs.js";
import { useWidgetTheme, type ButtonSize } from "../widget-theme.js";
import { Box, Horizontal, Inset, Vertical, registerIntrinsicSize } from "./layout.js";
import { TextBlock } from "./primitives.js";

export type SegmentedControlOption = {
  id: string;
  label: string;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  options: readonly SegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
};

export function SegmentedControl(props: SegmentedControlProps): ReactNode {
  const active = Math.max(
    0,
    props.options.findIndex((option) => option.id === props.value),
  );
  const tabs: TabItem[] = props.options.map((option) => ({
    id: option.id,
    label: option.label,
    disabled: option.disabled,
  }));
  return (
    <Tabs
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      size={props.size}
      tabs={tabs}
      active={active}
      onChange={(index) => {
        const next = props.options[index];
        if (next) props.onChange?.(next.id);
      }}
    />
  );
}

registerIntrinsicSize(SegmentedControl, (props, theme) => ({
  width: props.width,
  height: props.height ?? theme.recipes.tabs[props.size ?? "medium"].metrics.height,
}));

export type RadioOption = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type RadioGroupProps = {
  x?: number;
  y?: number;
  width: number;
  options: readonly RadioOption[];
  value: string;
  onChange?: (value: string) => void;
  rowHeight?: number;
};

export function RadioGroup(props: RadioGroupProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const generatedId = useId();
  const [focused, setFocused] = useState<number | null>(null);
  const rowHeight = props.rowHeight ?? 44;
  const move = (from: number, direction: -1 | 1) => {
    for (let offset = 1; offset <= props.options.length; offset++) {
      const index =
        (from + direction * offset + props.options.length) % props.options.length;
      if (!props.options[index]?.disabled) {
        const option = props.options[index]!;
        setFocused(index);
        props.onChange?.(option.id);
        return;
      }
    }
  };
  const handleKey = (event: HitKeyEvent, index: number) => {
    if (event.repeat) return;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft" || event.code === 103 || event.code === 105) {
      move(index, -1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.code === 108 || event.code === 106) {
      move(index, 1);
    } else if (event.key === " " || event.key === "Enter" || event.code === 57 || event.code === 28) {
      const option = props.options[index];
      if (option && !option.disabled) props.onChange?.(option.id);
    }
  };

  return (
    <Vertical
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.options.length * rowHeight}
      gap={0}
    >
      {props.options.map((option, index) => {
        const selected = option.id === props.value;
        return (
          <Group
            key={option.id}
            width={props.width}
            height={rowHeight}
          >
            <Pressable
              width={props.width}
              height={rowHeight - 2}
              fill={selected ? pal.selection : 0x00000000}
              hoverFill={pal.hover}
              pressedFill={pal.pressed}
              radius={pal.radiusSm}
              disabled={option.disabled}
              focusable
              focusId={`radio:${generatedId}:${option.id}`}
              onFocusChange={(next) => setFocused(next ? index : null)}
              onKeyDown={(event) => handleKey(event, index)}
              onPress={() => props.onChange?.(option.id)}
            />
            <Inset width={props.width} height={rowHeight} padding={{ horizontal: 10 }}>
              <Horizontal gap={10} align="center">
                <Box width={16} height={16}>
                  <Rect
                    width={16}
                    height={16}
                    fill={pal.surface}
                    radius={8}
                    stroke={focused === index ? pal.focusRing : selected ? pal.accent : pal.border}
                    strokeWidth={focused === index ? 2 : 1}
                  />
                  {selected ? (
                    <Rect x={4} y={4} width={8} height={8} fill={pal.accent} radius={4} />
                  ) : null}
                </Box>
                <Vertical flexGrow={1} height={option.description ? 35 : 20} gap={1} justify="center">
                  <TextBlock
                    height={18}
                    text={option.label}
                    color={option.disabled ? pal.muted : pal.text}
                    fontSize={13}
                    verticalAlign="center"
                    overflow="ellipsis"
                    maxLines={1}
                  />
                  {option.description ? (
                    <TextBlock
                      height={16}
                      text={option.description}
                      color={pal.muted}
                      fontSize={10}
                      verticalAlign="center"
                      overflow="ellipsis"
                      maxLines={1}
                    />
                  ) : null}
                </Vertical>
              </Horizontal>
            </Inset>
          </Group>
        );
      })}
    </Vertical>
  );
}

registerIntrinsicSize(RadioGroup, (props) => ({
  width: props.width,
  height: props.options.length * (props.rowHeight ?? 44),
}));
