/** The selected palette's colours as tiles; choosing one makes it the current colour. */
import React, { type ReactNode } from "react";
import {
  Button,
  EmptyState,
  Pressable,
  Surface,
  TextBlock,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { Card } from "@moire/app-tools";
import { colorFill, parseHex } from "#colors/color";
import type { Palette, Swatch } from "#colors/palettes";

const TITLE_H = 38;
const TILE_H = 92;
const TILE_MIN_W = 120;
const TILE_GAP = 10;
const EMPTY_H = 120;
const CARD_PAD = 14;

function columns(width: number): number {
  const ui = getUiScaleFactor();
  return Math.max(2, Math.min(5, Math.floor((width - 28 * ui) / (TILE_MIN_W * ui))));
}

export function swatchesHeight(width: number, count: number): number {
  const ui = getUiScaleFactor();
  const rows = Math.ceil(count / columns(width));
  const body = rows ? rows * TILE_H + (rows - 1) * TILE_GAP : EMPTY_H;
  return (TITLE_H + body + CARD_PAD) * ui;
}

export function SwatchesCard(props: {
  y: number;
  width: number;
  palette: Palette | null;
  readOnly: boolean;
  selectedId: string | null;
  onPick(swatch: Swatch): void;
  onSaveAsPalette(): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const swatches = props.palette?.swatches ?? [];
  const innerW = props.width - 28 * ui;
  const cols = columns(props.width);
  const tileW = (innerW - (cols - 1) * TILE_GAP * ui) / cols;
  return (
    <Card
      y={props.y}
      width={props.width}
      height={swatchesHeight(props.width, swatches.length)}
      title={props.palette ? props.palette.name : "Colors"}
      aside={
        props.readOnly ? (
          <Button
            height={28 * ui}
            label="Save as Palette"
            variant="ghost"
            focusId="colors:save-preset"
            onPress={props.onSaveAsPalette}
          />
        ) : null
      }
    >
      {swatches.length ? (
        swatches.map((swatch, index) => (
          <SwatchTile
            key={swatch.id}
            x={(index % cols) * (tileW + TILE_GAP * ui)}
            y={Math.floor(index / cols) * (TILE_H + TILE_GAP) * ui}
            width={tileW}
            swatch={swatch}
            selected={swatch.id === props.selectedId}
            onPress={() => props.onPick(swatch)}
          />
        ))
      ) : (
        <EmptyState
          width={innerW}
          height={EMPTY_H * ui}
          icon="colors"
          title={props.palette ? "No colors yet" : "No palette selected"}
          message={
            props.palette
              ? "Pick a color above and choose Save Color."
              : "Choose a preset or create a palette."
          }
        />
      )}
    </Card>
  );
}

function SwatchTile(props: {
  x: number;
  y: number;
  width: number;
  swatch: Swatch;
  selected: boolean;
  onPress(): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const height = TILE_H * ui;
  const chipH = height - 40 * ui;
  return (
    <Pressable
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      radius={10 * ui}
      stroke={props.selected ? pal.accent : pal.borderSubtle}
      strokeWidth={props.selected ? 2 : 1}
      focusId={`colors:swatch:${props.swatch.id}`}
      onPress={props.onPress}
    >
      <Surface
        x={4 * ui}
        y={4 * ui}
        width={props.width - 8 * ui}
        height={chipH - 4 * ui}
        radius={7 * ui}
        fill={colorFill(parseHex(props.swatch.hex))}
      />
      <TextBlock
        x={10 * ui}
        y={chipH + 4 * ui}
        width={props.width - 20 * ui}
        height={16 * ui}
        text={props.swatch.name}
        fontSize={12}
        fontWeight="medium"
        overflow="ellipsis"
        maxLines={1}
      />
      <TextBlock
        x={10 * ui}
        y={chipH + 20 * ui}
        width={props.width - 20 * ui}
        text={props.swatch.hex}
        color={pal.muted}
        fontSize={11}
        fontFamily="mono"
        maxLines={1}
      />
    </Pressable>
  );
}
