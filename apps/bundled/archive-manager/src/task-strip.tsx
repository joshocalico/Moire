/**
 * The strip above an archive's contents: how to extract it, then the running extract or save
 * with its progress and Cancel, then the result with Show in Files.
 */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  ProgressBar,
  Surface,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { ToolButton } from "@moire/app-tools";
import { archiveStem, type Task } from "./model";

export const TASK_STRIP_HEIGHT = 68;
const BUTTON_HEIGHT = 34;

export function TaskStrip(props: {
  width: number;
  task: Task;
  /** The saved archive's name; null for a new archive that has not been saved. */
  file: string | null;
  /** Unsaved edits: Extract still works on the saved archive, and Save becomes the primary. */
  dirty: boolean;
  onExtract: () => void;
  onExtractTo: () => void;
  onCancel: () => void;
  onShow: (target: string) => void;
  onDismiss: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const pad = 14 * ui;
  const height = TASK_STRIP_HEIGHT * ui;
  const inner = props.width - pad * 2;
  const task = props.task;
  const button = (
    label: string,
    focusId: string,
    onPress: () => void,
    variant: "primary" | "secondary" | "ghost" = "secondary",
  ) => (
    <Button
      height={BUTTON_HEIGHT * ui}
      label={label}
      variant={variant}
      focusId={focusId}
      onPress={onPress}
    />
  );
  let title: string;
  let detail: string;
  let tone = pal.text;
  let actions: ReactNode = null;
  let actionsW = 0;
  let progress: number | null = null;
  if (task.kind === "running") {
    title = task.job === "extract" ? "Extracting…" : "Saving…";
    detail = `${task.done} of ${task.total || "?"} items · ${task.target}`;
    progress = task.total ? task.done / task.total : 0;
    actions = button("Cancel", "archive:cancel", props.onCancel);
    actionsW = 84 * ui;
  } else if (task.kind === "finished") {
    title =
      task.job === "extract"
        ? `Extracted to “${path.basename(task.output)}”`
        : `Saved “${path.basename(task.output)}”`;
    detail = task.output;
    actions = (
      <>
        {button("Show in Files", "archive:show", () => props.onShow(task.output))}
        <ToolButton
          icon="close"
          tooltip="Dismiss"
          focusId="archive:dismiss"
          onPress={props.onDismiss}
        />
      </>
    );
    actionsW = 160 * ui;
  } else if (task.kind === "failed") {
    title = task.job === "extract" ? "Couldn't extract" : "Couldn't save";
    detail = task.message;
    tone = pal.danger;
    actions = button("Dismiss", "archive:dismiss", props.onDismiss, "ghost");
    actionsW = 84 * ui;
  } else {
    title = "Extract";
    detail = props.dirty
      ? "Extracts the saved archive. Save first to include your changes."
      : `Into a new folder, “${props.file ? archiveStem(props.file) : ""}”, beside the archive.`;
    actions = (
      <>
        {button("Extract to…", "archive:extract-to", props.onExtractTo)}
        {button(
          "Extract",
          "archive:extract",
          props.onExtract,
          props.dirty ? "secondary" : "primary",
        )}
      </>
    );
    actionsW = 200 * ui;
  }
  const textW = Math.max(40 * ui, inner - actionsW - 12 * ui);
  return (
    <Surface
      width={props.width}
      height={height}
      fill={pal.surface}
      stroke={pal.borderSubtle}
      strokeWidth={1}
      radius={12 * ui}
    >
      <Horizontal x={pad} width={inner} height={height} gap={12 * ui} align="center">
        <Vertical width={textW} gap={4 * ui}>
          <TextBlock
            width={textW}
            height={20 * ui}
            text={title}
            color={tone}
            fontSize={13}
            fontWeight="medium"
            maxLines={1}
            overflow="ellipsis"
          />
          {progress === null ? (
            <TextBlock
              width={textW}
              height={18 * ui}
              text={detail}
              color={pal.muted}
              fontSize={12}
              maxLines={1}
              overflow="ellipsis"
            />
          ) : (
            <Vertical width={textW} gap={4 * ui}>
              <ProgressBar width={textW} height={6 * ui} value={progress} />
              <TextBlock
                width={textW}
                height={16 * ui}
                text={detail}
                color={pal.muted}
                fontSize={11}
                maxLines={1}
                overflow="ellipsis"
              />
            </Vertical>
          )}
        </Vertical>
        <Box flexGrow={1} height={1} />
        <Horizontal height={BUTTON_HEIGHT * ui} gap={8 * ui} align="center">
          {actions}
        </Horizontal>
      </Horizontal>
    </Surface>
  );
}
