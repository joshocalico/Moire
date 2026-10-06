/** Multiline editing shared by document apps; text remains controlled by its owner. */
import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureTextBounds,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/react-host";
import { useWidgetTheme, resolveStatefulStyle } from "#ui/widget-theme";
import { readClipboardText, writeClipboardText } from "#ui/window";

export type TextAreaProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  focusId?: string;
  readOnly?: boolean;
  disabled?: boolean;
  fontFamily?: "sans" | "mono";
  fontSize?: number;
  lineNumbers?: boolean;
  captureTab?: boolean;
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  onFocusChange?: (focused: boolean) => void;
  onError?: (error: Error) => void;
};
type EditState = { value: string; cursor: number; anchor: number };
const previousCharacter = (value: string, offset: number) =>
  Math.max(0, offset - (offset > 1 && /[\uDC00-\uDFFF]/u.test(value[offset - 1]!) ? 2 : 1));
const nextCharacter = (value: string, offset: number) =>
  Math.min(value.length, offset + (/[\uD800-\uDBFF]/u.test(value[offset] ?? "") ? 2 : 1));

function characterBoundary(value: string, offset: number): number {
  const bounded = Math.max(0, Math.min(value.length, offset));
  return bounded > 0 &&
    /[\uD800-\uDBFF]/u.test(value[bounded - 1]!) &&
    /[\uDC00-\uDFFF]/u.test(value[bounded] ?? "")
    ? bounded - 1
    : bounded;
}

