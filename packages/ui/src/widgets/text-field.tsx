import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
import { readClipboardText } from "#ui/window";

export type TextFieldSlot = ReactNode | ((style: WidgetIconStyle) => ReactNode);

export type TextFieldProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  value: string;
  /** Paint one bullet per UTF-16 unit; keep the caller-owned editing value private. */
  password?: boolean;
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
  /** Deliver Tab to `onKeyDown` (for completion) instead of moving focus. */
  captureTab?: boolean;
  onFocusChange?: (focused: boolean) => void;
  /** Optional controlled visual focus override. */
  focused?: boolean;
  autoFocus?: boolean;
  /** Stable id for focus restoration and for smokes that find the field (see windowControl). */
  focusId?: string;
  selectAllOnFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Paint no field box: a composite field (TokenField) draws one around this editor. */
  chromeless?: boolean;
};

/** Fields in this process whose editor holds focus; see `isEditingText`. */
const editingFields = new Set<string>();

/**
 * Whether a text field (or a field built on one: SearchField, TokenField) has keyboard focus.
 * Apps that start a search when you type on a page use it to leave typing in fields alone.
 * It covers the whole process, which for an app is its window.
 */
export function isEditingText(): boolean {
  return editingFields.size > 0;
}

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
  // Focus and input can arrive in the same host event turn. Keep the editor
  // position current immediately, while React state drives its presentation.
  const position = useRef({
    cursor: props.value.length,
    anchor: props.autoFocus && props.selectAllOnFocus ? 0 : props.value.length,
  });
  const [selection, setSelection] = useState(position.current);
  const { cursor, anchor } = selection;
  const setCursor = (value: number | ((current: number) => number)) => {
    const next = typeof value === "function" ? value(position.current.cursor) : value;
    if (next === position.current.cursor) return;
    position.current = {
      ...position.current,
      cursor: next,
    };
    setSelection(position.current);
  };
  const setAnchor = (value: number | ((current: number) => number)) => {
    const next = typeof value === "function" ? value(position.current.anchor) : value;
    if (next === position.current.anchor) return;
    position.current = {
      ...position.current,
      anchor: next,
    };
    setSelection(position.current);
  };
  const focused = props.focused ?? internallyFocused;
  const displayValue = props.password ? "•".repeat(props.value.length) : props.value;
  const currentFocus = useRef(focused);
  currentFocus.current = focused;
  const currentProps = useRef(props);
  currentProps.current = props;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      editingFields.delete(generatedId);
    };
  }, []);
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

  const previousValue = useRef(props.value);
  useEffect(() => {
    // A caret at the end follows a value the owner extends (completion);
    // otherwise it stays put, clamped to the new length.
    const followEnd = position.current.cursor === previousValue.current.length;
    previousValue.current = props.value;
    setCursor((current) =>
      followEnd ? props.value.length : Math.min(current, props.value.length),
    );
    setAnchor((current) =>
      followEnd ? props.value.length : Math.min(current, props.value.length),
    );
  }, [props.value]);

  const available = Math.max(1, props.width - textX - trailingWidth - recipe.metrics.paddingX);
  let visibleStart = 0;
  while (
    visibleStart < cursor &&
    measureText(displayValue.slice(visibleStart, cursor), textStyle.fontSize / 14) > available - 2
  ) {
    visibleStart++;
  }
  let visibleValue = displayValue.slice(visibleStart);
  while (
    visibleValue.length > 0 &&
    measureText(visibleValue, textStyle.fontSize / 14) > available
  ) {
    visibleValue = visibleValue.slice(0, -1);
  }
  const shown = props.value.length > 0 ? visibleValue : (props.placeholder ?? "");
  const shownStyle = props.value.length > 0 ? textStyle : placeholderStyle;
  const caretX =
    textX + measureText(displayValue.slice(visibleStart, cursor), textStyle.fontSize / 14);

  const replaceValue = (next: string, nextCursor: number) => {
    props.onChange?.(next);
    setCursor(nextCursor);
    setAnchor(nextCursor);
  };

  const handleKey = (event: HitKeyEvent) => {
    const shortcut = event.ctrlKey || event.metaKey;
    if (
      props.password &&
      shortcut &&
      (event.code === 46 ||
        event.code === 45 ||
        event.key?.toLowerCase() === "c" ||
        event.key?.toLowerCase() === "x")
    )
      return;
    if (props.onKeyDown?.(event) === true) return;
    const editing = !props.disabled && !props.readOnly;
    const { cursor, anchor } = position.current;
    const start = Math.min(anchor, cursor),
      end = Math.max(anchor, cursor);
    if (props.password && shortcut && (event.code === 47 || event.key?.toLowerCase() === "v")) {
      if (editing) {
        const source = props.value,
          selection = position.current;
        void readClipboardText()
          .then((text) => {
            const latest = currentProps.current;
            if (
              !mounted.current ||
              !currentFocus.current ||
              latest.disabled ||
              latest.readOnly ||
              !latest.password ||
              latest.value !== source ||
              position.current !== selection
            )
              return;
            const singleLine = text.replace(/[\r\n]/g, "");
            latest.onChange?.(source.slice(0, start) + singleLine + source.slice(end));
            setCursor(start + singleLine.length);
            setAnchor(start + singleLine.length);
          })
          .catch(() => {
            /* Clipboard failure leaves the existing secret unchanged. */
          });
      }
      return;
    }
    const moveCursor = (next: number) => {
      setCursor(next);
      if (!event.shiftKey) setAnchor(next);
    };
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key?.toLowerCase() === "a" || event.code === 30)
    ) {
      setAnchor(0);
      setCursor(props.value.length);
      return;
    }
    switch (event.code) {
      case 1:
        props.onCancel?.();
        return;
      case 14:
        if (editing && (cursor > 0 || start !== end)) {
          const from = start !== end ? start : cursor - 1;
          replaceValue(props.value.slice(0, from) + props.value.slice(end), from);
        }
        return;
      case 28:
        props.onSubmit?.(props.value);
        return;
      case 102:
        moveCursor(0);
        return;
      case 105:
        moveCursor(!event.shiftKey && start !== end ? start : Math.max(0, cursor - 1));
        return;
      case 106:
        moveCursor(
          !event.shiftKey && start !== end ? end : Math.min(props.value.length, cursor + 1),
        );
        return;
      case 107:
        moveCursor(props.value.length);
        return;
      case 111:
        if (editing && (cursor < props.value.length || start !== end)) {
          replaceValue(
            props.value.slice(0, start) + props.value.slice(start !== end ? end : cursor + 1),
            start,
          );
        }
        return;
    }

    if (editing && event.text && !event.ctrlKey && !event.altKey && !event.metaKey) {
      replaceValue(
        props.value.slice(0, start) + event.text + props.value.slice(end),
        start + event.text.length,
      );
    }
  };

  const handlePress = (event: HitPointerEvent) => {
    if (!props.disabled) {
      const next = cursorFromX(displayValue, event.localX, textX, textStyle.fontSize);
      setCursor(next);
      if (!event.shiftKey) setAnchor(next);
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
        fill={props.chromeless ? 0x00000000 : root.fill}
        radius={root.radius}
        stroke={props.chromeless ? undefined : root.stroke}
        strokeWidth={props.chromeless ? undefined : root.strokeWidth}
        focusable={!props.disabled}
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? `text-field:${generatedId}`}
        onFocusChange={(next) => {
          setInternallyFocused(next);
          if (next) editingFields.add(generatedId);
          else editingFields.delete(generatedId);
          if (next) {
            setCursor(props.value.length);
            setAnchor(props.selectAllOnFocus ? 0 : props.value.length);
          }
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        captureTab={props.captureTab}
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
      {focused && anchor !== cursor ? (
        <Rect
          x={Math.max(
            textX,
            textX +
              measureText(
                displayValue.slice(visibleStart, Math.max(visibleStart, Math.min(anchor, cursor))),
                textStyle.fontSize / 14,
              ),
          )}
          y={Math.floor((height - lineHeight) / 2)}
          width={Math.min(
            available,
            measureText(
              displayValue.slice(
                Math.max(visibleStart, Math.min(anchor, cursor)),
                Math.max(anchor, cursor),
              ),
              textStyle.fontSize / 14,
            ),
          )}
          height={lineHeight}
          fill={
            ((resolveStatefulStyle(recipe.root, "focused").stroke ?? recipe.caret.fill) &
              0x00ffffff) |
            0x40000000
          }
        />
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
