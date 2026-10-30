/** The footer: the file name to save under, and Save, Save As…, Copy Path and Show in Files. */
import React, { type ReactNode } from "react";
import { Button, Icon, Row, TextField, getUiScaleFactor } from "@moire/ui";
import { ToolButton } from "@moire/app-tools";
import { SAVE_ROW, type ScreenshotLayout } from "#screenshot/layout";

const { save: SAVE, saveAs: SAVE_AS, copyPath: COPY_PATH, tool: TOOL } = SAVE_ROW;

export function SaveRow(props: {
  layout: ScreenshotLayout;
  name: string;
  busy: boolean;
  hasImage: boolean;
  onName: (name: string) => void;
  onNameFocus: (focused: boolean) => void;
  onSubmit: (name: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCopyPath: () => void;
  onShowInFiles: () => void;
  /** Compact windows keep Save As, Copy Path and Show in Files in a menu. */
  onMore: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { layout } = props;
  const disabled = !props.hasImage || props.busy;
  const actions = !layout.saveActionsInline
    ? (TOOL + SAVE) * ui + layout.gap
    : (COPY_PATH + TOOL + SAVE_AS + SAVE) * ui + layout.gap * 3;
  return (
    <Row {...layout.footer} gap={layout.gap} align="center">
      <TextField
        height={layout.row}
        width={Math.max(1, layout.footer.width - actions - layout.gap)}
        value={props.name}
        disabled={props.busy}
        focusId="screenshot-file-name"
        leading={(style) => <Icon name="image" {...style} />}
        onFocusChange={props.onNameFocus}
        onChange={props.onName}
        onSubmit={props.onSubmit}
        placeholder="File name"
      />
      {!layout.saveActionsInline ? (
        <ToolButton
          icon="more"
          tooltip="Save As, Copy Path, Show in Files"
          focusId="screenshot-save-more"
          tooltipPlacement="top"
          disabled={disabled}
          onPress={props.onMore}
        />
      ) : (
        <>
          <Button
            height={layout.row}
            width={COPY_PATH * ui}
            variant="ghost"
            label="Copy Path"
            focusId="screenshot-copy-path"
            disabled={disabled}
            onPress={props.onCopyPath}
          />
          <ToolButton
            icon="folder"
            tooltip="Show in Files"
            focusId="screenshot-show-in-files"
            tooltipPlacement="top"
            disabled={disabled}
            onPress={props.onShowInFiles}
          />
          <Button
            height={layout.row}
            width={SAVE_AS * ui}
            label="Save As…"
            focusId="screenshot-save-as"
            disabled={disabled}
            onPress={props.onSaveAs}
          />
        </>
      )}
      <Button
        height={layout.row}
        width={SAVE * ui}
        label="Save"
        focusId="screenshot-save"
        disabled={disabled || !props.name.trim()}
        variant="primary"
        onPress={props.onSave}
      />
    </Row>
  );
}
