/**
 * The running operation with its progress and Cancel, or the last outcome with Undo, as a
 * card at the page's bottom right, above the selection bar.
 */
import React, { useEffect, type ReactNode } from "react";
import {
  Button,
  ProgressBar,
  Surface,
  TextBlock,
  getUiScaleFactor,
  measureWrappedText,
  usePalette,
} from "@moire/ui";
import type { RunningOperation } from "@moire/file-operations";
import type { OperationNotice } from "#files/use-operations";

const WIDTH = 400;
const HEIGHT = 64;
const LINE = 16;
const MAX_LINES = 3;
/** Successful outcomes fade on their own; errors stay until dismissed. */
const NOTICE_TIMEOUT_MS = 8000;
const ACTION_WIDTH = 72;

type CardState = {
  running: RunningOperation | null;
  notice: OperationNotice | null;
  canUndo: boolean;
};

function cardText(state: CardState): string {
  const progress = state.running?.progress;
  return state.running
    ? `${state.running.cancelling ? "Cancelling" : state.running.label}${progress ? ` · ${progress.done}/${progress.total}` : "…"}`
    : (state.notice?.message ?? "");
}

function actionCount(state: CardState): number {
  return state.running ? 1 : state.notice?.undo && state.canUndo ? 2 : 1;
}

/** The card's size: it grows to three lines so an outcome is read in full. */
export function operationCardSize(pageWidth: number, state: CardState) {
  const ui = getUiScaleFactor();
  const width = Math.min(Math.round(WIDTH * ui), pageWidth - Math.round(32 * ui));
  const textWidth = Math.max(
    1,
    width - Math.round(28 * ui) - actionCount(state) * Math.round((ACTION_WIDTH + 6) * ui),
  );
  const lines = state.running
    ? 1
    : Math.min(
        MAX_LINES,
        measureWrappedText(cardText(state), textWidth, { fontSize: 12 }).lines.length,
      );
  return { width, height: Math.max(Math.round(HEIGHT * ui), Math.round((lines * LINE + 28) * ui)) };
}

export function OperationCard(props: {
  width: number;
  height: number;
  running: RunningOperation | null;
  notice: OperationNotice | null;
  canUndo: boolean;
  onCancel(): void;
  onUndo(): void;
  onDismiss(): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const { running, notice } = props;
  const dismiss = props.onDismiss;
  useEffect(() => {
    if (running || !notice || notice.tone === "error") return;
    const timer = setTimeout(dismiss, NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [running, notice, dismiss]);
  const progress = running?.progress;
  const fraction =
    progress && progress.bytesTotal
      ? (progress.bytes ?? 0) / progress.bytesTotal
      : progress && progress.total
        ? progress.done / progress.total
        : undefined;
  const text = cardText(props);
  const actions = running
    ? [
        {
          label: "Cancel",
          variant: "ghost" as const,
          disabled: running.cancelling,
          onPress: props.onCancel,
        },
      ]
    : [
        ...(notice?.undo && props.canUndo
          ? [
              {
                label: "Undo",
                variant: "secondary" as const,
                disabled: false,
                onPress: props.onUndo,
              },
            ]
          : []),
        { label: "Dismiss", variant: "ghost" as const, disabled: false, onPress: props.onDismiss },
      ];
  const actionWidth = px(ACTION_WIDTH);
  const textWidth = Math.max(1, props.width - px(28) - actions.length * (actionWidth + px(6)));
  return (
    <Surface
      width={props.width}
      height={props.height}
      fill={pal.overlay}
      radius={px(12)}
      stroke={pal.border}
      strokeWidth={1}
      elevation="medium"
    >
      <TextBlock
        x={px(14)}
        y={running && fraction !== undefined ? px(10) : 0}
        width={textWidth}
        height={running && fraction !== undefined ? px(24) : props.height}
        text={text}
        fontSize={12}
        color={notice?.tone === "error" && !running ? pal.danger : pal.text}
        verticalAlign="center"
        wrap={!running}
        maxLines={running ? 1 : MAX_LINES}
        overflow="ellipsis"
      />
      {running && fraction !== undefined ? (
        <ProgressBar x={px(14)} y={px(40)} width={textWidth} size="small" value={fraction} />
      ) : null}
      {actions.map((action, index) => (
        <Button
          key={action.label}
          x={props.width - px(10) - (actions.length - index) * (actionWidth + px(6)) + px(6)}
          y={Math.round((props.height - px(30)) / 2)}
          width={actionWidth}
          height={px(30)}
          size="small"
          label={action.label}
          variant={action.variant}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ))}
    </Surface>
  );
}