export function TextArea(props: TextAreaProps): ReactNode {
  const theme = useWidgetTheme(),
    recipe = theme.recipes.textField.medium;
  const generatedId = useId();
  const live = useRef<EditState>({
    value: props.value,
    cursor: props.value.length,
    anchor: props.value.length,
  });
  const [state, setState] = useState(live.current),
    [focused, setFocused] = useState(false);
  const scrollPosition = useRef({ x: 0, y: 0 });
  const lastCaret = useRef({ cursor: -1, value: "", width: 0, height: 0 });
  const [, redrawScroll] = useState(0);
  const [error, setError] = useState("");
  const history = useRef<{ undo: EditState[]; redo: EditState[] }>({ undo: [], redo: [] });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (props.value !== live.current.value) {
      history.current = { undo: [], redo: [] };
      live.current = {
        value: props.value,
        cursor: characterBoundary(props.value, live.current.cursor),
        anchor: characterBoundary(props.value, live.current.anchor),
      };
      setState(live.current);
    }
  }, [props.value]);
  const fontSize = props.fontSize ?? recipe.text.base.fontSize,
    fontFamily = props.fontFamily ?? "sans";
  const style = { fontSize, fontFamily };
  const measure = (text: string) => measureTextBounds(text, style).width;
  const lineHeight = Math.max(fontSize + 8, measureTextBounds("Mg", style).height + 4);
  const lines = state.value.split("\n");
  const gutter = props.lineNumbers ? measure(String(lines.length)) + 18 : 0;
  const padding = recipe.metrics.paddingX,
    textX = padding + gutter;
  const viewportWidth = Math.max(1, props.width - textX - padding);
  const viewportHeight = Math.max(1, props.height - padding * 2 - (error ? lineHeight : 0));
  const starts: number[] = [];
  let start = 0;
  for (const line of lines) {
    starts.push(start);
    start += line.length + 1;
  }
  const rowAt = (offset: number) => {
    let row = 0;
    while (row + 1 < starts.length && starts[row + 1]! <= offset) row++;
    return row;
  };
  const cursorRow = rowAt(state.cursor),
    cursorColumn = state.cursor - starts[cursorRow]!;
  const caretX = measure(lines[cursorRow]!.slice(0, cursorColumn));
  const maxY = Math.max(0, lines.length * lineHeight - viewportHeight);
  const scroll = scrollPosition.current;
  if (
    lastCaret.current.cursor !== state.cursor ||
    lastCaret.current.value !== state.value ||
    lastCaret.current.width !== viewportWidth ||
    lastCaret.current.height !== viewportHeight
  ) {
    scroll.x =
      caretX < scroll.x
        ? caretX
        : caretX > scroll.x + viewportWidth - 3
          ? Math.max(0, caretX - viewportWidth + 3)
          : scroll.x;
    scroll.y = Math.min(
      maxY,
      cursorRow * lineHeight < scroll.y
        ? cursorRow * lineHeight
        : (cursorRow + 1) * lineHeight > scroll.y + viewportHeight
          ? (cursorRow + 1) * lineHeight - viewportHeight
          : scroll.y,
    );
    lastCaret.current = {
      cursor: state.cursor,
      value: state.value,
      width: viewportWidth,
      height: viewportHeight,
    };
  }
  const publish = (next: EditState, edit = false) => {
    if (edit && next.value !== live.current.value) {
      history.current.undo.push({ ...live.current });
      if (history.current.undo.length > 100) history.current.undo.shift();
      history.current.redo = [];
    }
    const changed = next.value !== live.current.value;
    live.current = next;
    setState(next);
    setError("");
    if (changed) props.onChange?.(next.value);
  };
  const replace = (text: string) => {
    const current = live.current,
      from = Math.min(current.cursor, current.anchor),
      to = Math.max(current.cursor, current.anchor);
    publish(
      {
        value: current.value.slice(0, from) + text + current.value.slice(to),
        cursor: from + text.length,
        anchor: from + text.length,
      },
      true,
    );
  };
  const report = (caught: unknown) => {
    if (!mounted.current) return;
    const failure = caught instanceof Error ? caught : new Error(String(caught));
    setError(failure.message);
    props.onError?.(failure);
  };
  const key = (event: HitKeyEvent) => {
    if (props.onKeyDown?.(event) === true || props.disabled) return;
    const current = live.current,
      modifier = event.ctrlKey || event.metaKey;
    const character = event.key?.toLowerCase();
    const editable = !props.readOnly && !!props.onChange;
    const from = Math.min(current.cursor, current.anchor),
      to = Math.max(current.cursor, current.anchor);
    const move = (cursor: number) =>
      publish({ ...current, cursor, anchor: event.shiftKey ? current.anchor : cursor });
    if (modifier) {
      if (character === "a" || event.code === 30)
        publish({ ...current, anchor: 0, cursor: current.value.length });
      else if (character === "c" || event.code === 46 || character === "x" || event.code === 45) {
        if (from !== to)
          void writeClipboardText(current.value.slice(from, to))
            .then(() => {
              if (
                editable &&
                (character === "x" || event.code === 45) &&
                mounted.current &&
                live.current === current
              )
                replace("");
            })
            .catch(report);
      } else if (editable && (character === "v" || event.code === 47))
        void readClipboardText()
          .then((text) => {
            if (mounted.current) replace(text);
          })
          .catch(report);
      else if (
        editable &&
        (character === "z" || event.code === 44 || character === "y" || event.code === 21)
      ) {
        const redo = event.shiftKey || character === "y" || event.code === 21;
        const source = redo ? history.current.redo : history.current.undo,
          destination = redo ? history.current.undo : history.current.redo;
        const next = source.pop();
        if (next) {
          destination.push({ ...current });
          publish(next);
        }
      } else if (event.code === 102) move(0);
      else if (event.code === 107) move(current.value.length);
      return;
    }
    switch (event.code) {
      case 105:
        move(
          !event.shiftKey && from !== to ? from : previousCharacter(current.value, current.cursor),
        );
        return;
      case 106:
        move(!event.shiftKey && from !== to ? to : nextCharacter(current.value, current.cursor));
        return;
      case 102:
        move(current.value.slice(0, current.cursor).lastIndexOf("\n") + 1);
        return;
      case 107: {
        const end = current.value.indexOf("\n", current.cursor);
        move(end < 0 ? current.value.length : end);
        return;
      }
      case 103:
      case 108:
      case 104:
      case 109: {
        const currentLines = current.value.split("\n"),
          currentStarts: number[] = [];
        let offset = 0;
        for (const line of currentLines) {
          currentStarts.push(offset);
          offset += line.length + 1;
        }
        let row = 0;
        while (row + 1 < currentStarts.length && currentStarts[row + 1]! <= current.cursor) row++;
        const column = current.cursor - currentStarts[row]!;
        const delta =
          event.code === 103
            ? -1
            : event.code === 108
              ? 1
              : (event.code === 104 ? -1 : 1) *
                Math.max(1, Math.floor(viewportHeight / lineHeight));
        row = Math.max(0, Math.min(currentLines.length - 1, row + delta));
        move(
          characterBoundary(
            current.value,
            currentStarts[row]! + Math.min(column, currentLines[row]!.length),
          ),
        );
        return;
      }
      case 14:
        if (editable) {
          if (from !== to) replace("");
          else if (current.cursor > 0) {
            live.current = { ...current, anchor: previousCharacter(current.value, current.cursor) };
            replace("");
          }
        }
        return;
      case 111:
        if (editable) {
          if (from !== to) replace("");
          else {
            live.current = { ...current, anchor: nextCharacter(current.value, current.cursor) };
            replace("");
          }
        }
        return;
      case 28:
        if (editable) replace("\n");
        return;
      case 15:
        if (editable && props.captureTab) replace("\t");
        return;
    }
    if (editable && event.text && !event.altKey) replace(event.text);
  };
  const locate = (event: HitPointerEvent) => {
    const row = Math.max(
      0,
      Math.min(lines.length - 1, Math.floor((event.localY - padding + scroll.y) / lineHeight)),
    );
    const target = Math.max(0, event.localX - textX + scroll.x),
      line = lines[row]!;
    let column = 0,
      distance = Infinity;
    for (
      let index = 0;
      index <= line.length;
      index = index === line.length ? index + 1 : nextCharacter(line, index)
    ) {
      const next = Math.abs(measure(line.slice(0, index)) - target);
      if (next < distance) {
        distance = next;
        column = index;
      }
    }
    return starts[row]! + column;
  };
  const dragging = useRef(false);
  const box = resolveStatefulStyle(
    recipe.root,
    ...(focused ? ["focused" as const] : []),
    ...(props.disabled ? ["disabled" as const] : []),
  );
  const selectionFrom = Math.min(state.cursor, state.anchor),
    selectionTo = Math.max(state.cursor, state.anchor);
  const firstRow = Math.max(0, Math.floor(scroll.y / lineHeight)),
    lastRow = Math.min(lines.length, Math.ceil((scroll.y + viewportHeight) / lineHeight) + 1);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height} clip>
      <Rect
        width={props.width}
        height={props.height}
        fill={box.fill}
        radius={box.radius}
        stroke={box.stroke}
        strokeWidth={box.strokeWidth}
        focusable={!props.disabled}
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? `text-area:${generatedId}`}
        captureTab={props.captureTab}
        onFocusChange={(value) => {
          setFocused(value);
          props.onFocusChange?.(value);
        }}
        onKeyDown={key}
        onPointerDown={(event) => {
          if (event.button !== "left") return;
          dragging.current = true;
          const cursor = locate(event);
          publish({
            ...live.current,
            cursor,
            anchor: event.shiftKey ? live.current.anchor : cursor,
          });
        }}
        onPointerMove={(event) => {
          if (dragging.current) publish({ ...live.current, cursor: locate(event) });
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onWheel={(event) => {
          scrollPosition.current.y = Math.max(0, Math.min(maxY, scroll.y + (event.deltaY ?? 0)));
          redrawScroll((current) => current + 1);
        }}
      />
      <Group
        x={padding}
        y={padding}
        width={Math.max(1, props.width - padding * 2)}
        height={viewportHeight}
        clip
      >
        {lines.slice(firstRow, lastRow).map((line, visible) => {
          const row = firstRow + visible,
            y = row * lineHeight - scroll.y;
          const from = Math.max(0, selectionFrom - starts[row]!),
            to = Math.min(line.length, selectionTo - starts[row]!);
          const selected =
            selectionFrom < starts[row]! + line.length + 1 && selectionTo > starts[row]!;
          return (
            <Group key={row} width={props.width} height={lineHeight} y={y}>
              {props.lineNumbers && (
                <Text
                  text={String(row + 1)}
                  fontSize={fontSize}
                  fontFamily="mono"
                  color={theme.foundations.palette.muted}
                />
              )}
              {selected && (
                <Rect
                  x={gutter + measure(line.slice(0, from)) - scroll.x}
                  width={Math.max(4, measure(line.slice(from, Math.max(from, to))))}
                  height={lineHeight}
                  fill={(theme.foundations.palette.accent & 0x00ffffff) | 0x40000000}
                />
              )}
              <Text
                x={gutter - scroll.x}
                text={state.value ? line : (props.placeholder ?? "")}
                fontSize={fontSize}
                fontFamily={fontFamily}
                color={state.value ? recipe.text.base.color : recipe.placeholder.base.color}
              />
              {focused && row === cursorRow && (
                <Rect
                  x={gutter + caretX - scroll.x}
                  width={1}
                  height={lineHeight}
                  fill={recipe.text.base.color}
                />
              )}
            </Group>
          );
        })}
      </Group>
      {error && (
        <Text
          x={padding}
          y={props.height - padding - lineHeight}
          text={error}
          fontSize={11}
          color={theme.foundations.palette.accent}
        />
      )}
    </Group>
  );
}
