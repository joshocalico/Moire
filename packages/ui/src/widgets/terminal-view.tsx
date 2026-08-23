import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  measureTextBounds,
  type HitKeyEvent,
} from "@moire/react-host";
import {
  RichTextView,
  type RichTextLine,
  type RichTextRun,
} from "./rich-text.js";
import { useWidgetTheme } from "../widget-theme.js";

export type TerminalCursor = {
  line: number;
  column: number;
  visible?: boolean;
};

export type TerminalViewProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  lines: readonly RichTextLine[];
  cursor?: TerminalCursor;
  fontSize?: number;
  lineHeight?: number;
  padding?: number;
  scrollY?: number;
  onScroll?: (scrollY: number) => void;
  onKeyDown?: (event: HitKeyEvent) => void;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
  focusId?: string;
};

export type TerminalGridMetrics = {
  columns: number;
  rows: number;
  cellWidth: number;
  lineHeight: number;
};

export function measureTerminalGrid(
  width: number,
  height: number,
  options: { fontSize?: number; lineHeight?: number; padding?: number } = {},
): TerminalGridMetrics {
  const fontSize = options.fontSize ?? 13;
  const padding = options.padding ?? 10;
  const lineHeight = options.lineHeight ?? Math.ceil(fontSize * 1.55);
  const cellWidth = Math.max(
    1,
    measureTextBounds("M", { fontSize, fontFamily: "mono" }).width,
  );
  return {
    columns: Math.max(2, Math.floor((width - padding * 2) / cellWidth)),
    rows: Math.max(1, Math.floor((height - padding * 2) / lineHeight)),
    cellWidth,
    lineHeight,
  };
}

function cursorLine(
  source: RichTextLine,
  column: number,
  cursorBackground: number,
  cursorColor: number,
): RichTextLine {
  const runs: RichTextRun[] = [];
  let remaining = Math.max(0, column);
  let painted = false;
  for (const run of source.runs) {
    const chars = Array.from(run.text);
    if (painted || remaining >= chars.length) {
      runs.push(run);
      remaining -= chars.length;
      continue;
    }
    const before = chars.slice(0, remaining).join("");
    const underCursor = chars[remaining] ?? " ";
    const after = chars.slice(remaining + 1).join("");
    if (before) runs.push({ ...run, text: before });
    runs.push({
      ...run,
      text: underCursor,
      color: cursorColor,
      background: cursorBackground,
    });
    if (after) runs.push({ ...run, text: after });
    painted = true;
    remaining = 0;
  }
  if (!painted) {
    if (remaining > 0) runs.push({ text: " ".repeat(remaining) });
    runs.push({
      text: " ",
      color: cursorColor,
      background: cursorBackground,
    });
  }
  return { ...source, runs };
}

/**
 * Focus and caret semantics composed over RichTextView. Terminal protocol and
 * process ownership intentionally remain outside this renderer-native widget.
 */
export function TerminalView(props: TerminalViewProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const [focused, setFocused] = useState(false);
  const [blinkOn, setBlinkOn] = useState(true);
  useEffect(() => {
    if (!focused || props.cursor?.visible === false) {
      setBlinkOn(false);
      return;
    }
    setBlinkOn(true);
    const timer = setInterval(() => setBlinkOn((value) => !value), 520);
    return () => clearInterval(timer);
  }, [focused, props.cursor?.line, props.cursor?.column, props.cursor?.visible]);

  const lines = useMemo(() => {
    if (!focused || !blinkOn || !props.cursor || props.cursor.visible === false) {
      return props.lines;
    }
    return props.lines.map((line, index) =>
      index === props.cursor!.line
        ? cursorLine(line, props.cursor!.column, pal.text, pal.bg)
        : line,
    );
  }, [blinkOn, focused, pal.bg, pal.text, props.cursor, props.lines]);

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      clip
    >
      <RichTextView
        width={props.width}
        height={props.height}
        lines={lines}
        fontSize={props.fontSize}
        lineHeight={props.lineHeight}
        padding={props.padding}
        scrollY={props.scrollY}
        onScroll={props.onScroll}
        fill={pal.bg}
        stroke={focused ? pal.focusRing : pal.borderSubtle}
        strokeWidth={focused ? 2 : 1}
      />
      <Rect
        width={props.width}
        height={props.height}
        fill={0x00000000}
        focusable
        captureTab
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? "terminal-view"}
        onFocusChange={(next) => {
          setFocused(next);
          props.onFocusChange?.(next);
        }}
        onKeyDown={props.onKeyDown}
      />
    </Group>
  );
}
