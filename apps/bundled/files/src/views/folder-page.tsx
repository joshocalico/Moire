/**
 * A place as a page: its title block and kind chips, then its sections and items. In short
 * windows (and once scrolled past the title) a one-line header with the chips stays on top.
 * The columns view keeps the title and fills the rest with its columns instead.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  ChipGroup,
  filterChipHeight,
  getUiScaleFactor,
  type ChipGroupItem,
  type WindowSize,
} from "@moire/ui";
import {
  COLLAPSED_HEADER_HEIGHT,
  CollapsedHeader,
  FULL_HEADER_HEIGHT,
  FullHeader,
  type HeaderControls,
  type PathLineSlot,
} from "./page-header";
import { PageScroller, type PageBlock, type RubberBand } from "./page-scroller";

const CHIPS_GAP = 14;
const HEADER_GAP = 10;

type PageHeading = {
  title: string;
  subtitle: string;
  /** The collapsed header's detail: "in Home / Work". */
  detail: string;
  capacity: number | null;
  pathLine: PathLineSlot;
  pathEditing: boolean;
  controls: HeaderControls;
};

type PageChips = {
  items: readonly ChipGroupItem[];
  selectedId: string;
  onSelect(chip: ChipGroupItem): void;
};

export function FolderPage(props: {
  width: number;
  height: number;
  pad: number;
  /** Short window: the header starts collapsed. */
  compact: boolean;
  heading: PageHeading;
  chips: PageChips | null;
  blocks: readonly PageBlock[];
  /** Shown under the header when there are no blocks: an EmptyState. */
  empty: ((size: WindowSize) => ReactNode) | null;
  /** The columns view: fills the page below the header instead of scrolling blocks. */
  fill: ((size: WindowSize) => ReactNode) | null;
  scrollY: number;
  onScroll(scrollY: number): void;
  focusKey: string | null;
  bottomReserve: number;
  band: RubberBand | null;
}): ReactNode {
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const width = Math.max(1, props.width - props.pad * 2);
  const chipsHeight = props.chips ? filterChipHeight() + px(CHIPS_GAP) : 0;
  const full = px(FULL_HEADER_HEIGHT) + px(HEADER_GAP);
  const collapsed = px(COLLAPSED_HEADER_HEIGHT);
  const chips = (chipWidth: number) =>
    props.chips ? (
      <ChipGroup
        width={chipWidth}
        chips={props.chips.items}
        selectedId={props.chips.selectedId}
        onSelect={props.chips.onSelect}
      />
    ) : null;
  const fullHeader = (headerWidth: number) => (
    <FullHeader
      width={headerWidth}
      pathLine={props.heading.pathLine}
      pathEditing={props.heading.pathEditing}
      title={props.heading.title}
      subtitle={props.heading.subtitle}
      capacity={props.heading.capacity}
      controls={props.heading.controls}
    />
  );
  const collapsedHeader = (headerWidth: number) => (
    <Box width={headerWidth} height={collapsed + chipsHeight}>
      <CollapsedHeader
        width={headerWidth}
        pathLine={props.heading.pathLine}
        pathEditing={props.heading.pathEditing}
        title={props.heading.title}
        detail={props.heading.detail}
        controls={props.heading.controls}
      />
      <Box y={collapsed} width={headerWidth} height={chipsHeight}>
        {chips(headerWidth)}
      </Box>
    </Box>
  );
  if (props.fill) {
    // Columns: the full title when there is room for it, the one-line header otherwise.
    const top = props.compact ? collapsed : full;
    return (
      <Box width={props.width} height={props.height}>
        <Box x={props.pad} width={width} height={top}>
          {props.compact ? (
            <CollapsedHeader
              width={width}
              pathLine={props.heading.pathLine}
              pathEditing={props.heading.pathEditing}
              title={props.heading.title}
              detail={props.heading.detail}
              controls={props.heading.controls}
            />
          ) : (
            fullHeader(width)
          )}
        </Box>
        <Box y={top} width={props.width} height={Math.max(1, props.height - top)}>
          {props.fill({ width: props.width, height: Math.max(1, props.height - top) })}
        </Box>
      </Box>
    );
  }
  const header: PageBlock[] = props.compact
    ? []
    : [
        { key: "header", height: full, render: fullHeader },
        ...(props.chips ? [{ key: "chips", height: chipsHeight, render: chips }] : []),
      ];
  const sticky = {
    height: collapsed + chipsHeight,
    render: collapsedHeader,
    from: props.compact ? ("start" as const) : full,
  };
  const used =
    header.reduce((sum, block) => sum + block.height, 0) + (props.compact ? sticky.height : 0);
  const blocks: PageBlock[] = [
    ...header,
    ...(props.blocks.length || !props.empty
      ? props.blocks
      : [
          {
            key: "empty",
            height: Math.max(px(260), props.height - used - props.bottomReserve),
            render: (emptyWidth: number) =>
              props.empty!({
                width: emptyWidth,
                height: Math.max(px(260), props.height - used - props.bottomReserve),
              }),
          },
        ]),
  ];
  return (
    <PageScroller
      width={props.width}
      height={props.height}
      pad={props.pad}
      blocks={blocks}
      sticky={sticky}
      scrollY={props.scrollY}
      onScroll={props.onScroll}
      focusKey={props.focusKey}
      bottomReserve={props.bottomReserve}
      band={props.band}
    />
  );
}
