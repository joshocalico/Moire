/** Files' modal dialogs: naming an item, choosing a destination, confirming permanent deletion. */
import React, { type ReactNode } from "react";
import {
  Button,
  Column,
  ConfirmationDialog,
  Dialog,
  FocusScope,
  Label,
  ModalBarrier,
  Row,
  TextField,
  usePalette,
} from "@moire/ui";
import { BATCH_PATTERN_HINT, batchNames } from "./batch-rename";

const DIALOG_WIDTH = 420;
const NAME_DIALOG_HEIGHT = 240;
const DESTINATION_DIALOG_HEIGHT = 248;
const EDGE = 4;
const BATCH_DIALOG_HEIGHT = 330;
/** New names previewed in the batch rename dialog. */
const BATCH_PREVIEW = 3;

export type NamePrompt = {
  kind: "folder" | "file" | "rename";
  directory: string;
  source?: string;
};

function ModalFrame(props: {
  width: number;
  height: number;
  dialogWidth: number;
  dialogHeight: number;
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible onDismiss={props.onDismiss} />
      <FocusScope
        x={Math.max(EDGE, Math.round((props.width - props.dialogWidth) / 2))}
        y={Math.max(EDGE, Math.round((props.height - props.dialogHeight) / 2))}
        width={props.dialogWidth}
        height={props.dialogHeight}
        trap
        onEscape={props.onDismiss}
      >
        <Dialog
          width={props.dialogWidth}
          height={props.dialogHeight}
          title={props.title}
          onClose={props.onDismiss}
        >
          {props.children}
        </Dialog>
      </FocusScope>
    </>
  );
}

/** The title and button of the name dialog for each kind of naming. */
export function namePromptText(kind: NamePrompt["kind"] | "place") {
  switch (kind) {
    case "rename":
      return { title: "Rename item", submit: "Rename" };
    case "folder":
      return { title: "New folder", submit: "Create" };
    case "file":
      return { title: "New document", submit: "Create" };
    case "place":
      return { title: "Rename place", submit: "Rename" };
  }
}

