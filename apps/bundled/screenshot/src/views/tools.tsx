/** The editing tool row: crop/pen/box, the pen color or crop bounds, Undo and Reset. */
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Column,
  Row,
  SegmentedControl,
  Surface,
  TextField,
  getUiScaleFactor,
} from "@moire/ui";
import { parseColor } from "#screenshot/image";
import type { Tool } from "#screenshot/model";
import type { ScreenshotLayout } from "#screenshot/layout";

const MODES_WIDTH = 260;
const HISTORY_BUTTON = 76;
const OPTION_WIDTH = 120;
const COMPACT_OPTION_MAX = 150;
const SWATCH = 14;

/** The pen color as an opaque swatch, or transparent while the field holds an invalid value. */
function swatch(color: string): number {
  try {
    const [r, g, b] = parseColor(color);
    return (0xff000000 | (r! << 16) | (g! << 8) | b!) >>> 0;
  } catch {
    return 0x00000000;
  }
}

export function ToolRow(props: {
  layout: ScreenshotLayout;
  tool: Tool;
  color: string;
  busy: boolean;
  hasImage: boolean;
  canUndo: boolean;
  canReset: boolean;
  onTool: (tool: Tool) => void;
  onColor: (color: string) => void;
  onBounds: () => void;
  onUndo: () => void;
  onReset: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { layout } = props;
  // Compact windows give the color field or Bounds… the row's spare width.
  const optionWidth = layout.compact
    ? Math.max(
        1,
        Math.min(
          COMPACT_OPTION_MAX * ui,
          layout.tools.width - 2 * HISTORY_BUTTON * ui - layout.gap * 2,
        ),
      )
    : OPTION_WIDTH * ui;
  const option =
    props.tool === "crop" ? (
      <Button
        height={layout.row}
        width={optionWidth}
        label="Bounds…"
        focusId="screenshot-crop-bounds"
        disabled={props.busy || !props.hasImage}
        onPress={props.onBounds}
      />
    ) : (
      <TextField
        height={layout.row}
        width={optionWidth}
        value={props.color}
        disabled={props.busy}
        placeholder="#RRGGBB"
        leading={(style) => (
          <Surface
            y={(style.size - SWATCH * ui) / 2}
            width={SWATCH * ui}
            height={SWATCH * ui}
            radius={4 * ui}
            fill={swatch(props.color)}
          />
        )}
        onChange={props.onColor}
      />
    );
  const history = (
    <>
      <Button
        height={layout.row}
        width={HISTORY_BUTTON * ui}
        variant="ghost"
        label="Undo"
        focusId="screenshot-undo"
        disabled={!props.canUndo || props.busy}
        onPress={props.onUndo}
      />
      <Button
        height={layout.row}
        width={HISTORY_BUTTON * ui}
        variant="ghost"
        label="Reset"
        focusId="screenshot-reset"
        disabled={!props.canReset || props.busy}
        onPress={props.onReset}
      />
    </>
  );
  const modes = (
    <SegmentedControl
      width={layout.compact ? layout.tools.width : MODES_WIDTH * ui}
      height={layout.row}
      value={props.tool}
      options={[
        { id: "crop", label: "Crop" },
        { id: "pen", label: "Pen" },
        { id: "rectangle", label: "Box" },
      ]}
      onChange={(tool) => props.onTool(tool as Tool)}
    />
  );
  return layout.compact ? (
    <Column {...layout.tools} y={8 * ui} gap={layout.gap}>
      {modes}
      <Row width={layout.tools.width} height={layout.row} gap={layout.gap}>
        {option}
        <Box flexGrow={1} height={1} />
        {history}
      </Row>
    </Column>
  ) : (
    <Row {...layout.tools} y={8 * ui} gap={layout.gap} align="center">
      {modes}
      {option}
      <Box flexGrow={1} height={1} />
      {history}
    </Row>
  );
}
