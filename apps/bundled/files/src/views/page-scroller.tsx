/**
 * A page as a stack of blocks (title, chips, sections, card rows, file rows) in one scroller.
 * Only blocks near the viewport are drawn, plus the one holding keyboard focus so focus never
 * lands on nothing. A sticky header covers the top once the title has scrolled away (or always,
 * in short windows), and the item that takes focus is scrolled clear of it and of the
 * selection bar at the bottom.
 */
import React, { useEffect, useRef, type ReactNode } from "react";
import { Box, PointerArea, ScrollArea, Surface, usePalette, type HitPointerEvent } from "@moire/ui";

export type PageBlock = {
  key: string;
  height: number;
  /** Item keys drawn by this block, for scrolling the focused item into view. */
  keys?: readonly string[];
  render: (width: number) => ReactNode;
};

type StickyHeader = {
  height: number;
  render: (width: number) => ReactNode;
  /** Pinned from the start, or once the page has scrolled this far. */
  from: "start" | number;
};

export type RubberBand = {
  onPointerDown(event: HitPointerEvent): void;
  onPointerMove(event: HitPointerEvent): void;
  onPointerUp(event: HitPointerEvent): void;
  rect: { x: number; y: number; width: number; height: number } | null;
};

/** Blocks drawn beyond the viewport, so short scrolls never show a gap. */
const OVERSCAN = 400;

export function PageScroller(props: {
  width: number;
  height: number;
  /** Horizontal margin around the blocks. */
  pad: number;
  blocks: readonly PageBlock[];
  sticky: StickyHeader | null;
  scrollY: number;
  onScroll(scrollY: number): void;
  focusKey: string | null;
  /** Room kept free at the bottom for the floating selection bar. */
  bottomReserve: number;
  band: RubberBand | null;
}): ReactNode {
  const pal = usePalette();
  const pinned = props.sticky?.from === "start";
  const top = pinned ? props.sticky!.height : 0;
  const viewport = Math.max(1, props.height - top);
  const width = Math.max(1, props.width - props.pad * 2);
  const offsets: number[] = [];
  let total = 0;
  for (const block of props.blocks) {
    offsets.push(total);
    total += block.height;
  }
  const contentHeight = total + props.bottomReserve;
  const maxScroll = Math.max(0, contentHeight - viewport);
  const scrollY = Math.max(0, Math.min(maxScroll, props.scrollY));
  const stickyShown = !!props.sticky && (pinned || scrollY >= (props.sticky.from as number));

  // Scroll the newly focused item clear of the sticky header and the selection bar.
  const previousFocus = useRef(props.focusKey);
  const onScroll = props.onScroll;
  useEffect(() => {
    if (previousFocus.current === props.focusKey) return;
    // The first focus of a page (its first item taking focus) never scrolls it.
    const moved = previousFocus.current !== null;
    previousFocus.current = props.focusKey;
    if (!props.focusKey || !moved) return;
    const index = props.blocks.findIndex((block) => block.keys?.includes(props.focusKey!));
    if (index < 0) return;
    const start = offsets[index]!;
    const end = start + props.blocks[index]!.height;
    const stickyHeight = props.sticky && !pinned ? props.sticky.height : 0;
    if (start < scrollY + stickyHeight) onScroll(Math.max(0, start - stickyHeight));
    else if (end > scrollY + viewport - props.bottomReserve)
      onScroll(Math.min(maxScroll, end - viewport + props.bottomReserve));
  });

  const low = scrollY - OVERSCAN;
  const high = scrollY + viewport + OVERSCAN;
  return (
    <Box width={props.width} height={props.height}>
      <ScrollArea
        y={top}
        width={props.width}
        height={viewport}
        contentHeight={contentHeight}
        scrollY={scrollY}
        onScroll={onScroll}
        smooth={false}
        fill={0x00000000}
      >
        {props.band ? (
          <PointerArea
            width={props.width}
            height={Math.max(contentHeight, viewport)}
            onPointerDown={props.band.onPointerDown}
            onPointerMove={props.band.onPointerMove}
            onPointerUp={props.band.onPointerUp}
          />
        ) : null}
        {props.blocks.map((block, index) => {
          const y = offsets[index]!;
          const near = y + block.height >= low && y <= high;
          const focused = !!props.focusKey && !!block.keys?.includes(props.focusKey);
          if (!near && !focused) return null;
          return (
            <Box key={block.key} x={props.pad} y={y} width={width} height={block.height}>
              {block.render(width)}
            </Box>
          );
        })}
        {props.band?.rect ? (
          <Surface
            x={props.band.rect.x}
            y={props.band.rect.y}
            width={Math.max(1, props.band.rect.width)}
            height={Math.max(1, props.band.rect.height)}
            fill={((pal.accent & 0x00ffffff) | 0x26000000) >>> 0}
            stroke={pal.accent}
            strokeWidth={1}
            radius={2}
          />
        ) : null}
      </ScrollArea>
      {stickyShown && props.sticky ? (
        <Surface width={props.width} height={props.sticky.height} fill={pal.bg}>
          {/* Rows scrolled under the header are covered: presses here never reach them. */}
          <PointerArea width={props.width} height={props.sticky.height} onPointerDown={() => {}} />
          <Box x={props.pad} width={width} height={props.sticky.height}>
            {props.sticky.render(width)}
          </Box>
        </Surface>
      ) : null}
    </Box>
  );
}
