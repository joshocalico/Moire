/**
 * Home's sections above its own contents: pinned places, recent files, and browsing by kind.
 * Each section is left out when it would be empty.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  ChipGroup,
  CollectionItem,
  DropZone,
  ItemCard,
  TextBlock,
  filterChipHeight,
  filterChipWidth,
  getUiScaleFactor,
  usePalette,
  type ChipGroupItem,
  type HitPointerEvent,
} from "@moire/ui";
import type { RecentFile } from "@moire/file-operations";
import type { FilePlace } from "#files/places";
import { folderTint } from "#files/kind-style";
import { formatRecent } from "#files/format";
import type { PageBlock } from "./page-scroller";
import { Thumbnail } from "./thumbnail";

/** Drops on the Pinned section pin folders. */
export const PIN_DROP = "files:pin";
const HEADING = 36;
const PINNED_HEIGHT = 84;
const PINNED_MIN_WIDTH = 180;
const RECENT_MIN_WIDTH = 120;
const RECENT_MAX = 8;
const RECENT_PICTURE = 104;
const GAP = 12;
const SECTION_GAP = 20;

function Heading(props: {
  width: number;
  text: string;
  action?: { label: string; onPress(): void };
}) {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const height = Math.round(HEADING * ui);
  return (
    <Box width={props.width} height={height}>
      <TextBlock
        width={props.width}
        height={height}
        text={props.text}
        fontSize={13}
        fontWeight="medium"
        verticalAlign="center"
      />
      {props.action ? (
        <Button
          x={props.width - Math.round(64 * ui)}
          y={Math.round((height - 28 * ui) / 2)}
          width={Math.round(64 * ui)}
          height={Math.round(28 * ui)}
          size="small"
          variant="ghost"
          color={pal.accentLine}
          label={props.action.label}
          onPress={props.action.onPress}
        />
      ) : null}
    </Box>
  );
}

