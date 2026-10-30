/**
 * The desktop layer: icons over the wallpaper, under windows. It draws only
 * what the desktop model decided — selection, the drop target, where a drop
 * would land, the rubber band and an inline rename field.
 */
import React, { type ReactNode } from "react";
import { Group, Rect, type HitPointerEvent } from "@moire/react-host";
import { CollectionItem, GridItem, Icon, TextBlock, TextField, themePalette } from "@moire/ui";
import { fileIconName } from "@moire/file-operations";
import path from "node:path";
import { cellOrigin, type DesktopCell, type DesktopGrid, type DesktopPlacement } from "./layout";
import type { DesktopEntry, Rect as Bounds } from "./model";

export type DesktopRename = { name: string; draft: string; error: string | null };

export type DesktopIconsProps = {
  screenW: number;
  /** Height above the panel; icons never reach under it. */
  availH: number;
  directory: string;
  grid: DesktopGrid;
  placement: DesktopPlacement;
  entries: ReadonlyMap<string, DesktopEntry>;
  selectedNames: ReadonlySet<string>;
  focusedName: string | null;
  /** Folder icon a drop would go into. */
  dropTargetName: string | null;
  /** Cells where dropped or moved items would land on the desktop itself. */
  landingCells: readonly DesktopCell[];
  rubberBand: Bounds | null;
  rename: DesktopRename | null;
  /** Names being dragged, drawn dimmed in place. */
  draggingNames: ReadonlySet<string>;
  onBackgroundPress(event?: HitPointerEvent): void;
  onBackgroundContextMenu(event: HitPointerEvent): void;
  onSelect(name: string, event?: HitPointerEvent): void;
  onOpen(name: string): void;
  onContextMenu(name: string, event: HitPointerEvent): void;
  onOpenOverflow(): void;
  onRenameChange(draft: string): void;
  onRenameSubmit(): void;
  onRenameCancel(): void;
};

const RENAME_FIELD_H = 28;

function DesktopIcon(props: {
  name: string;
  entry: DesktopEntry | undefined;
  cell: DesktopCell;
  icons: DesktopIconsProps;
}): ReactNode {
  const pal = themePalette();
  const { icons, name } = props;
  const grid = icons.grid;
  const origin = cellOrigin(grid, props.cell);
  const isDir = props.entry?.isDir ?? false;
  const dimmed = icons.draggingNames.has(name);
  return (
    <CollectionItem
      x={origin.x}
      y={origin.y}
      width={grid.itemW}
      height={grid.itemH}
      focusId={`desktop:${path.join(icons.directory, name)}`}
      focused={icons.focusedName === name}
      onPress={(event) => icons.onSelect(name, event)}
      onDoublePress={() => icons.onOpen(name)}
      onContextMenu={(event) => icons.onContextMenu(name, event)}
    >
      <Group width={grid.itemW} height={grid.itemH} opacity={dimmed ? 0.45 : 1}>
        <GridItem
          width={grid.itemW}
          height={grid.itemH}
          label={icons.rename?.name === name ? "" : name}
          iconSize={grid.iconSize}
          labelScrim={icons.rename?.name !== name}
          selected={icons.selectedNames.has(name)}
          dropHover={icons.dropTargetName === name}
          interactive={false}
          icon={
            <Icon
              name={fileIconName(name, isDir)}
              size={grid.iconSize}
              color={isDir ? pal.accent : pal.text}
            />
          }
        />
      </Group>
    </CollectionItem>
  );
}

/** Inline rename, over the icon's label; wider than the tile so long names stay readable. */
function RenameField(props: { icons: DesktopIconsProps; cell: DesktopCell }): ReactNode {
  const pal = themePalette();
  const { grid, rename } = props.icons;
  if (!rename) return null;
  const origin = cellOrigin(grid, props.cell);
  const width = Math.min(props.icons.screenW - 8, Math.round(grid.cellW * 1.6));
  const x = Math.max(
    4,
    Math.min(props.icons.screenW - width - 4, origin.x + (grid.itemW - width) / 2),
  );
  const y = origin.y + grid.itemH - RENAME_FIELD_H;
  return (
    <Group x={x} y={y} width={width} height={RENAME_FIELD_H + (rename.error ? 22 : 0)}>
      <TextField
        width={width}
        height={RENAME_FIELD_H}
        size="small"
        value={rename.draft}
        focusId="desktop:rename"
        focused
        autoFocus
        selectAllOnFocus
        invalid={!!rename.error}
        onChange={props.icons.onRenameChange}
        onSubmit={props.icons.onRenameSubmit}
        onCancel={props.icons.onRenameCancel}
      />
      {rename.error ? (
        <Group y={RENAME_FIELD_H + 2} width={width} height={20}>
          <Rect width={width} height={20} radius={6} fill={pal.panel} />
          <TextBlock
            x={8}
            width={width - 16}
            height={20}
            text={rename.error}
            fontSize={11}
            color={pal.danger}
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
        </Group>
      ) : null}
    </Group>
  );
}

export function DesktopIcons(props: DesktopIconsProps): ReactNode {
  const pal = themePalette();
  const { grid, placement } = props;
  const overflowCount = placement.overflow.length;
  const renameCell = props.rename ? placement.cells.get(props.rename.name) : undefined;
  return (
    <Group x={0} y={0} width={props.screenW} height={props.availH}>
      {/* The background owns empty-area clicks and the desktop menu, even with no icons. */}
      <Rect
        x={0}
        y={0}
        width={props.screenW}
        height={props.availH}
        fill={0x00000000}
        onPress={props.onBackgroundPress}
        onContextMenu={props.onBackgroundContextMenu}
      />
      {props.landingCells.map((cell) => {
        const origin = cellOrigin(grid, cell);
        return (
          <Rect
            key={`landing:${cell.col}:${cell.row}`}
            x={origin.x}
            y={origin.y}
            width={grid.itemW}
            height={grid.itemH}
            radius={pal.radiusMd}
            fill={(pal.accent & 0x00ffffff) | 0x26000000}
            stroke={(pal.accent & 0x00ffffff) | 0x99000000}
            strokeWidth={1}
          />
        );
      })}
      {[...placement.cells].map(([name, cell]) => (
        <DesktopIcon
          key={name}
          name={name}
          entry={props.entries.get(name)}
          cell={cell}
          icons={props}
        />
      ))}
      {placement.overflowCell ? (
        <CollectionItem
          {...cellOrigin(grid, placement.overflowCell)}
          width={grid.itemW}
          height={grid.itemH}
          focusId="desktop:overflow"
          onPress={props.onOpenOverflow}
          onDoublePress={props.onOpenOverflow}
        >
          <GridItem
            width={grid.itemW}
            height={grid.itemH}
            label={`${overflowCount} more`}
            iconSize={grid.iconSize}
            labelScrim
            interactive={false}
            icon={<Icon name="more" size={grid.iconSize} color={pal.text} />}
          />
        </CollectionItem>
      ) : null}
      {props.rubberBand ? (
        <Rect
          {...props.rubberBand}
          fill={(pal.accent & 0x00ffffff) | 0x33000000}
          stroke={pal.accent}
          strokeWidth={1}
        />
      ) : null}
      {renameCell ? <RenameField icons={props} cell={renameCell} /> : null}
    </Group>
  );
}
