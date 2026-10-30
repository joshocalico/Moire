import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  ScrollArea,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { Card } from "@moire/app-tools";
import { durationText, type Stopwatch } from "#clock/time";
import { CARD_INSET, COUNTER_HEIGHT, Readout, panelWidth } from "./readout";

const SCROLLBAR_ROOM = 14;

export function StopwatchPanel(
  props: WindowSize & {
    elapsed: number;
    watch: Stopwatch;
    onToggle: () => void;
    onLap: () => void;
    onReset: () => void;
  },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const width = panelWidth(props.width);
  const readout = `${durationText(Math.floor(props.elapsed / 1000) * 1000)}.${String(Math.floor((props.elapsed % 1000) / 10)).padStart(2, "0")}`;
  const top = Math.round(Math.max(16 * ui, (props.height - COUNTER_HEIGHT * ui) / 2.4)),
    rowH = 36 * ui;
  const lapsY = top + 100 * ui + 16 * ui + 36 * ui + 28 * ui;
  const laps = props.watch.laps;
  const inset = CARD_INSET * ui;
  const lapsH = Math.max(
    1,
    Math.min(laps.length * rowH, props.height - lapsY - 16 * ui - inset * 2),
  );
  return (
    <Box width={props.width} height={props.height}>
      <Vertical
        x={(props.width - width) / 2}
        y={top}
        width={width}
        height={lapsY - top}
        gap={0}
        align="center"
      >
        <Readout text={readout} width={width} />
        <Box width={width} height={16 * ui} />
        <Horizontal height={36 * ui} gap={8 * ui} align="center">
          <Button
            width={104 * ui}
            height={36 * ui}
            label={props.watch.kind === "running" ? "Pause" : "Start"}
            variant="primary"
            focusId="clock:stopwatch-toggle"
            onPress={props.onToggle}
          />
          <Button
            width={84 * ui}
            height={36 * ui}
            label="Lap"
            focusId="clock:lap"
            disabled={props.watch.kind !== "running"}
            onPress={props.onLap}
          />
          <Button width={84 * ui} height={36 * ui} label="Reset" onPress={props.onReset} />
        </Horizontal>
      </Vertical>
      {laps.length ? (
        <Card x={(props.width - width) / 2} y={lapsY} width={width} height={lapsH + inset * 2}>
          <ScrollArea
            width={width - inset * 2}
            height={lapsH}
            contentHeight={laps.length * rowH}
            fill={0x00000000}
          >
            {[...laps].reverse().map((lap, reversed) => {
              const index = laps.length - 1 - reversed;
              const split = lap - (laps[index - 1] ?? 0);
              return (
                <Horizontal
                  key={index}
                  y={reversed * rowH}
                  width={width - inset * 2 - SCROLLBAR_ROOM * ui}
                  height={rowH}
                  gap={12 * ui}
                  align="center"
                >
                  <TextBlock flexGrow={1} text={`Lap ${index + 1}`} fontSize={13} maxLines={1} />
                  <TextBlock
                    text={`+${(split / 1000).toFixed(2)}s`}
                    color={pal.muted}
                    fontSize={13}
                    maxLines={1}
                  />
                  <TextBlock
                    width={88 * ui}
                    text={durationText(lap)}
                    fontSize={13}
                    fontWeight="medium"
                    horizontalAlign="end"
                    maxLines={1}
                  />
                </Horizontal>
              );
            })}
          </ScrollArea>
        </Card>
      ) : null}
    </Box>
  );
}
