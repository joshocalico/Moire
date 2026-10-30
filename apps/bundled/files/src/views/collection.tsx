/**
 * A folder's items as page blocks. List: folders as cards (folded behind "Show all" past a
 * dozen), then 46px file rows. Grid: tiles in rows. Trash lists everything as rows.
 */
import React from "react";
import {
  FileTile,
  ImageWidget,
  ItemCard,
  fileTileHeight,
  getUiScaleFactor,
  usePalette,
  type HoverAction,
  type SelectionModel,
} from "@moire/ui";
import type { Entry } from "#files/filesystem";
import { entryKind, extensionBadge, folderTint, kindIcon, kindTint } from "#files/kind-style";
import { visibleFolders } from "#files/model";
import type { CollectionShape } from "#files/collection-keys";
import { FileRow, ROW_PITCH, type ItemInteraction } from "./file-row";
import type { PageBlock } from "./page-scroller";
import { previewKindFor } from "#files/preview/model";
import { useThumbnail } from "#files/preview/use-thumbnail";

const CARD_HEIGHT = 56;
const CARD_GAP = 12;
const CARD_MIN_WIDTH = 240;
const CARD_COLUMNS_MAX = 4;
const TILE = 128;
const TILE_GAP = 16;
const FILE_TILE_INSET = 6;
export const SHOW_ALL_FOLDERS_ID = "files:show-all-folders";

type CollectionOptions = {
  view: "list" | "grid";
  width: number;
  entries: readonly Entry[];
  /** Trash: every item is a row, folders included. */
  rowsOnly: boolean;
  showAllFolders: boolean;
  onShowAllFolders(): void;
  selection: SelectionModel<string>;
  interaction(entry: Entry, shape: CollectionShape): ItemInteraction;
  caption(entry: Entry): string;
  trailing(entry: Entry): string;
  actions(entry: Entry): readonly HoverAction[];
  /** A card's ⋯; folders have their item menu there. */
  onCardMenu(entry: Entry, at: { x: number; y: number }): void;
};

/** Cards per row: three or four on wide pages, two at 640px. */
function cardColumns(width: number): number {
  const ui = getUiScaleFactor();
  return Math.max(
    1,
    Math.min(
      CARD_COLUMNS_MAX,
      Math.floor((width + CARD_GAP * ui) / ((CARD_MIN_WIDTH + CARD_GAP) * ui)),
    ),
  );
}

function gridColumns(width: number): number {
  const ui = getUiScaleFactor();
  return Math.max(1, Math.floor((width + TILE_GAP * ui) / ((TILE + TILE_GAP) * ui)));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    rows.push(items.slice(index, index + size));
  return rows;
}

function GridTile(props: {
  x: number;
  entry: Entry;
  width: number;
  detail: string;
  selected: boolean;
  interaction: ItemInteraction;
}) {
  const pal = usePalette();
  const kind = entryKind(props.entry);
  // FileTile insets its square picture 6px on each side; the thumbnail is made at that size.
  const side = props.width - 2 * FILE_TILE_INSET * getUiScaleFactor();
  // Pages show whole (their middle is mostly paper); everything else fills the tile.
  const fit = previewKindFor(props.entry) === "pdf" ? "contain" : "cover";
  const picture = useThumbnail(props.entry, { width: side, height: side, fit });
  return (
    <FileTile
      x={props.x}
      width={props.width}
      name={props.entry.name}
      detail={props.detail}
      icon={kindIcon(kind)}
      tint={kindTint(kind, pal)}
      extension={props.entry.isDir ? undefined : extensionBadge(props.entry.name)}
      thumbnail={
        picture
          ? (size) => (
              <ImageWidget
                width={size.width}
                height={size.height}
                bitmap={picture}
                fit={fit}
                placeholder={false}
              />
            )
          : undefined
      }
      selected={props.selected}
      {...props.interaction}
    />
  );
}

export function collectionBlocks(options: CollectionOptions): PageBlock[] {
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const blocks: PageBlock[] = [];
  const { selection } = options;
  if (options.view === "grid") {
    const columns = gridColumns(options.width);
    const gap = px(TILE_GAP);
    const tile = Math.floor((options.width - gap * (columns - 1)) / columns);
    const height = fileTileHeight({ width: tile, detail: "x" });
    const shape: CollectionShape = { kind: "grid", columns };
    chunk(options.entries, columns).forEach((row, index) =>
      blocks.push({
        key: `tiles:${index}`,
        height: height + gap,
        keys: row.map((entry) => entry.path),
        render: () =>
          row.map((entry, column) => (
            <GridTile
              key={entry.path}
              x={column * (tile + gap)}
              entry={entry}
              width={tile}
              detail={options.caption(entry)}
              selected={selection.isSelected(entry.path)}
              interaction={options.interaction(entry, shape)}
            />
          )),
      }),
    );
    return blocks;
  }
  const folders = options.rowsOnly ? [] : options.entries.filter((entry) => entry.isDir);
  const files = options.rowsOnly
    ? options.entries
    : options.entries.filter((entry) => !entry.isDir);
  if (folders.length) {
    const columns = cardColumns(options.width);
    const gap = px(CARD_GAP);
    const cardWidth = Math.floor((options.width - gap * (columns - 1)) / columns);
    const { shown, hidden } = visibleFolders(folders, options.showAllFolders);
    const cards: Array<Entry | "show-all"> = [...shown, ...(hidden ? (["show-all"] as const) : [])];
    const shape: CollectionShape = { kind: "list", card: true };
    chunk(cards, columns).forEach((row, index) =>
      blocks.push({
        key: `cards:${index}`,
        height: px(CARD_HEIGHT) + px(8),
        keys: row.flatMap((card) => (card === "show-all" ? [] : [card.path])),
        render: () =>
          row.map((card, column) =>
            card === "show-all" ? (
              <ItemCard
                key="show-all"
                x={column * (cardWidth + gap)}
                width={cardWidth}
                icon="folder"
                title={`Show all ${folders.length} folders`}
                detail={`${hidden} more`}
                focusId={SHOW_ALL_FOLDERS_ID}
                onPress={options.onShowAllFolders}
              />
            ) : (
              <ItemCard
                key={card.path}
                x={column * (cardWidth + gap)}
                width={cardWidth}
                icon="folder-filled"
                tint={folderTint(card.name)}
                title={card.name}
                detail={options.caption(card)}
                selected={selection.isSelected(card.path)}
                onMenu={(event) =>
                  options.onCardMenu(card, event ? { x: event.x, y: event.y } : { x: 0, y: 0 })
                }
                menuLabel={`Actions for ${card.name}`}
                {...options.interaction(card, shape)}
              />
            ),
          ),
      }),
    );
    blocks.push({ key: "cards:gap", height: px(8), render: () => null });
  }
  const shape: CollectionShape = { kind: "list", card: false };
  for (const entry of files)
    blocks.push({
      key: entry.path,
      height: px(ROW_PITCH),
      keys: [entry.path],
      render: (width) => (
        <FileRow
          width={width}
          entry={entry}
          caption={options.caption(entry)}
          trailing={options.trailing(entry)}
          actions={options.actions(entry)}
          selected={selection.isSelected(entry.path)}
          interaction={options.interaction(entry, shape)}
        />
      ),
    });
  return blocks;
}
