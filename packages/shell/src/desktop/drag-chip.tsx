/**
 * The drag preview the shell draws itself: a dimmed copy of a desktop tile
 * that follows the grab point (and eases home when a drag is cancelled), or
 * a plain label chip for a client drag that brought no icon of its own.
 */
import React from "react";
import {
  Group,
  Rect,
  createShellRoot,
  measureText,
  rasterize,
  renderShell,
} from "@moire/react-host";
import { GridItem, Icon, Label } from "@moire/ui";
import { themePalette } from "@moire/theme";
import { fileIconName } from "@moire/file-operations";
import type { DesktopGrid } from "./layout";

export type DesktopDragChip = {
  pixels: Uint8Array;
  width: number;
  height: number;
  revision: number;
  x: number;
  y: number;
};

const CHIP_H = 36;
const MAX_LABEL = 24;

export function createDragChipRenderer() {
  const root = createShellRoot();
  let cache: { key: string; pixels: Uint8Array; width: number; height: number } | null = null;
  let revision = 0;
  return {
    /** Pixels for a chip; `tile` describes a desktop icon being dragged, if it is one. */
    render(
      label: string,
      tile: { name: string; isDir: boolean; grid: DesktopGrid } | null,
      position: { x: number; y: number },
    ): DesktopDragChip {
      const text = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
      const width = tile
        ? tile.grid.itemW
        : Math.max(72, Math.round(measureText(text, 13 / 14) + 52));
      const height = tile ? tile.grid.itemH : CHIP_H;
      const key = `${text}|${tile?.name ?? ""}|${tile?.isDir ?? ""}|${width}x${height}`;
      if (cache?.key !== key) {
        const pal = themePalette();
        renderShell(
          root,
          tile ? (
            <Group x={0} y={0} width={width} height={height} opacity={0.6}>
              <GridItem
                width={width}
                height={height}
                label={text}
                iconSize={tile.grid.iconSize}
                labelScrim
                interactive={false}
                icon={
                  <Icon
                    name={fileIconName(tile.name, tile.isDir)}
                    size={tile.grid.iconSize}
                    color={tile.isDir ? pal.accent : pal.text}
                  />
                }
              />
            </Group>
          ) : (
            <Group x={0} y={0} width={width} height={height}>
              <Rect width={width} height={height} fill={(pal.surface & 0x00ffffff) | 0xf0000000} />
              <Rect width={width} height={1} fill={pal.rimLight} />
              <Rect width={3} height={height} fill={pal.accentLine} />
              <Label x={16} y={8} text={text} color={pal.text} fontSize={13} fontWeight="medium" />
            </Group>
          ),
        );
        cache = { key, pixels: rasterize(root.container, width, height).pixels, width, height };
        revision++;
      }
      return { ...cache, revision, ...position };
    },
    invalidate() {
      cache = null;
    },
  };
}
