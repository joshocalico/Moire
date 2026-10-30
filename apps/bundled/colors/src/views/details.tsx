/** Cards about the current colour: its values to copy, and its contrast against white and black. */
import React, { type ReactNode } from "react";
import {
  Badge,
  Button,
  Horizontal,
  Surface,
  TextBlock,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { Card } from "@moire/app-tools";
import {
  BLACK,
  COPY_FORMATS,
  WHITE,
  colorFill,
  contrastCheck,
  formatRatio,
  type CopyFormat,
  type RGB,
} from "#colors/color";

const TITLE_H = 38;
const FORMAT_ROW_H = 32;
const CONTRAST_ROW_H = 40;
const ROW_GAP = 6;
const CARD_PAD = 14;
const BADGE_H = 22;
const CHIP_W = 52;

export const formatsHeight = () =>
  (TITLE_H + COPY_FORMATS.length * FORMAT_ROW_H + (COPY_FORMATS.length - 1) * ROW_GAP + CARD_PAD) *
  getUiScaleFactor();
export const contrastHeight = () =>
  (TITLE_H + 2 * CONTRAST_ROW_H + ROW_GAP + CARD_PAD) * getUiScaleFactor();

export function FormatsCard(props: {
  x?: number;
  y: number;
  width: number;
  rgb: RGB | null;
  onCopy(format: CopyFormat): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const innerW = props.width - 28 * ui;
  return (
    <Card x={props.x} y={props.y} width={props.width} height={formatsHeight()} title="Copy as">
      {COPY_FORMATS.map((format, index) => (
        <Horizontal
          key={format.id}
          y={index * (FORMAT_ROW_H + ROW_GAP) * ui}
          width={innerW}
          height={FORMAT_ROW_H * ui}
          gap={8 * ui}
          align="center"
        >
          <TextBlock
            width={36 * ui}
            text={format.label}
            color={pal.muted}
            fontSize={11}
            fontWeight="medium"
            maxLines={1}
          />
          <TextBlock
            flexGrow={1}
            text={props.rgb ? format.format(props.rgb) : "—"}
            fontSize={13}
            fontFamily="mono"
            maxLines={1}
            overflow="ellipsis"
          />
          <Button
            height={FORMAT_ROW_H * ui}
            label="Copy"
            variant="ghost"
            focusId={`colors:copy-${format.id}`}
            disabled={!props.rgb}
            onPress={() => props.onCopy(format.id)}
          />
        </Horizontal>
      ))}
    </Card>
  );
}

export function ContrastCard(props: {
  x?: number;
  y: number;
  width: number;
  rgb: RGB | null;
}): ReactNode {
  const ui = getUiScaleFactor();
  const innerW = props.width - 28 * ui;
  return (
    <Card x={props.x} y={props.y} width={props.width} height={contrastHeight()} title="Contrast">
      {props.rgb ? (
        <>
          <ContrastRow y={0} width={innerW} rgb={props.rgb} background={WHITE} label="On white" />
          <ContrastRow
            y={(CONTRAST_ROW_H + ROW_GAP) * ui}
            width={innerW}
            rgb={props.rgb}
            background={BLACK}
            label="On black"
          />
        </>
      ) : null}
    </Card>
  );
}

function ContrastRow(props: {
  y: number;
  width: number;
  rgb: RGB;
  background: RGB;
  label: string;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const check = contrastCheck(props.rgb, props.background);
  const height = CONTRAST_ROW_H * ui;
  return (
    <Horizontal y={props.y} width={props.width} height={height} gap={10 * ui} align="center">
      <Surface
        width={CHIP_W * ui}
        height={height - 4 * ui}
        radius={8 * ui}
        fill={colorFill(props.background)}
        stroke={pal.borderSubtle}
        strokeWidth={1}
      >
        <TextBlock
          width={CHIP_W * ui}
          height={height - 4 * ui}
          text="Aa"
          color={colorFill(props.rgb)}
          fontSize={17}
          fontWeight="medium"
          horizontalAlign="center"
          verticalAlign="center"
        />
      </Surface>
      <TextBlock
        flexGrow={1}
        height={height}
        text={`${props.label}  ${formatRatio(check.ratio)}`}
        fontSize={13}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <Badge
        height={BADGE_H * ui}
        text={check.aa ? "AA Pass" : "AA Fail"}
        tone={check.aa ? "success" : "danger"}
      />
      <Badge
        height={BADGE_H * ui}
        text={check.aaa ? "AAA Pass" : "AAA Fail"}
        tone={check.aaa ? "success" : "danger"}
      />
    </Horizontal>
  );
}
