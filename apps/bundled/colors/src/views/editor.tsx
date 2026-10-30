/** The current colour: a large preview, then HEX/RGB fields, its name and the save actions. */
import React, { type ReactNode } from "react";
import {
  Button,
  Horizontal,
  Surface,
  TextBlock,
  TextField,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { Card } from "@moire/app-tools";
import { colorFill, contrastText, formatRgb, rgbHex, type RGB } from "#colors/color";

export const PREVIEW_H = 120;
export const EDITOR_H = 184;
const FIELD_H = 36;
const LABEL_H = 18;
const GAP = 8;
const SAVE_W = 120;

const CHANNELS = [
  { key: "r", label: "R", focusId: "colors:red" },
  { key: "g", label: "G", focusId: "colors:green" },
  { key: "b", label: "B", focusId: "colors:blue" },
] as const;

export function ColorPreview(props: {
  y: number;
  width: number;
  rgb: RGB | null;
  title: string;
  error: string;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const pad = 18 * ui;
  const height = PREVIEW_H * ui;
  const ink = props.rgb ? contrastText(props.rgb) : pal.text;
  return (
    <Surface
      y={props.y}
      width={props.width}
      height={height}
      fill={props.rgb ? colorFill(props.rgb) : pal.surface}
      radius={12 * ui}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      <TextBlock
        x={pad}
        y={14 * ui}
        width={props.width - pad * 2}
        text={props.title}
        color={props.rgb ? ink : pal.muted}
        fontSize={12}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={pad}
        y={height - 76 * ui}
        width={props.width - pad * 2}
        text={props.rgb ? rgbHex(props.rgb) : "Invalid color"}
        color={ink}
        fontSize={30}
        fontFamily="mono"
        maxLines={1}
      />
      <TextBlock
        x={pad}
        y={height - 32 * ui}
        width={props.width - pad * 2}
        text={props.rgb ? formatRgb(props.rgb) : props.error}
        color={props.rgb ? ink : pal.danger}
        fontSize={13}
        maxLines={1}
        overflow="ellipsis"
      />
    </Surface>
  );
}

export function ColorEditor(props: {
  y: number;
  width: number;
  hex: string;
  rgb: RGB | null;
  name: string;
  editing: boolean;
  canSave: boolean;
  canDelete: boolean;
  onHex(value: string): void;
  onChannel(channel: keyof RGB, value: string): void;
  onName(value: string): void;
  onSave(): void;
  onNew(): void;
  onDelete(): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const innerW = props.width - 28 * ui;
  const gap = GAP * ui;
  const channelW = Math.min(72 * ui, (innerW - gap * 3) / 5);
  const hexW = innerW - (channelW + gap) * 3;
  const saveW = SAVE_W * ui;
  const fieldH = FIELD_H * ui;
  const row2 = LABEL_H * ui + fieldH + 14 * ui;
  const row3 = row2 + fieldH + 12 * ui;
  const label = (x: number, width: number, text: string) => (
    <TextBlock
      key={text}
      x={x}
      width={width}
      height={16 * ui}
      text={text}
      color={pal.muted}
      fontSize={11}
      fontWeight="medium"
      maxLines={1}
    />
  );
  return (
    <Card y={props.y} width={props.width} height={EDITOR_H * ui}>
      {label(0, hexW, "HEX")}
      <TextField
        y={LABEL_H * ui}
        width={hexW}
        height={fieldH}
        value={props.hex}
        focusId="colors:hex"
        onChange={props.onHex}
        onSubmit={props.onSave}
        invalid={!props.rgb}
      />
      {CHANNELS.map((channel, index) => {
        const x = hexW + gap + index * (channelW + gap);
        return (
          <React.Fragment key={channel.key}>
            {label(x, channelW, channel.label)}
            <TextField
              x={x}
              y={LABEL_H * ui}
              width={channelW}
              height={fieldH}
              value={props.rgb ? String(props.rgb[channel.key]) : ""}
              focusId={channel.focusId}
              selectAllOnFocus
              disabled={!props.rgb}
              onChange={(value) => props.onChannel(channel.key, value)}
            />
          </React.Fragment>
        );
      })}
      <TextField
        y={row2}
        width={innerW - saveW - gap}
        height={fieldH}
        value={props.name}
        placeholder="Color name"
        focusId="colors:color-name"
        onChange={props.onName}
        onSubmit={props.onSave}
      />
      <Button
        x={innerW - saveW}
        y={row2}
        width={saveW}
        height={fieldH}
        label={props.editing ? "Update Color" : "Save Color"}
        variant="primary"
        focusId="colors:save-color"
        disabled={!props.canSave}
        onPress={props.onSave}
      />
      <Horizontal y={row3} width={innerW} height={34 * ui} gap={gap} align="center">
        <Button
          height={34 * ui}
          label="New Color"
          variant="ghost"
          focusId="colors:new-color"
          onPress={props.onNew}
        />
        <Button
          height={34 * ui}
          label="Delete Color"
          variant="ghost"
          focusId="colors:delete-color"
          disabled={!props.canDelete}
          onPress={props.onDelete}
        />
      </Horizontal>
    </Card>
  );
}