function RecentCard(props: {
  x: number;
  width: number;
  file: RecentFile;
  now: number;
  onOpen(): void;
  onContextMenu(event: HitPointerEvent): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const picture = px(RECENT_PICTURE);
  const height = picture + px(40);
  return (
    <Box x={props.x} width={props.width} height={height}>
      <CollectionItem
        width={props.width}
        height={height}
        focusId={`recent:${props.file.path}`}
        onPress={props.onOpen}
        onContextMenu={props.onContextMenu}
      >
        <Thumbnail
          entry={{ ...props.file, isDir: false }}
          width={props.width}
          height={picture}
          radius={px(12)}
          iconScale={0.35}
        />
        <TextBlock
          x={px(2)}
          y={picture + px(6)}
          width={props.width - px(4)}
          height={px(18)}
          text={props.file.name}
          fontSize={12}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
        <TextBlock
          x={px(2)}
          y={picture + px(24)}
          width={props.width - px(4)}
          height={px(14)}
          text={formatRecent(props.file.usedAt, props.now)}
          color={pal.muted}
          fontSize={11}
          verticalAlign="center"
          maxLines={1}
        />
      </CollectionItem>
    </Box>
  );
}

/** The height ChipGroup takes when it wraps these chips into `width`. */
function wrappedChipsHeight(chips: readonly ChipGroupItem[], width: number): number {
  const gap = Math.round(8 * getUiScaleFactor());
  let rows = 1;
  let x = 0;
  for (const chip of chips) {
    const chipWidth = filterChipWidth(chip);
    if (x > 0 && x + chipWidth > width) {
      rows++;
      x = 0;
    }
    x += chipWidth + gap;
  }
  return rows * filterChipHeight() + (rows - 1) * gap;
}

type OverviewOptions = {
  width: number;
  pinned: readonly FilePlace[];
  onOpenPlace(place: FilePlace): void;
  onPlaceMenu(place: FilePlace, at: { x: number; y: number }): void;
  recent: readonly RecentFile[];
  now: number;
  onOpenRecent(file: RecentFile): void;
  onRecentMenu(file: RecentFile, event: HitPointerEvent): void;
  onSeeAllRecent(): void;
  /** Kind chips with counts from the index; empty without one. */
  kinds: readonly ChipGroupItem[];
  onKind(chip: ChipGroupItem): void;
  /** The heading above Home's own contents. */
  contentsHeading: string;
};

export function overviewBlocks(options: OverviewOptions): PageBlock[] {
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const gap = px(GAP);
  const heading = px(HEADING);
  const blocks: PageBlock[] = [];
  if (options.pinned.length) {
    const columns = Math.max(
      1,
      Math.min(4, Math.floor((options.width + gap) / (px(PINNED_MIN_WIDTH) + gap))),
    );
    const cardWidth = Math.floor((options.width - gap * (columns - 1)) / columns);
    const rows = Math.ceil(options.pinned.length / columns);
    const height = heading + rows * (px(PINNED_HEIGHT) + gap) + px(SECTION_GAP) - gap;
    blocks.push({
      key: "pinned",
      height,
      render: (width) => (
        <DropZone width={width} height={height} id={PIN_DROP}>
          <Heading width={width} text="Pinned" />
          {options.pinned.map((place, index) => (
            <ItemCard
              key={place.id}
              x={(index % columns) * (cardWidth + gap)}
              y={heading + Math.floor(index / columns) * (px(PINNED_HEIGHT) + gap)}
              width={cardWidth}
              layout="stacked"
              tint={folderTint(place.label)}
              icon={
                place.icon === "home" || place.icon === "desktop" ? "folder-filled" : place.icon
              }
              title={place.label}
              focusId={`pinned:${place.id}`}
              dropData={place.path}
              onPress={() => options.onOpenPlace(place)}
              onMenu={(event) =>
                options.onPlaceMenu(place, event ? { x: event.x, y: event.y } : { x: 0, y: 0 })
              }
              menuLabel={`Actions for ${place.label}`}
              onContextMenu={(event) => options.onPlaceMenu(place, { x: event.x, y: event.y })}
            />
          ))}
        </DropZone>
      ),
    });
  }
  if (options.recent.length) {
    const count = Math.max(
      1,
      Math.min(
        RECENT_MAX,
        options.recent.length,
        Math.floor((options.width + gap) / (px(RECENT_MIN_WIDTH) + gap)),
      ),
    );
    const cardWidth = Math.floor((options.width - gap * (count - 1)) / count);
    const height = heading + px(RECENT_PICTURE) + px(40) + px(SECTION_GAP);
    blocks.push({
      key: "recent",
      height,
      render: (width) => (
        <Box width={width} height={height}>
          <Heading
            width={width}
            text="Recent"
            action={{ label: "See all", onPress: options.onSeeAllRecent }}
          />
          <Box y={heading} width={width} height={height - heading}>
            {options.recent.slice(0, count).map((file, index) => (
              <RecentCard
                key={file.path}
                x={index * (cardWidth + gap)}
                width={cardWidth}
                file={file}
                now={options.now}
                onOpen={() => options.onOpenRecent(file)}
                onContextMenu={(event) => options.onRecentMenu(file, event)}
              />
            ))}
          </Box>
        </Box>
      ),
    });
  }
  if (options.kinds.length) {
    const height = heading + wrappedChipsHeight(options.kinds, options.width) + px(SECTION_GAP);
    blocks.push({
      key: "kinds",
      height,
      render: (width) => (
        <Box width={width} height={height}>
          <Heading width={width} text="Browse by kind" />
          <ChipGroup
            y={heading}
            width={width}
            chips={options.kinds}
            wrap
            onSelect={options.onKind}
          />
        </Box>
      ),
    });
  }
  if (blocks.length)
    blocks.push({
      key: "contents-heading",
      height: heading,
      render: (width) => <Heading width={width} text={options.contentsHeading} />,
    });
  return blocks;
}
