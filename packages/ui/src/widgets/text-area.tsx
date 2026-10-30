/** Multiline editing shared by document apps; text remains controlled by its owner. */
import React, { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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
import type { DocumentSelection } from "./document-model";

export type TextRange = { from: number; to: number };
/**
 * A programmatic edit or selection, applied once per new object. `replace` is an undoable edit
 * reported through `onChange`; `select` is in offsets of the resulting text and is scrolled into
 * view (centred when it was off screen).
 */
export type TextAreaCommand = {
  replace?: TextRange & { text: string };
  select: DocumentSelection;
};

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
  /** Soft-wrap long lines at the field's width instead of scrolling sideways. */
  wrap?: boolean;
  /** Sorted, non-overlapping ranges painted behind the text, such as search matches. */
  highlights?: readonly TextRange[];
  command?: TextAreaCommand;
  onSelectionChange?: (selection: DocumentSelection) => void;
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  onFocusChange?: (focused: boolean) => void;
  onError?: (error: Error) => void;
};
/** One painted row: a whole line, or one wrapped segment of it. `end` excludes the newline. */
type VisualRow = {
  start: number;
  end: number;
  line: number;
  lineStart: boolean;
  lineEnd: boolean;
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

/** Search-match amber, legible behind text in light and dark themes. */
const HIGHLIGHT = 0x66f2b640;

/** Split text into painted rows; with `width`, long lines break after spaces where they can. */
function layoutRows(value: string, measure: (text: string) => number, width?: number): VisualRow[] {
  const rows: VisualRow[] = [];
  let start = 0;
  value.split("\n").forEach((text, line) => {
    const lineEnd = start + text.length;
    if (width === undefined || measure(text) <= width) {
      rows.push({ start, end: lineEnd, line, lineStart: true, lineEnd: true });
    } else {
      let from = 0;
      while (from < text.length) {
        // The longest prefix that fits, found by bisection, then pulled back to a word break.
        let low = from + 1,
          high = text.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (measure(text.slice(from, middle)) <= width) low = middle;
          else high = middle - 1;
        }
        let to = characterBoundary(text, low);
        if (to <= from) to = nextCharacter(text, from);
        if (to < text.length) {
          const space = text.lastIndexOf(" ", to - 1);
          if (space >= from) to = space + 1;
        }
        rows.push({
          start: start + from,
          end: start + to,
          line,
          lineStart: from === 0,
          lineEnd: to >= text.length,
        });
        from = to;
      }
    }
    start = lineEnd + 1;
  });
  return rows;
}

