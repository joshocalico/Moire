/** The editor's small modal questions: unsaved changes, replacing a file, going to a line. */
import os from "node:os";
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Button,
  Dialog,
  FocusScope,
  Horizontal,
  Icon,
  Label,
  ModalBarrier,
  TextField,
  Vertical,
  getUiScaleFactor,
  measureColumnContent,
  usePalette,
  useWidgetTheme,
  type WindowSize,
} from "@moire/ui";

const DIALOG_WIDTH = 480;
const MARGIN = 32;

/** A centred modal dialog sized to its content, with right-aligned footer actions. */
function EditorDialog(
  props: WindowSize & {
    title: string;
    onDismiss: () => void;
    actions: ReactNode;
    children: (width: number) => ReactNode;
  },
): ReactNode {
  const theme = useWidgetTheme();
  const ui = getUiScaleFactor();
  const metrics = theme.recipes.dialog.medium.metrics;
  const space = theme.foundations.space;
  const width = Math.max(1, Math.min(DIALOG_WIDTH * ui, props.width - MARGIN * ui));
  const inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const body = props.children(inner);
  const footer = (
    <Horizontal width={inner} justify="end" align="center" gap={space.sm}>
      {props.actions}
    </Horizontal>
  );
  const bodyHeight = measureColumnContent({ width: inner, gap: 0, children: body }, theme).height;
  const footerHeight = measureColumnContent(
    {
      width,
      padding: {
        top: space.md,
        right: metrics.bodyPaddingX,
        bottom: metrics.bodyPaddingBottom,
        left: metrics.bodyPaddingX,
      },
      gap: 0,
      children: footer,
    },
    theme,
  ).height;
  const height = Math.max(
    1,
    Math.min(
      props.height - MARGIN * ui,
      Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyHeight + footerHeight),
    ),
  );
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible onDismiss={props.onDismiss} />
      <FocusScope
        x={(props.width - width) / 2}
        y={Math.max((MARGIN / 2) * ui, (props.height - height) / 2.6)}
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
          footer={footer}
        >
          {body}
        </Dialog>
      </FocusScope>
    </>
  );
}

function Message(props: { width: number; text: string; error: string }): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  return (
    <Vertical width={props.width} gap={8 * ui}>
      <Label width={props.width} text={props.text} fontSize={13} wrap />
      {props.error ? (
        <Label width={props.width} text={props.error} fontSize={12} color={pal.danger} wrap />
      ) : null}
    </Vertical>
  );
}

function displayDirectory(file: string): string {
  const directory = path.dirname(file),
    home = os.homedir();
  return directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory;
}

export function DiscardDialog(
  props: WindowSize & {
    name: string;
    error: string;
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
  },
): ReactNode {
  return (
    <EditorDialog
      {...props}
      title="Save changes before leaving?"
      onDismiss={props.onCancel}
      actions={
        <>
          <Button label="Discard" variant="danger" onPress={props.onDiscard} />
          <Button label="Cancel" onPress={props.onCancel} />
          <Button label="Save" variant="primary" autoFocus onPress={props.onSave} />
        </>
      }
    >
      {(width) => (
        <Message
          width={width}
          text={`${props.name} has unsaved changes. Save it, discard the changes, or keep editing.`}
          error={props.error}
        />
      )}
    </EditorDialog>
  );
}

export function OverwriteDialog(
  props: WindowSize & {
    file: string;
    error: string;
    onReplace: () => void;
    onCancel: () => void;
  },
): ReactNode {
  return (
    <EditorDialog
      {...props}
      title="Replace this file?"
      onDismiss={props.onCancel}
      actions={
        <>
          <Button label="Cancel" autoFocus onPress={props.onCancel} />
          <Button label="Replace" variant="danger" onPress={props.onReplace} />
        </>
      }
    >
      {(width) => (
        <Message
          width={width}
          text={`“${path.basename(props.file)}” already exists in ${displayDirectory(props.file)}. Replacing it overwrites its contents.`}
          error={props.error}
        />
      )}
    </EditorDialog>
  );
}

export function GoToLineDialog(
  props: WindowSize & {
    input: string;
    lines: number;
    error: string;
    onChange: (input: string) => void;
    onGo: () => void;
    onCancel: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  return (
    <EditorDialog
      {...props}
      title="Go to line"
      onDismiss={props.onCancel}
      actions={
        <>
          <Button label="Cancel" onPress={props.onCancel} />
          <Button
            label="Go"
            variant="primary"
            focusId="editor:go-to-line"
            disabled={!props.input.trim()}
            onPress={props.onGo}
          />
        </>
      }
    >
      {(width) => (
        <Vertical width={width} gap={8 * ui}>
          <Label
            width={width}
            text={`Line number (1–${props.lines})`}
            fontSize={12}
            color={pal.muted}
          />
          <TextField
            width={width}
            height={36 * ui}
            value={props.input}
            autoFocus
            selectAllOnFocus
            focusId="editor:line-number"
            invalid={!!props.error}
            leading={(style) => <Icon name="list" {...style} />}
            onChange={props.onChange}
            onSubmit={props.onGo}
            onCancel={props.onCancel}
          />
          {props.error ? (
            <Label width={width} text={props.error} fontSize={12} color={pal.danger} wrap />
          ) : null}
        </Vertical>
      )}
    </EditorDialog>
  );
}
