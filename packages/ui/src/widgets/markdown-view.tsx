/**
 * Markdown read-only: headings in steps of size, wrapped paragraphs, bulleted and numbered lists,
 * code blocks on a code surface, quotes with a bar, tables as aligned rows, and rules — in one
 * scrollable column. For previews and help text, not editing.
 */
import React, { useMemo, type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { parseMarkdown, type MarkdownBlock } from "./markdown";
import { TextBlock, measureWrappedText } from "./primitives";
import { ScrollArea } from "./scroll";

export type MarkdownViewProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  markdown: string;
  /** Body text size; headings scale from it. */
  fontSize?: number;
  scrollY?: number;
  onScroll?: (scrollY: number) => void;
};

const HEADING_SCALE = [1.6, 1.35, 1.17, 1.05, 1, 1] as const;
const BLOCK_GAP = 8;
const PADDING = 14;
const LIST_INDENT = 18;
const CODE_PADDING = 8;
const TASK_BOX = 12;
/** Previews show the start of a document; past this many blocks the rest is left out. */
const MAX_BLOCKS = 500;

type Placed = { block: MarkdownBlock; y: number; height: number; text?: string; style?: Style };
type Style = { fontSize: number; fontWeight?: "medium" | "bold"; fontFamily?: "mono" };

export function MarkdownView(props: MarkdownViewProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const body = props.fontSize ?? 13;
  const blocks = useMemo(
    () => parseMarkdown(props.markdown).slice(0, MAX_BLOCKS),
    [props.markdown],
  );
  const inner = Math.max(1, props.width - px(PADDING) * 2);
  const placed: Placed[] = [];
  let y = px(PADDING);
  for (const block of blocks) {
    let height: number;
    let text: string | undefined;
    let style: Style | undefined;
    if (block.kind === "rule") height = px(9);
    else if (block.kind === "code" || block.kind === "table") {
      text = block.kind === "code" ? block.lines.join("\n") : tableText(block.rows);
      style = { fontSize: body - 1, fontFamily: "mono" };
      const lineHeight = measureWrappedText("Mg", inner, style).lineHeight;
      height = Math.max(1, text.split("\n").length) * lineHeight + px(CODE_PADDING) * 2;
    } else {
      const indent =
        block.kind === "item"
          ? px(LIST_INDENT) * (block.depth + 1)
          : block.kind === "quote"
            ? px(12)
            : 0;
      text = block.text;
      style =
        block.kind === "heading"
          ? {
              fontSize: Math.round(body * HEADING_SCALE[block.level - 1]!),
              fontWeight: block.level <= 2 ? "bold" : "medium",
            }
          : { fontSize: body };
      height = measureWrappedText(text, Math.max(1, inner - indent), style).height;
    }
    // Headings sit closer to what follows them than to what came before.
    if (block.kind === "heading" && placed.length) y += px(BLOCK_GAP);
    placed.push({ block, y, height, text, style });
    y += height + px(block.kind === "item" ? BLOCK_GAP / 2 : BLOCK_GAP);
  }
  const contentHeight = y + px(PADDING);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height} clip>
      <ScrollArea
        width={props.width}
        height={props.height}
        contentHeight={Math.max(props.height, contentHeight)}
        scrollY={props.scrollY}
        onScroll={props.onScroll}
        fill={0x00000000}
      >
        {placed.map(({ block, y: top, height, text, style }, index) => {
          const x = px(PADDING);
          if (block.kind === "rule")
            return (
              <Rect key={index} x={x} y={top + px(4)} width={inner} height={1} fill={pal.border} />
            );
          if (block.kind === "code" || block.kind === "table")
            return (
              <Group key={index} x={x} y={top} width={inner} height={height}>
                <Rect
                  width={inner}
                  height={height}
                  fill={pal.panel}
                  radius={px(6)}
                  stroke={pal.borderSubtle}
                  strokeWidth={1}
                />
                <TextBlock
                  x={px(CODE_PADDING)}
                  y={px(CODE_PADDING)}
                  width={inner - px(CODE_PADDING) * 2}
                  height={height - px(CODE_PADDING) * 2}
                  text={text!}
                  {...style}
                  overflow="clip"
                />
              </Group>
            );
          if (block.kind === "item") {
            const indent = px(LIST_INDENT) * block.depth;
            return (
              <Group key={index} x={x + indent} y={top} width={inner - indent} height={height}>
                {block.done === undefined ? (
                  <TextBlock
                    width={px(LIST_INDENT)}
                    text={block.marker}
                    color={pal.muted}
                    {...style}
                  />
                ) : (
                  <TaskBox
                    done={block.done}
                    size={px(TASK_BOX)}
                    y={Math.round((lineHeightOf(style!) - px(TASK_BOX)) / 2)}
                  />
                )}
                <TextBlock
                  x={px(LIST_INDENT)}
                  width={inner - indent - px(LIST_INDENT)}
                  height={height}
                  text={text!}
                  wrap
                  {...style}
                />
              </Group>
            );
          }
          if (block.kind === "quote")
            return (
              <Group key={index} x={x} y={top} width={inner} height={height}>
                <Rect width={px(3)} height={height} fill={pal.accentLine} radius={px(1)} />
                <TextBlock
                  x={px(12)}
                  width={inner - px(12)}
                  height={height}
                  text={text!}
                  color={pal.muted}
                  wrap
                  {...style}
                />
              </Group>
            );
          return (
            <TextBlock
              key={index}
              x={x}
              y={top}
              width={inner}
              height={height}
              text={text!}
              wrap
              {...style}
            />
          );
        })}
      </ScrollArea>
    </Group>
  );
}

function lineHeightOf(style: Style): number {
  return measureWrappedText("Mg", 1000, style).lineHeight;
}

/** A task list item's box: an outline, or filled with a tick when done. */
function TaskBox(props: { done: boolean; size: number; y: number }): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  return (
    <Group y={props.y} width={props.size} height={props.size}>
      <Rect
        width={props.size}
        height={props.size}
        radius={Math.max(2, Math.round(props.size / 4))}
        fill={props.done ? pal.accentLine : 0x00000000}
        stroke={props.done ? pal.accentLine : pal.muted}
        strokeWidth={1}
      />
      {props.done ? (
        <TextBlock
          width={props.size}
          height={props.size}
          text="✓"
          color={0xffffffff}
          fontSize={9}
          fontWeight="bold"
          horizontalAlign="center"
          verticalAlign="center"
        />
      ) : null}
    </Group>
  );
}

/** Columns padded to their widest cell, so a table reads in a monospaced block. */
function tableText(rows: readonly string[][]): string {
  const widths: number[] = [];
  for (const row of rows)
    row.forEach((cell, column) => (widths[column] = Math.max(widths[column] ?? 0, cell.length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
