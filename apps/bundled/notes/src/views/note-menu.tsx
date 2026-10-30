import React, { type ReactNode } from "react";
import { ContextMenu } from "@moire/ui";
import type { Note, NoteNotebook } from "#notes/store";
import { NOTE_ACTIONS, type NoteAction } from "#notes/model";

const LABELS: Record<NoteAction, string> = {
  rename: "Rename",
  pin: "Pin",
  move: "Move to notebook",
  export: "Export as text…",
  reload: "Reload saved notes",
  delete: "Delete note",
};

/** The note actions menu, or its "Move to notebook" list. */
export function NoteMenu(props: {
  menu: "actions" | "move";
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  note: Note | undefined;
  notebooks: readonly NoteNotebook[];
  onAction: (action: NoteAction) => void;
  onMove: (notebookId: string) => void;
  onDismiss: () => void;
}): ReactNode {
  const { note } = props;
  const actions =
    props.menu === "move"
      ? props.notebooks.map((notebook) => ({
          id: notebook.id,
          label: notebook.title,
          disabled: notebook.id === note?.notebookId,
          onPress: () => props.onMove(notebook.id),
        }))
      : NOTE_ACTIONS.map((id) => ({
          id,
          label: id === "pin" && note?.pinned ? "Unpin" : LABELS[id],
          // Reload works without a note; everything else acts on the open one.
          disabled: id !== "reload" && !note,
          danger: id === "delete",
          separatorBefore: id === "reload",
          onPress: () => props.onAction(id),
        }));
  return (
    <ContextMenu
      // A new key restarts the menu's reveal when it switches to the notebook list.
      key={props.menu}
      viewportWidth={props.viewportWidth}
      viewportHeight={props.viewportHeight}
      x={props.x}
      y={props.y}
      title={props.menu === "move" ? "Move to notebook" : "Note actions"}
      actions={actions}
      onDismiss={props.onDismiss}
    />
  );
}
