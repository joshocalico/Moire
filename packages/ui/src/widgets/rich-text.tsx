import React, { type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { ScrollArea } from "./scroll";
import { useWidgetTheme } from "#ui/widget-theme";
import { getUiScaleFactor } from "#ui/font";

export type RichTextRun = {
  text: string;
  color?: number;
  background?: number;
  fontWeight?: "regular" | "medium" | "bold";
  fontFamily?: "sans" | "mono";
};

export type RichTextLine = {
  id?: string;
  runs: readonly RichTextRun[];
};

export type RichTextViewProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  lines: readonly RichTextLine[];
  fontSize?: number;
  lineHeight?: number;
  padding?: number;
  lineNumbers?: boolean;
  /** Number of the first line, when the lines are an excerpt. */
  firstLine?: number;
  fill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
  scrollY?: number;
  onScroll?: (scrollY: number) => void;
  scrollbar?: boolean;
};

/** Styled text runs with one shared renderer-native layout and scroll model. */
export function RichTextView(props: RichTextViewProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const fontSize = props.fontSize ?? 12;
  // Text is drawn at fontSize × the UI scale, so default metrics scale with it.
  const lineHeight = props.lineHeight ?? Math.ceil(fontSize * ui * 1.55);
  const padding = props.padding ?? Math.round(10 * ui);
  const firstLine = props.firstLine ?? 1;
  const lastNumber = String(firstLine + props.lines.length - 1);
  const gutter = props.lineNumbers
    ? measureTextBounds("0".repeat(Math.max(2, lastNumber.length)), {
        fontSize,
        fontFamily: "mono",
      }).width + Math.round(14 * ui)
    : 0;
  const contentHeight = Math.max(props.height, padding * 2 + props.lines.length * lineHeight);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height} clip>
      <Rect
        width={props.width}
        height={props.height}
        fill={props.fill ?? 0xff171b20}
        radius={props.radius ?? pal.radiusMd}
        stroke={props.stroke ?? pal.borderSubtle}
        strokeWidth={props.strokeWidth ?? 1}
      />
      <ScrollArea
        width={props.width}
        height={props.height}
        contentHeight={contentHeight}
        fill={0x00000000}
        scrollY={props.scrollY}
        onScroll={props.onScroll}
        scrollbar={props.scrollbar}
      >
        {props.lines.map((line, lineIndex) => {
          let cursorX = padding + gutter;
          return (
            <Group
              key={line.id ?? lineIndex}
              x={0}
              y={padding + lineIndex * lineHeight}
              width={props.width}
              height={lineHeight}
            >
              {props.lineNumbers ? (
                <Text
                  x={padding}
                  y={0}
                  text={String(firstLine + lineIndex).padStart(Math.max(2, lastNumber.length), " ")}
                  color={pal.muted}
                  fontSize={fontSize}
                  fontFamily="mono"
                />
              ) : null}
              {line.runs.map((run, runIndex) => {
                const style = {
                  fontSize,
                  fontFamily: run.fontFamily ?? ("mono" as const),
                  fontWeight: run.fontWeight ?? ("regular" as const),
                };
                const bounds = measureTextBounds(run.text, style);
                const x = cursorX;
                cursorX += bounds.width;
                return (
                  <Group key={runIndex} x={x} y={0} width={bounds.width} height={lineHeight}>
                    {run.background != null ? (
                      <Rect
                        x={0}
                        y={0}
                        width={Math.max(1, bounds.width)}
                        height={lineHeight}
                        fill={run.background}
                      />
                    ) : null}
                    <Text x={0} y={0} text={run.text} color={run.color ?? pal.text} {...style} />
                  </Group>
                );
              })}
            </Group>
          );
        })}
      </ScrollArea>
    </Group>
  );
}
