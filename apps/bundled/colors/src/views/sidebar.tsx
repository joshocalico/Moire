/** Built-in presets and the user's palettes, with the name field and palette actions below. */
import React, { type ReactNode } from "react";
import {
  Horizontal,
  Icon,
  IconButton,
  Pressable,
  ScrollArea,
  Separator,
  Surface,
  TextBlock,
  TextField,
  Button,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { Card, cardContent } from "@moire/app-tools";
import { colorFill, parseHex } from "#colors/color";
import type { Selection } from "#colors/model";
import type { Palette } from "#colors/palettes";
import { PRESETS } from "#colors/presets";

const ROW_H = 48;
const ROW_GAP = 4;
const SECTION_H = 30;
const FOOTER_H = 100;
const CONTROL_H = 34;
const DOTS = 8;

export function PaletteSidebar(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  palettes: readonly Palette[];
  selection: Selection;
  name: string;
  disabled: boolean;
  canRename: boolean;
  canDelete: boolean;
  onName(value: string): void;
  onSelect(selection: Selection, palette: Palette): void;
  onCreate(): void;
  onRename(): void;
  onDelete(): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const inner = cardContent(props.width, props.height, false);
  const innerW = inner.width;
  const footerH = FOOTER_H * ui;
  // Rows bleed slightly past the card's content edge so the selection fill has breathing room.
  const bleed = 6 * ui;
  const row = (ROW_H + ROW_GAP) * ui;
  const sections: Array<{
    title: string;
    kind: "preset" | "saved";
    items: readonly Palette[];
  }> = [
    { title: "MY PALETTES", kind: "saved", items: props.palettes },
    { title: "PRESETS", kind: "preset", items: PRESETS },
  ];
  let y = 0;
  const content: ReactNode[] = [];
  for (const section of sections) {
    content.push(
      <TextBlock
        key={section.kind}
        x={bleed + 2 * ui}
        y={y}
        width={innerW}
        height={SECTION_H * ui}
        text={section.title}
        color={pal.muted}
        fontSize={11}
        fontWeight="medium"
        verticalAlign="center"
      />,
    );
    y += SECTION_H * ui;
    if (section.kind === "saved" && !section.items.length) {
      content.push(
        <TextBlock
          key="empty"
          x={bleed + 2 * ui}
          y={y}
          width={innerW}
          height={ROW_H * ui}
          text="None yet. Name one below, or save a preset as a palette."
          color={pal.muted}
          fontSize={12}
          wrap
          maxLines={2}
        />,
      );
      y += row;
    }
    for (const item of section.items) {
      const selected = props.selection.kind === section.kind && props.selection.id === item.id;
      content.push(
        <PaletteRow
          key={item.id}
          x={bleed}
          y={y}
          width={innerW}
          palette={item}
          selected={selected}
          focusId={`colors:${section.kind === "saved" ? "palette" : "preset"}:${item.id.replace(/^preset:/, "")}`}
          onPress={() => props.onSelect({ kind: section.kind, id: item.id }, item)}
        />,
      );
      y += row;
    }
    y += 6 * ui;
  }
  return (
    <Card x={props.x} y={props.y} width={props.width} height={props.height}>
      <ScrollArea
        x={-bleed}
        y={-bleed}
        width={innerW + bleed * 2}
        height={Math.max(1, inner.height - footerH + bleed)}
        contentHeight={Math.max(1, y)}
        fill={0x00000000}
      >
        {content}
      </ScrollArea>
      <Separator y={inner.height - footerH + 4 * ui} width={innerW} color={pal.borderSubtle} />
      <TextField
        y={inner.height - footerH + 18 * ui}
        width={innerW}
        height={CONTROL_H * ui}
        value={props.name}
        placeholder="Palette name"
        focusId="colors:palette-name"
        onChange={props.onName}
        onSubmit={props.onCreate}
      />
      <Horizontal
        y={inner.height - CONTROL_H * ui}
        width={innerW}
        height={CONTROL_H * ui}
        gap={6 * ui}
        align="center"
      >
        <Button
          width={innerW - 2 * (CONTROL_H + 6) * ui}
          height={CONTROL_H * ui}
          label="Create Palette"
          focusId="colors:new-palette"
          disabled={props.disabled}
          onPress={props.onCreate}
        />
        <IconButton
          icon={(style) => <Icon name="editor" {...style} symbolic />}
          variant="ghost"
          width={CONTROL_H * ui}
          height={CONTROL_H * ui}
          tooltip="Rename palette"
          focusId="colors:rename-palette"
          disabled={!props.canRename}
          onPress={props.onRename}
        />
        <IconButton
          icon={(style) => <Icon name="trash" {...style} symbolic />}
          variant="ghost"
          width={CONTROL_H * ui}
          height={CONTROL_H * ui}
          tooltip="Delete palette"
          focusId="colors:delete-palette"
          disabled={!props.canDelete}
          onPress={props.onDelete}
        />
      </Horizontal>
    </Card>
  );
}

function PaletteRow(props: {
  x: number;
  y: number;
  width: number;
  palette: Palette;
  selected: boolean;
  focusId: string;
  onPress(): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const pad = 10 * ui;
  return (
    <Pressable
      x={props.x}
      y={props.y}
      width={props.width}
      height={ROW_H * ui}
      radius={8 * ui}
      fill={props.selected ? pal.selection : 0x00000000}
      focusId={props.focusId}
      onPress={props.onPress}
    >
      <TextBlock
        x={pad}
        y={6 * ui}
        width={props.width - pad * 2 - 30 * ui}
        height={18 * ui}
        text={props.palette.name}
        color={pal.text}
        fontSize={13}
        fontWeight={props.selected ? "medium" : "regular"}
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={props.width - pad - 28 * ui}
        y={6 * ui}
        width={28 * ui}
        text={String(props.palette.swatches.length)}
        color={pal.muted}
        fontSize={11}
        horizontalAlign="end"
        maxLines={1}
      />
      {props.palette.swatches.slice(0, DOTS).map((swatch, dot) => (
        <Surface
          key={swatch.id}
          x={pad + dot * 16 * ui}
          y={28 * ui}
          width={12 * ui}
          height={12 * ui}
          radius={6 * ui}
          fill={colorFill(parseHex(swatch.hex))}
          stroke={pal.borderSubtle}
          strokeWidth={1}
        />
      ))}
    </Pressable>
  );
}
