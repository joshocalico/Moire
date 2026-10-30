/**
 * Picture choices: a selectable picture with a label under it and a ring when chosen (a style,
 * a wallpaper, a panel layout), and a row of them that behaves as one radio group.
 */
import React, { useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { registerIntrinsicSize } from "./layout";
import { Pressable } from "./pressable";
import { Surface, TextBlock } from "./primitives";

export type OptionCardProps = {
  x?: number;
  y?: number;
  width: number;
  /** Picture and label together. */
  height: number;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  focusId?: string;
  focusable?: boolean;
  autoFocus?: boolean;
  onPress?: () => void;
  onKeyDown?: (event: HitKeyEvent) => void;
  /** The picture, drawn clipped into the card's upper part. */
  children?: (size: { width: number; height: number }) => ReactNode;
};

const LABEL = 26;
const RADIUS = 10;

/** The label strip under the picture, scaled. */
export function optionCardLabelHeight(): number {
  return LABEL * getUiScaleFactor();
}

export function OptionCard(props: OptionCardProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const picture = Math.max(1, props.height - LABEL * ui);
  const radius = RADIUS * ui;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Surface width={props.width} height={picture} radius={radius} fill={pal.bg} clip>
        {props.children?.({ width: props.width, height: picture })}
      </Surface>
      <Rect
        width={props.width}
        height={picture}
        radius={radius}
        fill={0x00000000}
        stroke={props.selected ? pal.accent : pal.borderSubtle}
        strokeWidth={props.selected ? 2 * ui : 1}
      />
      <Pressable
        width={props.width}
        height={props.height}
        radius={radius}
        fill={0x00000000}
        hoverFill={0x14000000 | (pal.text & 0x00ffffff)}
        pressedFill={0x22000000 | (pal.text & 0x00ffffff)}
        disabled={props.disabled}
        focusable={props.focusable ?? true}
        autoFocus={props.autoFocus}
        focusId={props.focusId}
        onKeyDown={props.onKeyDown}
        onPress={props.onPress}
      />
      <TextBlock
        y={picture + 4 * ui}
        width={props.width}
        height={LABEL * ui - 6 * ui}
        text={props.label}
        fontSize={12}
        fontWeight={props.selected ? "medium" : "regular"}
        color={props.disabled ? pal.muted : props.selected ? pal.accent : pal.text}
        horizontalAlign="center"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
    </Group>
  );
}

export type PictureOption = {
  id: string;
  label: string;
  disabled?: boolean;
  picture: (size: { width: number; height: number }) => ReactNode;
};

export type PictureOptionsProps = {
  x?: number;
  y?: number;
  width: number;
  /** One card's height, picture and label; rows of cards stack these. */
  height: number;
  options: readonly PictureOption[];
  value: string | null;
  onChange?: (id: string) => void;
  /** Gap between cards in unscaled pixels; 10 by default. */
  gap?: number;
  /** Cards per row; all in one row by default. Further cards wrap onto more rows. */
  columns?: number;
  /** Focus ids become `<focusId>:<option id>`. */
  focusId?: string;
};

/** Height of a set of picture options laid out in rows of `columns`. */
export function pictureOptionsHeight(
  count: number,
  cardHeight: number,
  columns = count,
  gap = 10,
): number {
  const rows = Math.max(1, Math.ceil(count / Math.max(1, columns)));
  return rows * cardHeight + (rows - 1) * gap * getUiScaleFactor();
}

/**
 * Cards side by side sharing the width. One focus stop; arrows move the choice like a radio
 * group, and Enter or Space chooses the focused card.
 */
export function PictureOptions(props: PictureOptionsProps): ReactNode {
  const ui = getUiScaleFactor();
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const gap = (props.gap ?? 10) * ui;
  const columns = Math.max(1, props.columns ?? props.options.length);
  const cardWidth = Math.max(1, Math.floor((props.width - gap * (columns - 1)) / columns));
  const height = pictureOptionsHeight(props.options.length, props.height, columns, props.gap);
  const enabled = props.options.filter((option) => !option.disabled);
  const selected = props.options.findIndex((option) => option.id === props.value);
  const tabStop = selected >= 0 ? props.options[selected]!.id : enabled[0]?.id;
  const move = (from: string, delta: number) => {
    const index = enabled.findIndex((option) => option.id === from);
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (!next) return;
    setFocusTarget(next.id);
    props.onChange?.(next.id);
  };
  const handleKey = (event: HitKeyEvent, option: PictureOption) => {
    if (
      event.code === 106 ||
      event.code === 108 ||
      event.key === "ArrowRight" ||
      event.key === "ArrowDown"
    )
      move(option.id, 1);
    else if (
      event.code === 105 ||
      event.code === 103 ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp"
    )
      move(option.id, -1);
    else if (
      !event.repeat &&
      (event.code === 57 || event.code === 28 || event.key === " " || event.key === "Enter")
    )
      props.onChange?.(option.id);
  };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      {props.options.map((option, index) => (
        <OptionCard
          key={option.id}
          x={(index % columns) * (cardWidth + gap)}
          y={Math.floor(index / columns) * (props.height + gap)}
          width={cardWidth}
          height={props.height}
          label={option.label}
          selected={option.id === props.value}
          disabled={option.disabled}
          focusable={option.id === tabStop}
          autoFocus={focusTarget === option.id}
          focusId={props.focusId ? `${props.focusId}:${option.id}` : undefined}
          onKeyDown={(event) => handleKey(event, option)}
          onPress={() => {
            setFocusTarget(option.id);
            props.onChange?.(option.id);
          }}
        >
          {option.picture}
        </OptionCard>
      ))}
    </Group>
  );
}

registerIntrinsicSize(OptionCard, (props) => ({ width: props.width, height: props.height }));
registerIntrinsicSize(PictureOptions, (props) => ({
  width: props.width,
  height: pictureOptionsHeight(props.options.length, props.height, props.columns, props.gap),
}));
