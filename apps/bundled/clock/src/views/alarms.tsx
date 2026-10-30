import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  EmptyState,
  Horizontal,
  Icon,
  IconButton,
  ScrollArea,
  TextBlock,
  TextField,
  Toggle,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { Card } from "@moire/app-tools";
import type { Alarm } from "#clock/time";
import { CARD_INSET } from "./readout";

export function AlarmsPanel(
  props: WindowSize & {
    alarms: readonly Alarm[];
    time: string;
    label: string;
    disabled: boolean;
    onTime: (value: string) => void;
    onLabel: (value: string) => void;
    onAdd: () => void;
    onEnable: (alarm: Alarm, enabled: boolean) => void;
    onDelete: (alarm: Alarm) => void;
  },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const pad = 16 * ui;
  const width = Math.min(props.width - pad * 2, 640 * ui);
  const inner = width - CARD_INSET * 2 * ui;
  const x = (props.width - width) / 2;
  const controlH = 36 * ui,
    cardH = controlH + CARD_INSET * 2 * ui,
    rowGap = 8 * ui;
  const listY = pad + cardH + 40 * ui;
  const timeW = 92 * ui,
    addW = 112 * ui;
  return (
    <Box width={props.width} height={props.height}>
      <Card x={x} y={pad} width={width} height={cardH}>
        <Horizontal width={inner} height={controlH} gap={8 * ui} align="center">
          <TextField
            width={timeW}
            height={controlH}
            value={props.time}
            placeholder="HH:MM"
            focusId="clock:alarm-time"
            onChange={props.onTime}
            onSubmit={props.onAdd}
          />
          <TextField
            width={Math.max(60 * ui, inner - timeW - addW - 16 * ui)}
            height={controlH}
            value={props.label}
            placeholder="Alarm name"
            focusId="clock:alarm-label"
            onChange={props.onLabel}
            onSubmit={props.onAdd}
          />
          <Button
            width={addW}
            height={controlH}
            label="Add Alarm"
            variant="primary"
            focusId="clock:add-alarm"
            disabled={props.disabled}
            onPress={props.onAdd}
          />
        </Horizontal>
      </Card>
      <TextBlock
        x={x + 4 * ui}
        y={pad + cardH + 14 * ui}
        width={width}
        height={18 * ui}
        text="DAILY · LOCAL TIME"
        color={pal.muted}
        fontSize={11}
        fontWeight="medium"
        verticalAlign="end"
      />
      {props.alarms.length ? (
        <ScrollArea
          x={x}
          y={listY}
          width={width + 10 * ui}
          height={Math.max(1, props.height - listY - pad)}
          contentHeight={props.alarms.length * (cardH + rowGap)}
          fill={0x00000000}
        >
          {props.alarms.map((alarm, index) => (
            <Card key={alarm.id} y={index * (cardH + rowGap)} width={width} height={cardH}>
              <Horizontal width={inner} height={controlH} gap={14 * ui} align="center">
                <TextBlock
                  text={alarm.time}
                  fontFamily="display"
                  fontSize={30}
                  color={alarm.enabled ? pal.text : pal.muted}
                  maxLines={1}
                />
                <TextBlock
                  flexGrow={1}
                  text={alarm.label}
                  color={pal.muted}
                  fontSize={13}
                  overflow="ellipsis"
                  maxLines={1}
                />
                <Toggle
                  on={alarm.enabled}
                  focusId={`clock:enable-alarm:${alarm.id}`}
                  onChange={(on) => props.onEnable(alarm, on)}
                />
                <IconButton
                  icon={(style) => <Icon name="trash" {...style} symbolic />}
                  variant="ghost"
                  tooltip="Delete alarm"
                  focusId={`clock:delete-alarm:${alarm.id}`}
                  onPress={() => props.onDelete(alarm)}
                />
              </Horizontal>
            </Card>
          ))}
        </ScrollArea>
      ) : (
        <EmptyState
          y={listY}
          width={props.width}
          height={Math.max(1, props.height - listY - pad)}
          icon="bell"
          title="No alarms"
          message="Set a time and a name above. Alarms ring while Clock is open."
        />
      )}
    </Box>
  );
}