/** Index of the row that shows `offset`; a wrap point belongs to the row it starts. */
function rowAt(rows: readonly VisualRow[], offset: number): number {
  let low = 0,
    high = rows.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (rows[middle]!.start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Index of the first range that ends after `offset` in sorted, non-overlapping `ranges`. */
function firstRangeAfter(ranges: readonly TextRange[], offset: number): number {
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle]!.to <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
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
  const revealCentered = useRef(false);
  const [, redrawScroll] = useState(0);
  const [error, setError] = useState("");
  const history = useRef<{ undo: EditState[]; redo: EditState[] }>({
    undo: [],
    redo: [],
  });
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
  const lineCount = useMemo(() => state.value.split("\n").length, [state.value]);
  const gutter = props.lineNumbers ? measure(String(lineCount)) + 18 : 0;
  const padding = recipe.metrics.paddingX,
    textX = padding + gutter;
  const viewportWidth = Math.max(1, props.width - textX - padding);
  const viewportHeight = Math.max(1, props.height - padding * 2 - (error ? lineHeight : 0));
  // A little slack keeps the caret visible at the end of a full wrapped row.
  const wrapWidth = props.wrap ? Math.max(1, viewportWidth - 4) : undefined;
  const rows = useMemo(
    () => layoutRows(state.value, measure, wrapWidth),
    [state.value, wrapWidth, fontSize, fontFamily],
  );
  const rowText = (row: VisualRow, value = state.value) => value.slice(row.start, row.end);
  /** The offset in `row` of `value` nearest to `x` (in text coordinates). */
  const offsetInRow = (value: string, row: VisualRow, x: number) => {
    const text = rowText(row, value);
    let column = 0,
      distance = Infinity;
    for (
      let index = 0;
      index <= text.length;
      index = index === text.length ? index + 1 : nextCharacter(text, index)
    ) {
      const next = Math.abs(measure(text.slice(0, index)) - x);
      if (next < distance) {
        distance = next;
        column = index;
      }
    }
    // A wrapped row's last offset belongs to the next row, so stay before it.
    if (!row.lineEnd && column === text.length) column = previousCharacter(text, column);
    return row.start + column;
  };
  const cursorRow = rowAt(rows, state.cursor);
  const caretX = measure(state.value.slice(rows[cursorRow]!.start, state.cursor));
  const maxY = Math.max(0, rows.length * lineHeight - viewportHeight);
  const scroll = scrollPosition.current;
  if (
    lastCaret.current.cursor !== state.cursor ||
    lastCaret.current.value !== state.value ||
    lastCaret.current.width !== viewportWidth ||
    lastCaret.current.height !== viewportHeight
  ) {
    scroll.x = props.wrap
      ? 0
      : caretX < scroll.x
        ? caretX
        : caretX > scroll.x + viewportWidth - 3
          ? Math.max(0, caretX - viewportWidth + 3)
          : scroll.x;
    const top = cursorRow * lineHeight,
      outside = top < scroll.y || top + lineHeight > scroll.y + viewportHeight;
    scroll.y = Math.max(
      0,
      Math.min(
        maxY,
        outside && revealCentered.current
          ? top - (viewportHeight - lineHeight) / 2
          : top < scroll.y
            ? top
            : top + lineHeight > scroll.y + viewportHeight
              ? top + lineHeight - viewportHeight
              : scroll.y,
      ),
    );
    revealCentered.current = false;
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
    const previous = live.current;
    live.current = next;
    setState(next);
    setError("");
    if (next.value !== previous.value) props.onChange?.(next.value);
    if (next.cursor !== previous.cursor || next.anchor !== previous.anchor)
      props.onSelectionChange?.({ anchor: next.anchor, focus: next.cursor });
  };
  useEffect(() => {
    const command = props.command;
    if (!command) return;
    let value = live.current.value;
    if (command.replace) {
      const from = characterBoundary(value, command.replace.from),
        to = characterBoundary(value, Math.max(from, command.replace.to));
      value = value.slice(0, from) + command.replace.text + value.slice(to);
    }
    revealCentered.current = true;
    publish(
      {
        value,
        cursor: characterBoundary(value, command.select.focus),
        anchor: characterBoundary(value, command.select.anchor),
      },
      !!command.replace,
    );
  }, [props.command]);
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
      publish({
        ...current,
        cursor,
        anchor: event.shiftKey ? current.anchor : cursor,
      });
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
        // Keys can arrive faster than renders, so lay out the live value when it is newer.
        const liveRows =
          current.value === state.value ? rows : layoutRows(current.value, measure, wrapWidth);
        const row = rowAt(liveRows, current.cursor);
        const column = current.cursor - liveRows[row]!.start;
        const delta =
          event.code === 103
            ? -1
            : event.code === 108
              ? 1
              : (event.code === 104 ? -1 : 1) *
                Math.max(1, Math.floor(viewportHeight / lineHeight));
        const target = liveRows[Math.max(0, Math.min(liveRows.length - 1, row + delta))]!;
        // A wrapped row's end offset is drawn on the next row, so stop one character short.
        const end = target.lineEnd ? target.end : previousCharacter(current.value, target.end);
        move(characterBoundary(current.value, Math.min(target.start + column, end)));
        return;
      }
      case 14:
        if (editable) {
          if (from !== to) replace("");
          else if (current.cursor > 0) {
            live.current = {
              ...current,
              anchor: previousCharacter(current.value, current.cursor),
            };
            replace("");
          }
        }
        return;
      case 111:
        if (editable) {
          if (from !== to) replace("");
          else {
            live.current = {
              ...current,
              anchor: nextCharacter(current.value, current.cursor),
            };
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
      Math.min(rows.length - 1, Math.floor((event.localY - padding + scroll.y) / lineHeight)),
    );
    return offsetInRow(state.value, rows[row]!, Math.max(0, event.localX - textX + scroll.x));
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
    lastRow = Math.min(rows.length, Math.ceil((scroll.y + viewportHeight) / lineHeight) + 1);
  const highlights = props.highlights ?? [];
  const band = (row: VisualRow, from: number, to: number, fill: number, key: string) => {
    const text = rowText(row);
    const start = Math.max(0, from - row.start),
      end = Math.min(text.length, to - row.start);
    return (
      <Rect
        key={key}
        x={gutter + measure(text.slice(0, start)) - scroll.x}
        width={Math.max(4, measure(text.slice(start, Math.max(start, end))))}
        height={lineHeight}
        fill={fill}
      />
    );
  };
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
          const next = Math.max(0, Math.min(maxY, scroll.y + (event.deltaY ?? 0)));
          // At its limit the field lets an enclosing scroller take the wheel.
          if (next === scroll.y) return false;
          scrollPosition.current.y = next;
          redrawScroll((current) => current + 1);
          return true;
        }}
      />
      <Group
        x={padding}
        y={padding}
        width={Math.max(1, props.width - padding * 2)}
        height={viewportHeight}
        clip
      >
        {rows.slice(firstRow, lastRow).map((row, visible) => {
          const index = firstRow + visible,
            y = index * lineHeight - scroll.y;
          // A line's trailing newline is selectable, so a selection across it shows on the row.
          const rowLimit = row.end + (row.lineEnd ? 1 : 0);
          const selected = selectionFrom < rowLimit && selectionTo > row.start;
          const matches: ReactNode[] = [];
          for (
            let match = firstRangeAfter(highlights, row.start);
            match < highlights.length && highlights[match]!.from < rowLimit;
            match++
          )
            matches.push(
              band(row, highlights[match]!.from, highlights[match]!.to, HIGHLIGHT, `h${match}`),
            );
          return (
            <Group key={index} width={props.width} height={lineHeight} y={y}>
              {props.lineNumbers && row.lineStart && (
                <Text
                  text={String(row.line + 1)}
                  fontSize={fontSize}
                  fontFamily="mono"
                  color={theme.foundations.palette.muted}
                />
              )}
              {matches}
              {selected &&
                band(
                  row,
                  selectionFrom,
                  selectionTo,
                  (theme.foundations.palette.accent & 0x00ffffff) | 0x40000000,
                  "selection",
                )}
              <Text
                x={gutter - scroll.x}
                text={state.value ? rowText(row) : (props.placeholder ?? "")}
                fontSize={fontSize}
                fontFamily={fontFamily}
                color={state.value ? recipe.text.base.color : recipe.placeholder.base.color}
              />
              {focused && index === cursorRow && (
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
