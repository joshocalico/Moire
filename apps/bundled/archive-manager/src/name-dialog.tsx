/** A small modal asking for a name: renaming an entry, or naming a new folder. */
import React, { useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Dialog,
  FocusScope,
  Horizontal,
  ModalBarrier,
  TextField,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";

const DIALOG_WIDTH = 420;
const DIALOG_HEIGHT = 190;

export function NameDialog(
  props: WindowSize & {
    title: string;
    initial: string;
    confirmLabel: string;
    onConfirm: (name: string) => void;
    onCancel: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const [name, setName] = useState(props.initial);
  const width = Math.min(DIALOG_WIDTH * ui, props.width - 32 * ui);
  const height = DIALOG_HEIGHT * ui;
  const confirm = () => {
    if (name.trim()) props.onConfirm(name);
  };
  return (
    <Box width={props.width} height={props.height}>
      <ModalBarrier
        width={props.width}
        height={props.height}
        visible
        active
        onDismiss={props.onCancel}
      />
      <FocusScope
        id="archive:name-dialog"
        width={props.width}
        height={props.height}
        trap
        onEscape={props.onCancel}
      >
        <Dialog
          x={(props.width - width) / 2}
          y={(props.height - height) / 2}
          width={width}
          height={height}
          title={props.title}
          onClose={props.onCancel}
          footer={
            <Horizontal width={width - 40 * ui} height={36 * ui} gap={8 * ui} align="center">
              <Box flexGrow={1} height={1} />
              <Button height={34 * ui} label="Cancel" onPress={props.onCancel} />
              <Button
                height={34 * ui}
                variant="primary"
                label={props.confirmLabel}
                focusId="archive:name-confirm"
                disabled={!name.trim()}
                onPress={confirm}
              />
            </Horizontal>
          }
        >
          <TextField
            width={width - 40 * ui}
            height={36 * ui}
            value={name}
            focusId="archive:name-field"
            autoFocus
            selectAllOnFocus
            onChange={setName}
            onSubmit={confirm}
            onCancel={props.onCancel}
          />
        </Dialog>
      </FocusScope>
    </Box>
  );
}
