import React, { useId, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { Icon, type IconName } from "./icon";
import { Pressable } from "./pressable";
import { Tooltip, type TooltipPlacement } from "./tooltip";
import { Tabs, type TabItem } from "./tabs";
import { useWidgetTheme, type ButtonSize } from "#ui/widget-theme";
import { Box, Horizontal, Inset, Vertical, registerIntrinsicSize } from "./layout";
import { TextBlock } from "./primitives";

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

export type IconSegmentedControlOption = {
  id: string;
  icon: IconName;
  /** Tooltip, e.g. "List view". */
  label: string;
  disabled?: boolean;
};

export type IconSegmentedControlProps = {
  x?: number;
  y?: number;
  options: readonly IconSegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
  /** Width of one segment; 32 by default. */
  segmentWidth?: number;
  height?: number;
  tooltipPlacement?: TooltipPlacement;
};

const ICON_SEGMENT = 32;
const ICON_SEGMENT_INSET = 2;

function iconSegmentedSize(props: IconSegmentedControlProps) {
  const ui = getUiScaleFactor();
  const segment = props.segmentWidth ?? ICON_SEGMENT * ui;
  return {
    width: props.options.length * segment + ICON_SEGMENT_INSET * 2 * ui,
    height: props.height ?? ICON_SEGMENT * ui,
  };
}

/** Exclusive choice between icon segments (view modes), each named by a tooltip. */
export function IconSegmentedControl(props: IconSegmentedControlProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const generatedId = useId();
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const { width, height } = iconSegmentedSize(props);
  const inset = ICON_SEGMENT_INSET * ui;
  const segment = props.segmentWidth ?? ICON_SEGMENT * ui;
  const icon = Math.round(16 * ui);
  const enabled = props.options.filter((option) => !option.disabled);
  const choose = (id: string) => {
    setFocusTarget(id);
    if (id !== props.value) props.onChange?.(id);
  };
  const handleKey = (event: HitKeyEvent, id: string) => {
    const index = enabled.findIndex((option) => option.id === id);
    const step = (direction: -1 | 1) =>
      enabled[(index + direction + enabled.length) % enabled.length]?.id;
    let target: string | undefined;
    if (event.code === 105 || event.key === "ArrowLeft" || event.code === 103) target = step(-1);
    else if (event.code === 106 || event.key === "ArrowRight" || event.code === 108)
      target = step(1);
    else if (event.code === 102 || event.key === "Home") target = enabled[0]?.id;
    else if (event.code === 107 || event.key === "End") target = enabled.at(-1)?.id;
    else if (
      !event.repeat &&
      (event.code === 28 || event.code === 57 || event.key === "Enter" || event.key === " ")
    )
      target = id;
    if (target) choose(target);
  };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      <Rect
        width={width}
        height={height}
        fill={pal.surface}
        radius={8 * ui}
        stroke={pal.borderSubtle}
        strokeWidth={1}
      />
      {props.options.map((option, index) => {
        const selected = option.id === props.value;
        const segmentHeight = height - inset * 2;
        return (
          <Group
            key={option.id}
            x={inset + index * segment}
            y={inset}
            width={segment}
            height={segmentHeight}
          >
            <Pressable
              width={segment}
              height={segmentHeight}
              fill={selected ? pal.selection : 0x00000000}
              hoverFill={selected ? pal.selection : pal.hover}
              radius={6 * ui}
              disabled={option.disabled}
              focusable
              focusId={`icon-segments:${generatedId}:${option.id}`}
              autoFocus={focusTarget === option.id}
              onFocusChange={(next) => {
                setFocused((current) =>
                  next ? option.id : current === option.id ? null : current,
                );
                if (!next) setFocusTarget((current) => (current === option.id ? null : current));
              }}
              onHoverChange={(next) =>
                setHovered((current) => (next ? option.id : current === option.id ? null : current))
              }
              onKeyDown={(event) => handleKey(event, option.id)}
              onPress={() => choose(option.id)}
            />
            <Icon
              x={Math.round((segment - icon) / 2)}
              y={Math.round((segmentHeight - icon) / 2)}
              name={option.icon}
              size={icon}
              color={
                option.disabled
                  ? pal.border
                  : selected
                    ? pal.accentLine
                    : hovered === option.id
                      ? pal.text
                      : pal.muted
              }
              symbolic
            />
            <Tooltip
              width={segment}
              height={segmentHeight}
              label={option.label}
              placement={props.tooltipPlacement ?? "bottom"}
              open={hovered === option.id || focused === option.id}
              disabled={option.disabled}
            />
          </Group>
        );
      })}
    </Group>
  );
}

registerIntrinsicSize(IconSegmentedControl, (props) => iconSegmentedSize(props));

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
      const index = (from + direction * offset + props.options.length) % props.options.length;
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
    if (
      event.key === "ArrowUp" ||
      event.key === "ArrowLeft" ||
      event.code === 103 ||
      event.code === 105
    ) {
      move(index, -1);
    } else if (
      event.key === "ArrowDown" ||
      event.key === "ArrowRight" ||
      event.code === 108 ||
      event.code === 106
    ) {
      move(index, 1);
    } else if (
      event.key === " " ||
      event.key === "Enter" ||
      event.code === 57 ||
      event.code === 28
    ) {
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
          <Group key={option.id} width={props.width} height={rowHeight}>
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
                <Vertical
                  flexGrow={1}
                  height={option.description ? 35 : 20}
                  gap={1}
                  justify="center"
                >
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
