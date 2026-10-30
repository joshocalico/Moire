/** The record control, elapsed time and state, with the new take (or the input problem) beneath. */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  IconButton,
  Surface,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { Card, ToolIcon, cardContent } from "@moire/app-tools";

const RECORD_BUTTON = 88;
const TIME_HEIGHT = 52;
const MESSAGE_HEIGHT = 44;
const TAKE_HEIGHT = 136;
const CONTENT_WIDTH = 460;
const RETRY_HEIGHT = 44;
const METER_WIDTH = 72;
const METER_HEIGHT = 4;

/** The height the panel needs to show everything it has, for stacking the list beneath it. */
export function recordPanelHeight(parts: { message: boolean; retry: boolean; take: boolean }) {
  const ui = getUiScaleFactor();
  return (
    (32 + RECORD_BUTTON + 16 + TIME_HEIGHT + 24) * ui +
    (parts.message ? MESSAGE_HEIGHT * ui : 0) +
    (parts.retry ? RETRY_HEIGHT * ui : 0) +
    (parts.take ? (20 + TAKE_HEIGHT) * ui : 0)
  );
}

export type TakeActions = { onSave: () => void; onSaveAs: () => void; onDiscard: () => void };

export function RecordPanel(props: {
  width: number;
  height: number;
  recording: boolean;
  /** The input's peak, 0..1, metered beside the state while recording. */
  level: number;
  canToggle: boolean;
  onToggle: () => void;
  time: string;
  label: string;
  /** An error or guidance line under the state; `danger` colours it. */
  message: string;
  danger: boolean;
  /** Shown when the input can't be used, to check again. */
  onRetry?: () => void;
  /** An unsaved take: its automatic name and where Save puts it. */
  take: { name: string; folder: string; busy: boolean } | null;
  takeActions: TakeActions;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const contentW = Math.min(CONTENT_WIDTH * ui, props.width - 32 * ui);
  const button = Math.round(RECORD_BUTTON * ui);
  const messageH = props.message ? MESSAGE_HEIGHT * ui : 0;
  const retryH = props.onRetry ? RETRY_HEIGHT * ui : 0;
  const takeH = props.take ? 20 * ui + TAKE_HEIGHT * ui : 0;
  const contentH = button + 16 * ui + TIME_HEIGHT * ui + 24 * ui + messageH + retryH + takeH;
  const dot = 8 * ui;
  return (
    <Box width={props.width} height={props.height}>
      <Vertical
        x={(props.width - contentW) / 2}
        y={Math.max(16 * ui, (props.height - contentH) / 2.2)}
        width={contentW}
        gap={0}
        align="center"
      >
        <Box width={button} height={button}>
          <RecordButton
            size={button}
            recording={props.recording}
            disabled={!props.canToggle}
            onPress={props.onToggle}
          />
        </Box>
        <Box width={contentW} height={16 * ui} />
        <TextBlock
          width={contentW}
          height={TIME_HEIGHT * ui}
          text={props.time}
          fontSize={40}
          fontWeight="medium"
          horizontalAlign="center"
          verticalAlign="center"
        />
        <Horizontal width={contentW} height={24 * ui} gap={8 * ui} align="center" justify="center">
          <Box width={dot} height={dot} flexShrink={0}>
            <Surface
              width={dot}
              height={dot}
              radius={dot / 2}
              fill={props.recording || props.danger ? pal.danger : pal.muted}
            />
          </Box>
          <TextBlock
            text={props.label}
            color={props.recording ? pal.text : pal.muted}
            fontSize={13}
            fontWeight={props.recording ? "medium" : "regular"}
            maxLines={1}
          />
          {props.recording ? <LevelMeter level={props.level} /> : null}
        </Horizontal>
        {props.message ? (
          <TextBlock
            width={contentW}
            height={messageH}
            text={props.message}
            color={props.danger ? pal.danger : pal.muted}
            fontSize={12}
            wrap
            maxLines={2}
            overflow="ellipsis"
            horizontalAlign="center"
            verticalAlign="center"
          />
        ) : null}
        {props.onRetry ? (
          <Box width={120 * ui} height={retryH}>
            <Button
              y={8 * ui}
              width={120 * ui}
              height={34 * ui}
              label="Try again"
              focusId="recorder:retry"
              onPress={props.onRetry}
            />
          </Box>
        ) : null}
        {props.take ? (
          <>
            <Box width={contentW} height={20 * ui} />
            <TakeCard width={contentW} take={props.take} {...props.takeActions} />
          </>
        ) : null}
      </Vertical>
    </Box>
  );
}

/** A short bar that fills with the input's peak level. */
function LevelMeter(props: { level: number }): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const width = METER_WIDTH * ui;
  const height = METER_HEIGHT * ui;
  const filled = Math.round(width * Math.min(1, Math.max(0, props.level)));
  return (
    <Box width={width} height={height} flexShrink={0}>
      <Surface width={width} height={height} radius={height / 2} fill={pal.border} />
      {filled > 0 ? (
        <Surface width={filled} height={height} radius={height / 2} fill={pal.accent} />
      ) : null}
    </Box>
  );
}

