import React, { useEffect, useId, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureText,
  measureTextBounds,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type WidgetIconStyle,
  type WidgetState,
} from "#ui/widget-theme";
import { registerIntrinsicSize } from "./layout";

export type TextFieldSlot = ReactNode | ((style: WidgetIconStyle) => ReactNode);

export type TextFieldProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  value: string;
  placeholder?: string;
  leading?: TextFieldSlot;
  trailing?: TextFieldSlot;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  /** Pointer activation, useful for anchoring adjacent overlays in host space. */
  onPress?: (event: HitPointerEvent) => void;
  /** Return true to consume a key before the built-in editor handles it. */
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  onFocusChange?: (focused: boolean) => void;
  /** Optional controlled visual focus override. */
  focused?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
};

function cursorFromX(value: string, localX: number, textX: number, fontSize: number): number {
  const target = Math.max(0, localX - textX);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= value.length; index++) {
    const x = measureText(value.slice(0, index), fontSize / 14);
    const distance = Math.abs(x - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function renderSlot(slot: TextFieldSlot, style: WidgetIconStyle): ReactNode {
  return typeof slot === "function" ? slot(style) : slot;
}

export function TextField(props: TextFieldProps): ReactNode {
  const theme = useWidgetTheme();
  const recipe = theme.recipes.textField[props.size ?? "medium"];
  const generatedId = useId();
  const height = props.height ?? recipe.metrics.height;
  const [internallyFocused, setInternallyFocused] = useState(false);
  const [cursor, setCursor] = useState(props.value.length);
  const focused = props.focused ?? internallyFocused;
  const states: WidgetState[] = [];
  if (focused) states.push("focused");
  if (props.invalid) states.push("invalid");
  if (props.disabled) states.push("disabled");
  const root = resolveStatefulStyle(recipe.root, ...states);
  const textStyle = resolveStatefulStyle(recipe.text, props.disabled ? "disabled" : "rest");
  const placeholderStyle = resolveStatefulStyle(
    recipe.placeholder,
    props.disabled ? "disabled" : "rest",
  );
  const iconStates: WidgetState[] = [];
  if (focused) iconStates.push("focused");
  if (props.disabled) iconStates.push("disabled");
  const leadingStyle = resolveStatefulStyle(recipe.leadingIcon, ...iconStates);
  const trailingStyle = resolveStatefulStyle(recipe.trailingIcon, ...iconStates);
  const lineHeight = measureTextBounds("Mg", {
    fontSize: textStyle.fontSize,
    fontWeight: textStyle.fontWeight,
  }).height;
  const leadingWidth = props.leading ? leadingStyle.size + recipe.metrics.slotGap : 0;
  const trailingWidth = props.trailing ? trailingStyle.size + recipe.metrics.slotGap : 0;
  const textX = recipe.metrics.paddingX + leadingWidth;

  useEffect(() => {
    setCursor((current) => Math.min(current, props.value.length));
  }, [props.value]);

  const available = Math.max(1, props.width - textX - trailingWidth - recipe.metrics.paddingX);
  let visibleStart = 0;
  while (
    visibleStart < cursor &&
    measureText(props.value.slice(visibleStart, cursor), textStyle.fontSize / 14) > available - 2
  ) {
    visibleStart++;
  }
  let visibleValue = props.value.slice(visibleStart);
  while (
    visibleValue.length > 0 &&
    measureText(visibleValue, textStyle.fontSize / 14) > available
  ) {
    visibleValue = visibleValue.slice(0, -1);
  }
  const shown = props.value.length > 0 ? visibleValue : (props.placeholder ?? "");
  const shownStyle = props.value.length > 0 ? textStyle : placeholderStyle;
  const caretX =
    textX + measureText(props.value.slice(visibleStart, cursor), textStyle.fontSize / 14);

  const replaceValue = (next: string, nextCursor: number) => {
    props.onChange?.(next);
    setCursor(nextCursor);
  };

  const handleKey = (event: HitKeyEvent) => {
    if (props.onKeyDown?.(event) === true) return;
    const editing = !props.disabled && !props.readOnly;
    switch (event.code) {
      case 1:
        props.onCancel?.();
        return;
      case 14:
        if (editing && cursor > 0) {
          replaceValue(props.value.slice(0, cursor - 1) + props.value.slice(cursor), cursor - 1);
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
          replaceValue(props.value.slice(0, cursor) + props.value.slice(cursor + 1), cursor);
        }
        return;
    }

    if (editing && event.text && !event.ctrlKey && !event.altKey && !event.metaKey) {
      replaceValue(
        props.value.slice(0, cursor) + event.text + props.value.slice(cursor),
        cursor + event.text.length,
      );
    }
  };

  const handlePress = (event: HitPointerEvent) => {
    if (!props.disabled) {
      setCursor(cursorFromX(props.value, event.localX, textX, textStyle.fontSize));
    }
    props.onPress?.(event);
  };

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height} clip>
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={height}
        fill={root.fill}
        radius={root.radius}
        stroke={root.stroke}
        strokeWidth={root.strokeWidth}
        focusable={!props.disabled}
        autoFocus={props.autoFocus}
        focusId={`text-field:${generatedId}`}
        onFocusChange={(next) => {
          setInternallyFocused(next);
          if (next) setCursor(props.value.length);
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        onPress={handlePress}
      />
      {props.leading ? (
        <Group
          x={recipe.metrics.paddingX}
          y={Math.floor((height - leadingStyle.size) / 2)}
          width={leadingStyle.size}
          height={leadingStyle.size}
        >
          {renderSlot(props.leading, leadingStyle)}
        </Group>
      ) : null}
      <Text
        x={textX}
        y={Math.floor((height - lineHeight) / 2)}
        text={shown}
        color={shownStyle.color}
        fontSize={shownStyle.fontSize}
        fontWeight={shownStyle.fontWeight}
      />
      {focused && !props.disabled ? (
        <Rect
          x={Math.min(props.width - recipe.metrics.paddingX - trailingWidth, caretX)}
          y={Math.floor((height - lineHeight) / 2) - 1}
          width={recipe.caret.width}
          height={lineHeight + 2}
          fill={recipe.caret.fill}
        />
      ) : null}
      {props.trailing ? (
        <Group
          x={props.width - recipe.metrics.paddingX - trailingStyle.size}
          y={Math.floor((height - trailingStyle.size) / 2)}
          width={trailingStyle.size}
          height={trailingStyle.size}
        >
          {renderSlot(props.trailing, trailingStyle)}
        </Group>
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(TextField, (props, theme) => ({
  width: props.width,
  height: props.height ?? theme.recipes.textField[props.size ?? "medium"].metrics.height,
}));