export function NameDialog(props: {
  width: number;
  height: number;
  ui: number;
  title: string;
  submitLabel: string;
  /** Under the field when there is no error. */
  hint: string;
  draft: string;
  error: string | null;
  busy: boolean;
  onDraft(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}): ReactNode {
  const pal = usePalette();
  const { ui } = props;
  const dialogWidth = Math.min(props.width - EDGE * 2, DIALOG_WIDTH * ui);
  const inner = Math.max(1, dialogWidth - Math.round(32 * ui));
  const cancel = () => {
    if (!props.busy) props.onCancel();
  };
  return (
    <ModalFrame
      width={props.width}
      height={props.height}
      dialogWidth={dialogWidth}
      dialogHeight={Math.round(NAME_DIALOG_HEIGHT * ui)}
      title={props.title}
      onDismiss={cancel}
    >
      <Column width={inner} gap={Math.round(12 * ui)}>
        <Label text="Name" fontSize={12} height={Math.round(20 * ui)} />
        <TextField
          width={inner}
          height={Math.round(36 * ui)}
          value={props.draft}
          autoFocus
          selectAllOnFocus
          invalid={!!props.error}
          onChange={props.onDraft}
          onSubmit={props.onSubmit}
          onCancel={cancel}
        />
        <Label
          width={inner}
          height={Math.round(40 * ui)}
          text={props.error ?? props.hint}
          color={props.error ? pal.danger : pal.muted}
          fontSize={11}
          wrap
          maxLines={3}
          overflow="ellipsis"
        />
        <Row height={Math.round(32 * ui)} gap={Math.round(8 * ui)}>
          <Button
            width={Math.round(92 * ui)}
            height={Math.round(32 * ui)}
            label={props.submitLabel}
            variant="primary"
            disabled={props.busy}
            onPress={props.onSubmit}
          />
          <Button
            width={Math.round(88 * ui)}
            height={Math.round(32 * ui)}
            label="Cancel"
            variant="ghost"
            disabled={props.busy}
            onPress={cancel}
          />
        </Row>
      </Column>
    </ModalFrame>
  );
}

export function DestinationDialog(props: {
  width: number;
  height: number;
  ui: number;
  kind: "copy" | "move";
  count: number;
  draft: string;
  onDraft(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}): ReactNode {
  const { ui } = props;
  const dialogWidth = props.width - EDGE * 2;
  const inner = Math.max(1, props.width - 40);
  return (
    <ModalFrame
      width={props.width}
      height={props.height}
      dialogWidth={dialogWidth}
      dialogHeight={Math.round(DESTINATION_DIALOG_HEIGHT * ui)}
      title={`${props.kind === "copy" ? "Copy" : "Move"} ${props.count} ${props.count === 1 ? "item" : "items"} to folder`}
      onDismiss={props.onCancel}
    >
      <Column width={inner} gap={Math.round(12 * ui)}>
        <Label
          width={inner}
          height={Math.round(36 * ui)}
          text="Destination folder (absolute path or ~ for Home)"
          fontSize={12}
          wrap
          maxLines={2}
        />
        <TextField
          width={inner}
          value={props.draft}
          autoFocus
          selectAllOnFocus
          onChange={props.onDraft}
          onCancel={props.onCancel}
          onSubmit={props.onSubmit}
        />
        <Button
          width={inner}
          height={Math.round(32 * ui)}
          label={props.kind === "copy" ? "Copy here" : "Move here"}
          variant="primary"
          onPress={props.onSubmit}
        />
      </Column>
    </ModalFrame>
  );
}

/** One pattern for several names, with the first new names previewed under it. */
export function BatchRenameDialog(props: {
  width: number;
  height: number;
  ui: number;
  names: readonly string[];
  pattern: string;
  error: string | null;
  busy: boolean;
  onPattern(value: string): void;
  onSubmit(names: string[]): void;
  onCancel(): void;
}): ReactNode {
  const pal = usePalette();
  const { ui } = props;
  const dialogWidth = Math.min(props.width - EDGE * 2, DIALOG_WIDTH * ui);
  const inner = Math.max(1, dialogWidth - Math.round(32 * ui));
  const planned = batchNames(props.names, props.pattern);
  const error = props.error ?? planned.error;
  const shown = props.names.slice(0, BATCH_PREVIEW);
  const preview = [
    ...shown.map((name, index) => `${name} → ${planned.names[index]}`),
    ...(props.names.length > shown.length ? [`and ${props.names.length - shown.length} more`] : []),
  ].join("\n");
  const cancel = () => {
    if (!props.busy) props.onCancel();
  };
  const submit = () => {
    if (!error && !props.busy) props.onSubmit(planned.names);
  };
  return (
    <ModalFrame
      width={props.width}
      height={props.height}
      dialogWidth={dialogWidth}
      dialogHeight={Math.round(BATCH_DIALOG_HEIGHT * ui)}
      title={`Rename ${props.names.length} items`}
      onDismiss={cancel}
    >
      <Column width={inner} gap={Math.round(10 * ui)}>
        <Label text="Pattern" fontSize={12} height={Math.round(20 * ui)} />
        <TextField
          width={inner}
          height={Math.round(36 * ui)}
          value={props.pattern}
          focusId="batch-rename:pattern"
          autoFocus
          selectAllOnFocus
          invalid={!!error}
          onChange={props.onPattern}
          onSubmit={submit}
          onCancel={cancel}
        />
        <Label
          width={inner}
          height={Math.round(18 * ui)}
          text={error ?? BATCH_PATTERN_HINT}
          color={error ? pal.danger : pal.muted}
          fontSize={11}
          maxLines={1}
          overflow="ellipsis"
        />
        <Label
          width={inner}
          height={Math.round(18 * (BATCH_PREVIEW + 1) * ui)}
          text={preview}
          fontSize={12}
          wrap
          maxLines={BATCH_PREVIEW + 1}
          overflow="ellipsis"
        />
        <Row height={Math.round(32 * ui)} gap={Math.round(8 * ui)}>
          <Button
            width={Math.round(92 * ui)}
            height={Math.round(32 * ui)}
            label="Rename"
            variant="primary"
            focusId="batch-rename:submit"
            disabled={props.busy || !!error}
            onPress={submit}
          />
          <Button
            width={Math.round(88 * ui)}
            height={Math.round(32 * ui)}
            label="Cancel"
            variant="ghost"
            disabled={props.busy}
            onPress={cancel}
          />
        </Row>
      </Column>
    </ModalFrame>
  );
}

export type Confirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => void;
};

/** Irreversible actions (Delete Permanently, Empty Trash) say exactly what they will remove. */
export function ConfirmDialog(props: {
  width: number;
  height: number;
  value: Confirmation;
  onDismiss(): void;
}): ReactNode {
  return (
    <ConfirmationDialog
      open
      viewportWidth={props.width}
      viewportHeight={props.height}
      title={props.value.title}
      message={props.value.message}
      confirmLabel={props.value.confirmLabel}
      danger
      onConfirm={() => {
        props.onDismiss();
        props.value.run();
      }}
      onDismiss={props.onDismiss}
    />
  );
}
