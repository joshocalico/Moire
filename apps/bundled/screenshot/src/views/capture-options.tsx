/** Choosing what to capture and when: the empty window's panel and the New Screenshot dialog. */
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Label,
  SegmentedControl,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { IconTile } from "@moire/app-tools";
import { CAPTURE_DELAYS, type CaptureArea, type CaptureOptions } from "#screenshot/model";

const ROW = 34;
const FORM_WIDTH = 360;
const ACTION_WIDTH = 200;

function captureFormHeight(): number {
  const ui = getUiScaleFactor();
  // Two labelled rows: label, gap, control, gap between them.
  return (2 * (16 + 6 + ROW) + 14) * ui;
}

export function CaptureOptionsForm(props: {
  width: number;
  options: CaptureOptions;
  onChange: (options: CaptureOptions) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const { options } = props;
  return (
    <Vertical width={props.width} gap={6 * ui}>
      <Label width={props.width} text="Capture" fontSize={12} color={pal.muted} />
      <SegmentedControl
        width={props.width}
        height={ROW * ui}
        value={options.area}
        options={[
          { id: "screen", label: "Whole screen" },
          { id: "area", label: "Select area" },
        ]}
        onChange={(area) => props.onChange({ ...options, area: area as CaptureArea })}
      />
      <Box width={props.width} height={8 * ui} />
      <Label width={props.width} text="Delay" fontSize={12} color={pal.muted} />
      <SegmentedControl
        width={props.width}
        height={ROW * ui}
        value={String(options.delay)}
        options={CAPTURE_DELAYS.map((delay) => ({
          id: String(delay),
          label: delay ? `${delay} s` : "None",
        }))}
        onChange={(delay) => props.onChange({ ...options, delay: Number(delay) })}
      />
    </Vertical>
  );
}

/** Shown while there is no image: what to capture, Take Screenshot, or open a PNG instead. */
export function CapturePanel(props: {
  width: number;
  height: number;
  options: CaptureOptions;
  busy: boolean;
  onChange: (options: CaptureOptions) => void;
  onTake: () => void;
  onOpen: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const width = Math.max(1, Math.min(FORM_WIDTH * ui, props.width - 32 * ui));
  const actionWidth = Math.min(ACTION_WIDTH * ui, width);
  const contentHeight =
    (56 + 12 + 26 + 36 + 16) * ui + captureFormHeight() + (20 + ROW * 2 + 8) * ui;
  return (
    <Vertical
      x={(props.width - width) / 2}
      y={Math.max(12 * ui, (props.height - contentHeight) / 2)}
      width={width}
      gap={0}
      align="center"
    >
      <IconTile icon="screenshot" />
      <Box width={width} height={12 * ui} />
      <TextBlock
        width={width}
        text="Take a screenshot"
        fontSize={17}
        fontWeight="medium"
        horizontalAlign="center"
      />
      <TextBlock
        width={width}
        text="Capture the whole screen, or drag out the part you want afterwards."
        fontSize={12}
        color={pal.muted}
        wrap
        maxLines={2}
        horizontalAlign="center"
      />
      <Box width={width} height={16 * ui} />
      <Box width={width} height={captureFormHeight()}>
        <CaptureOptionsForm width={width} options={props.options} onChange={props.onChange} />
      </Box>
      <Box width={width} height={20 * ui} />
      <Button
        width={actionWidth}
        height={ROW * ui}
        variant="primary"
        label={props.busy ? "Capturing…" : "Take Screenshot"}
        focusId="screenshot-take"
        autoFocus
        disabled={props.busy}
        onPress={props.onTake}
      />
      <Box width={width} height={8 * ui} />
      <Button
        width={actionWidth}
        height={ROW * ui}
        variant="ghost"
        label="Open Image…"
        focusId="screenshot-open-image"
        disabled={props.busy}
        onPress={props.onOpen}
      />
    </Vertical>
  );
}
