/** Screenshot's modal questions: unsaved changes, replacing a file, crop bounds, new capture. */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Button,
  Column,
  Dialog,
  FocusScope,
  Label,
  ModalBarrier,
  Row,
  ScrollColumn,
  TextField,
  getUiScaleFactor,
  usePalette,
  useWidgetTheme,
  type WindowSize,
} from "@moire/ui";
import type { CaptureOptions, Prompt } from "#screenshot/model";
import { CaptureOptionsForm } from "./capture-options";

const DIALOG_WIDTH = 460;
const DIALOG_HEIGHT = 320;
const MARGIN = 16;
const ROW = 34;

/** Existing shared modal/footer contract; exported for independent real-layout hit checks. */
export function ScreenshotDialog(
  props: WindowSize & {
    title: string;
    onDismiss: () => void;
    footer: ReactNode;
    children: ReactNode;
  },
): ReactNode {
  const scale = getUiScaleFactor();
  const width = Math.max(1, Math.min(DIALOG_WIDTH * scale, props.width - MARGIN));
  const height = Math.max(1, Math.min(DIALOG_HEIGHT * scale, props.height - MARGIN));
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} onDismiss={props.onDismiss} />
      <FocusScope
        x={(props.width - width) / 2}
        y={(props.height - height) / 2}
        width={width}
        height={height}
        trap
        onEscape={props.onDismiss}
      >
        <Dialog
          width={width}
          height={height}
          title={props.title}
          onClose={props.onDismiss}
          footer={props.footer}
        >
          <ScrollColumn flexGrow={1} gap={6 * scale} smooth={false}>
            {props.children}
          </ScrollColumn>
        </Dialog>
      </FocusScope>
    </>
  );
}

type CropFields = { x: string; y: string; width: string; height: string };

/** The dialog for the current prompt; file choosers are drawn by the app instead. */
export function PromptDialog(
  props: WindowSize & {
    prompt: Exclude<Prompt, { kind: "choose-open" } | { kind: "choose-save" }>;
    status: string;
    busy: boolean;
    saving: boolean;
    hasImage: boolean;
    captureOptions: CaptureOptions;
    crop: CropFields;
    onCaptureOptions: (options: CaptureOptions) => void;
    onCrop: (crop: CropFields) => void;
    onSave: () => void;
    onDiscard: () => void;
    onReplace: () => void;
    onApplyCrop: () => void;
    onTake: () => void;
    onDismiss: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const theme = useWidgetTheme();
  const { prompt } = props;
  const bodyWidth = Math.max(
    1,
    Math.min(DIALOG_WIDTH * ui, props.width - MARGIN) -
      theme.recipes.dialog.medium.metrics.bodyPaddingX * 2,
  );
  const field = (key: keyof CropFields, width: number) => (
    <TextField
      width={width}
      height={ROW * ui}
      value={props.crop[key]}
      onChange={(value) => props.onCrop({ ...props.crop, [key]: value })}
      onSubmit={props.onApplyCrop}
    />
  );
  const title =
    prompt.kind === "new-capture"
      ? "New screenshot"
      : prompt.kind === "crop"
        ? "Crop image"
        : prompt.kind === "overwrite"
          ? "Replace existing PNG?"
          : "Save changes first?";
  // Footers stay a column of buttons; lifecycle smokes check this layout independently.
  const footer =
    prompt.kind === "unsaved" ? (
      <Column gap={6 * ui}>
        <Button
          label="Save"
          variant="primary"
          disabled={props.busy || !props.hasImage}
          focusId="screenshot-prompt-save"
          onPress={props.onSave}
        />
        <Button
          label="Discard"
          disabled={props.saving}
          focusId="screenshot-prompt-discard"
          onPress={props.onDiscard}
        />
        <Button
          label="Cancel"
          autoFocus
          focusId="screenshot-prompt-cancel"
          onPress={props.onDismiss}
        />
      </Column>
    ) : prompt.kind === "overwrite" ? (
      <Column gap={6 * ui}>
        <Button
          label="Replace"
          variant="danger"
          disabled={props.busy}
          focusId="screenshot-replace"
          onPress={props.onReplace}
        />
        <Button
          label="Cancel"
          disabled={props.busy}
          autoFocus
          focusId="screenshot-prompt-cancel"
          onPress={props.onDismiss}
        />
      </Column>
    ) : (
      <Column gap={6 * ui}>
        <Button
          label={prompt.kind === "new-capture" ? "Take Screenshot" : "Apply crop"}
          variant="primary"
          disabled={props.busy}
          autoFocus={prompt.kind === "new-capture"}
          focusId={prompt.kind === "new-capture" ? "screenshot-take" : "screenshot-prompt-apply"}
          onPress={prompt.kind === "new-capture" ? props.onTake : props.onApplyCrop}
        />
        <Button
          label="Cancel"
          autoFocus={prompt.kind !== "new-capture"}
          focusId="screenshot-prompt-cancel"
          onPress={props.onDismiss}
        />
      </Column>
    );
  const halfField = (labelWidth: number) => (bodyWidth - 2 * labelWidth * ui - 18 * ui) / 2;
  return (
    <ScreenshotDialog {...props} title={title} onDismiss={props.onDismiss} footer={footer}>
      {prompt.kind === "new-capture" ? (
        <CaptureOptionsForm
          width={bodyWidth}
          options={props.captureOptions}
          onChange={props.onCaptureOptions}
        />
      ) : prompt.kind === "crop" ? (
        <>
          <Label text="Crop bounds in source pixels" fontSize={12} />
          <Row height={ROW * ui} gap={6 * ui}>
            <Label width={22 * ui} text="X" fontSize={12} />
            {field("x", halfField(22))}
            <Label width={22 * ui} text="Y" fontSize={12} />
            {field("y", halfField(22))}
          </Row>
          <Row height={ROW * ui} gap={6 * ui}>
            <Label width={48 * ui} text="Width" fontSize={12} />
            {field("width", halfField(48))}
            <Label width={48 * ui} text="Height" fontSize={12} />
            {field("height", halfField(48))}
          </Row>
        </>
      ) : (
        <Label
          text={
            prompt.kind === "overwrite"
              ? `Replace ${path.basename(prompt.save.target)} in ${path.dirname(prompt.save.target)}? Cancel keeps the image unsaved.`
              : props.busy
                ? "An operation is in progress. Discard cancels it and goes on without saving; Cancel keeps this window open."
                : "The current image has unsaved changes. Save it, discard it, or cancel to keep editing."
          }
          fontSize={12}
          color={pal.muted}
          wrap
        />
      )}
      {prompt.kind === "new-capture" ? null : (
        <Label text={props.status} fontSize={11} color={pal.muted} wrap />
      )}
    </ScreenshotDialog>
  );
}
