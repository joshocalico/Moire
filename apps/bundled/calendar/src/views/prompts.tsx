/** Everything modal over the calendar: the editor, its leave prompt, and confirmations. */
import React, { type ReactNode } from "react";
import { ConfirmationDialog, type WindowSize } from "@moire/ui";
import type { CalendarEvent, DraftKey, EventDraft } from "#calendar/model";
import type { StoragePrompt } from "#calendar/use-calendar-store";
import type { EditorState } from "#calendar/use-event-editor";
import { ImportReportDialog, LeaveDraftDialog, type ImportReport } from "./dialogs";
import { CalendarEventEditor } from "./editor";

export function CalendarPrompts(
  props: WindowSize & {
    status: string;
    editor: EditorState;
    onDraftChange: <K extends DraftKey>(key: K, value: EventDraft[K]) => void;
    onDraftSave: () => void;
    onDraftCancel: () => void;
    onDraftDiscard: () => void;
    onDraftStay: () => void;
    report: ImportReport | null;
    onReportClose: () => void;
    deleting: CalendarEvent | null;
    onDeleteConfirm: () => void;
    onDeleteDismiss: () => void;
    storage: StoragePrompt | null;
    onStorageConfirm: () => void;
    onStorageDismiss: () => void;
  },
): ReactNode {
  const size = { width: props.width, height: props.height };
  const viewport = { viewportWidth: props.width, viewportHeight: props.height };
  const open = props.editor.kind === "open" ? props.editor : null;
  const deleting = props.deleting;
  const cleanup = props.storage?.kind === "cleanup";
  return (
    <>
      {open ? (
        <CalendarEventEditor
          {...size}
          draft={open.draft.value}
          status={
            open.error || `${props.status}. Scroll or use Page Up / Page Down for all fields.`
          }
          onChange={props.onDraftChange}
          onCancel={props.onDraftCancel}
          onSave={props.onDraftSave}
        />
      ) : null}
      {open?.leaving ? (
        <LeaveDraftDialog
          {...size}
          error={open.error}
          onSave={props.onDraftSave}
          onDiscard={props.onDraftDiscard}
          onCancel={props.onDraftStay}
        />
      ) : null}
      {props.report ? (
        <ImportReportDialog {...size} report={props.report} onClose={props.onReportClose} />
      ) : null}
      <ConfirmationDialog
        {...viewport}
        open={!!deleting}
        title="Delete event?"
        message={`Delete ${deleting?.title ?? "this event"}${deleting?.repeat ? " and all its repeats" : ""} from this calendar?`}
        confirmLabel="Delete"
        danger
        onDismiss={props.onDeleteDismiss}
        onConfirm={props.onDeleteConfirm}
      />
      <ConfirmationDialog
        {...viewport}
        open={!!props.storage}
        title={props.storage?.title ?? "Saved data changed"}
        message={props.storage?.message ?? ""}
        confirmLabel={cleanup ? "Retry" : "Reload saved"}
        cancelLabel={cleanup ? "Close" : "Keep draft"}
        onDismiss={props.onStorageDismiss}
        onConfirm={props.onStorageConfirm}
      />
    </>
  );
}
