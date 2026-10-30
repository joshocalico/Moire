import React, { type ReactNode } from "react";
import { Box, Button, SegmentedControl, getUiScaleFactor } from "@moire/ui";
import { ToolButton, ToolReadout, ToolRow, ToolSeparator } from "@moire/app-tools";
import { MAX_TESTER_SIZE, MIN_TESTER_SIZE, type Mode } from "#font-viewer/model";

const MODE_SWITCH_WIDTH = 220;

/** Specimen or type tester; in the tester, the sample size and Preview. */
export function FontToolbar(props: {
  width: number;
  mode: Mode;
  size: number;
  onMode: (mode: Mode) => void;
  onResize: (by: 1 | -1) => void;
  onPreview: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const tester = props.mode === "tester";
  return (
    <ToolRow
      width={props.width}
      end={
        tester ? (
          <Button
            width={84 * ui}
            height={30 * ui}
            size="small"
            variant="secondary"
            label="Preview"
            focusId="font:preview"
            onPress={props.onPreview}
          />
        ) : null
      }
    >
      <Box width={MODE_SWITCH_WIDTH * ui} height={32 * ui} flexShrink={0}>
        <SegmentedControl
          width={MODE_SWITCH_WIDTH * ui}
          height={32 * ui}
          size="small"
          value={props.mode}
          options={[
            { id: "specimen", label: "Specimen" },
            { id: "tester", label: "Type tester" },
          ]}
          onChange={(value) => props.onMode(value as Mode)}
        />
      </Box>
      {tester ? (
        <>
          <ToolSeparator />
          <ToolButton
            icon="zoom-out"
            tooltip="Smaller"
            focusId="font:smaller"
            disabled={props.size <= MIN_TESTER_SIZE}
            onPress={() => props.onResize(-1)}
          />
          <ToolReadout text={`${props.size} px`} />
          <ToolButton
            icon="zoom-in"
            tooltip="Larger"
            focusId="font:larger"
            disabled={props.size >= MAX_TESTER_SIZE}
            onPress={() => props.onResize(1)}
          />
        </>
      ) : null}
    </ToolRow>
  );
}
