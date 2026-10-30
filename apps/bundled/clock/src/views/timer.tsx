import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  TextBlock,
  TextField,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import type { Countdown } from "#clock/time";
import { COUNTER_HEIGHT, CenteredPanel, Readout, panelWidth } from "./readout";

export function TimerPanel(
  props: WindowSize & {
    readout: string;
    duration: string;
    timer: Countdown;
    onDuration: (value: string) => void;
    onStartPause: () => void;
    onReset: () => void;
  },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const set = props.timer.kind === "running" || props.timer.kind === "paused";
  const width = panelWidth(props.width);
  return (
    <CenteredPanel {...props} contentHeight={COUNTER_HEIGHT * ui}>
      <Readout text={props.readout} width={width} />
      <Box width={width} height={16 * ui} />
      <Horizontal height={36 * ui} gap={8 * ui} align="center">
        <TextField
          width={120 * ui}
          height={36 * ui}
          value={props.duration}
          disabled={set}
          placeholder="05:00"
          focusId="clock:timer-duration"
          onChange={props.onDuration}
          onSubmit={props.onStartPause}
        />
        <Button
          width={116 * ui}
          height={36 * ui}
          label={
            props.timer.kind === "running"
              ? "Pause"
              : props.timer.kind === "paused"
                ? "Resume"
                : "Start Timer"
          }
          variant="primary"
          focusId="clock:timer-toggle"
          onPress={props.onStartPause}
        />
        <Button width={84 * ui} height={36 * ui} label="Reset" onPress={props.onReset} />
      </Horizontal>
      <Box width={width} height={14 * ui} />
      <TextBlock
        width={width}
        text="Duration in minutes:seconds or hours:minutes:seconds. An alert appears when it ends."
        color={pal.muted}
        fontSize={12}
        horizontalAlign="center"
        wrap
        maxLines={2}
      />
    </CenteredPanel>
  );
}
