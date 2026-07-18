import React, { useEffect, useId, useState, type ReactNode } from "react";
import {
  FONT_H,
  Group,
  Rect,
  Text,
  measureText,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/react-host";
import { themePalette } from "../theme.js";

export type TextFieldProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  value: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  onFocusChange?: (focused: boolean) => void;
  /** Optional controlled visual focus override. */
  focused?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
};

const PAD_X = 10;
const FONT_SIZE = 13;

function cursorFromX(value: string, localX: number): number {
  const target = Math.max(0, localX - PAD_X);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= value.length; index++) {
    const x = measureText(value.slice(0, index), FONT_SIZE / 14);
    const distance = Math.abs(x - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

export function TextField(props: TextFieldProps): ReactNode {
  const pal = themePalette();
  const generatedId = useId();
  const h = props.height ?? 32;
  const [internallyFocused, setInternallyFocused] = useState(false);
  const [cursor, setCursor] = useState(props.value.length);
  const focused = props.focused ?? internallyFocused;

  useEffect(() => {
    setCursor((current) => Math.min(current, props.value.length));
  }, [props.value]);

  const available = Math.max(1, props.width - PAD_X * 2);
  let visibleStart = 0;
  while (
    visibleStart < cursor &&
    measureText(props.value.slice(visibleStart, cursor), FONT_SIZE / 14) >
      available - 2
  ) {
    visibleStart++;
  }
  let visibleValue = props.value.slice(visibleStart);
  while (
    visibleValue.length > 0 &&
    measureText(visibleValue, FONT_SIZE / 14) > available
  ) {
    visibleValue = visibleValue.slice(0, -1);
  }
  const shown =
    props.value.length > 0 ? visibleValue : (props.placeholder ?? "");
  const textColor = props.disabled
    ? pal.muted
    : props.value.length > 0
      ? pal.text
      : pal.muted;
  const caretX =
    PAD_X +
    measureText(
      props.value.slice(visibleStart, cursor),
      FONT_SIZE / 14,
    );

  const replaceValue = (next: string, nextCursor: number) => {
    props.onChange?.(next);
    setCursor(nextCursor);
  };

  const handleKey = (event: HitKeyEvent) => {
    const editing = !props.disabled && !props.readOnly;
    switch (event.code) {
      case 1:
        props.onCancel?.();
        return;
      case 14:
        if (editing && cursor > 0) {
          replaceValue(
            props.value.slice(0, cursor - 1) + props.value.slice(cursor),
            cursor - 1,
          );
        }
        return;
      case 28:
        props.onSubmit?.(props.value);
        return;
      case 102:
        setCursor(0);
        return;
      case 105:
        setCursor((current) => Math.max(0, current - 1));
        return;
      case 106:
        setCursor((current) => Math.min(props.value.length, current + 1));
        return;
      case 107:
        setCursor(props.value.length);
        return;
      case 111:
        if (editing && cursor < props.value.length) {
          replaceValue(
            props.value.slice(0, cursor) + props.value.slice(cursor + 1),
            cursor,
          );
        }
        return;
    }

    if (
      editing &&
      event.text &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      replaceValue(
        props.value.slice(0, cursor) + event.text + props.value.slice(cursor),
        cursor + event.text.length,
      );
    }
  };

  const handlePress = (event: HitPointerEvent) => {
    if (!props.disabled) setCursor(cursorFromX(props.value, event.localX));
  };

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={h}
      clip
    >
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={h}
        fill={pal.surface}
        radius={pal.radiusSm}
        stroke={focused ? pal.focusRing : pal.borderSubtle}
        strokeWidth={focused ? 2 : 1}
        focusable={!props.disabled}
        focusId={`text-field:${generatedId}`}
        onFocusChange={(next) => {
          setInternallyFocused(next);
          if (next) setCursor(props.value.length);
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        onPress={handlePress}
      />
      <Text
        x={PAD_X}
        y={Math.floor((h - FONT_H) / 2)}
        text={shown}
        color={textColor}
        fontSize={FONT_SIZE}
      />
      {focused && !props.disabled ? (
        <Rect
          x={Math.min(props.width - PAD_X, caretX)}
          y={Math.floor((h - FONT_H) / 2) - 1}
          width={1}
          height={FONT_H + 2}
          fill={pal.text}
        />
      ) : null}
    </Group>
  );
}