/** A large round button: a red dot to start, a square to stop. */
function RecordButton(props: {
  size: number;
  recording: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactNode {
  const pal = usePalette();
  const ring = Math.max(3, Math.round(props.size * 0.06));
  const glyph = props.size * 0.42;
  const fill = props.disabled ? pal.border : pal.danger;
  return (
    <Box width={props.size} height={props.size}>
      <Surface
        width={props.size}
        height={props.size}
        radius={props.size / 2}
        fill={(fill & 0x00ffffff) | 0x33000000}
      />
      <Surface
        x={ring}
        y={ring}
        width={props.size - ring * 2}
        height={props.size - ring * 2}
        radius={(props.size - ring * 2) / 2}
        fill={fill}
      />
      <IconButton
        width={props.size}
        height={props.size}
        variant="ghost"
        fill={0x00000000}
        color={0xffffffff}
        focusId="recorder:record"
        tooltip={props.recording ? "Stop recording" : "Start recording"}
        disabled={props.disabled}
        onPress={props.onPress}
        icon={(style) => (
          <ToolIcon
            name={props.recording ? "stop" : "record"}
            x={(style.size - glyph) / 2}
            y={(style.size - glyph) / 2}
            size={glyph}
            color={0xffffffff}
          />
        )}
      />
    </Box>
  );
}

/** An unsaved take: Save puts it in the recordings folder under its automatic name. */
function TakeCard(
  props: TakeActions & {
    width: number;
    take: { name: string; folder: string; busy: boolean };
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const inner = cardContent(props.width, 0).width;
  return (
    <Card width={props.width} height={TAKE_HEIGHT * ui} title="New take">
      <Vertical width={inner} gap={0}>
        <TextBlock
          width={inner}
          height={20 * ui}
          text={props.take.name}
          fontSize={13}
          maxLines={1}
          overflow="ellipsis"
        />
        <TextBlock
          width={inner}
          height={18 * ui}
          text={`Saves to ${path.basename(path.dirname(props.take.folder))}/${path.basename(props.take.folder)}. Existing files are never replaced.`}
          color={pal.muted}
          fontSize={12}
          maxLines={1}
          overflow="ellipsis"
        />
        <Box width={inner} height={12 * ui} />
        <Horizontal width={inner} height={36 * ui} gap={8 * ui} align="center">
          <Button
            height={36 * ui}
            variant="ghost"
            label="Discard take"
            focusId="recorder:discard"
            disabled={props.take.busy}
            onPress={props.onDiscard}
          />
          <Box flexGrow={1} height={1} />
          <Button
            height={36 * ui}
            label="Save as…"
            focusId="recorder:save-as"
            disabled={props.take.busy}
            onPress={props.onSaveAs}
          />
          <Button
            height={36 * ui}
            variant="primary"
            label="Save"
            focusId="recorder:save"
            disabled={props.take.busy}
            onPress={props.onSave}
          />
        </Horizontal>
      </Vertical>
    </Card>
  );
}
