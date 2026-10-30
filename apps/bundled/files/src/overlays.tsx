/** Everything drawn above the workspace: the in-window menu fallback, dialogs and transfers. */
import React, { type ReactNode } from "react";
import { ContextMenu } from "@moire/ui";
import type { TransferKind } from "@moire/file-operations";
import {
  BatchRenameDialog,
  ConfirmDialog,
  DestinationDialog,
  NameDialog,
  namePromptText,
  type Confirmation,
  type NamePrompt,
} from "./dialogs";
import type { Entry } from "./filesystem";
import type { FilePlace } from "./places";
import { ShortcutsSheet } from "./views/shortcuts-sheet";
import { TransferDialog, type TransferConflict, type TransferDisplay } from "./transfer-dialog";
import type { ContextMenuRequest } from "./workspace";

export type Overlay =
  | { kind: "menu"; request: ContextMenuRequest }
  | { kind: "name"; prompt: NamePrompt; draft: string; error: string | null }
  | { kind: "place-name"; place: FilePlace; draft: string; error: string | null }
  | { kind: "shortcuts" }
  | { kind: "destination"; transfer: TransferKind; paths: string[]; draft: string }
  | { kind: "confirm"; value: Confirmation }
  | { kind: "batch-rename"; entries: Entry[]; pattern: string; error: string | null };

export function WorkspaceOverlays(props: {
  width: number;
  height: number;
  ui: number;
  overlay: Overlay | null;
  busy: boolean;
  onChange(overlay: Overlay | null): void;
  onSubmitName(prompt: NamePrompt, name: string): void;
  onRenamePlace(place: FilePlace, label: string): void;
  onSubmitDestination(kind: TransferKind, paths: string[], destination: string): void;
  /** Rename each entry to its new name; resolves to an error to show, or null when done. */
  onBatchRename(entries: readonly Entry[], names: readonly string[]): Promise<string | null>;
  transfer: TransferDisplay | null;
  conflict: TransferConflict | null;
  onCancelTransfer(): void;
  onDismissTransfer(): void;
  onShowTransferFolder?: () => void;
}): ReactNode {
  const { overlay, width, height, ui } = props;
  const close = () => props.onChange(null);
  return (
    <>
      {overlay?.kind === "menu" ? (
        <ContextMenu
          viewportWidth={width}
          viewportHeight={height}
          x={overlay.request.x}
          y={overlay.request.y}
          title={overlay.request.title}
          actions={overlay.request.actions}
          onDismiss={close}
        />
      ) : null}
      {overlay?.kind === "name" ? (
        <NameDialog
          width={width}
          height={height}
          ui={ui}
          title={namePromptText(overlay.prompt.kind).title}
          submitLabel={namePromptText(overlay.prompt.kind).submit}
          hint="Existing items are never replaced."
          draft={overlay.draft}
          error={overlay.error}
          busy={props.busy}
          onDraft={(draft) => props.onChange({ ...overlay, draft, error: null })}
          onSubmit={() => props.onSubmitName(overlay.prompt, overlay.draft)}
          onCancel={close}
        />
      ) : null}
      {overlay?.kind === "place-name" ? (
        <NameDialog
          width={width}
          height={height}
          ui={ui}
          title={namePromptText("place").title}
          submitLabel={namePromptText("place").submit}
          hint="Only the name in Files changes; the folder keeps its own name."
          draft={overlay.draft}
          error={overlay.error}
          busy={false}
          onDraft={(draft) => props.onChange({ ...overlay, draft, error: null })}
          onSubmit={() => {
            if (!overlay.draft.trim()) {
              props.onChange({ ...overlay, error: "Enter a name" });
              return;
            }
            props.onRenamePlace(overlay.place, overlay.draft.trim());
            close();
          }}
          onCancel={close}
        />
      ) : null}
      {overlay?.kind === "shortcuts" ? (
        <ShortcutsSheet width={width} height={height} onDismiss={close} />
      ) : null}
      {overlay?.kind === "destination" ? (
        <DestinationDialog
          width={width}
          height={height}
          ui={ui}
          kind={overlay.transfer}
          count={overlay.paths.length}
          draft={overlay.draft}
          onDraft={(draft) => props.onChange({ ...overlay, draft })}
          onCancel={close}
          onSubmit={() => {
            close();
            props.onSubmitDestination(overlay.transfer, overlay.paths, overlay.draft);
          }}
        />
      ) : null}
      {overlay?.kind === "batch-rename" ? (
        <BatchRenameDialog
          width={width}
          height={height}
          ui={ui}
          names={overlay.entries.map((entry) => entry.name)}
          pattern={overlay.pattern}
          error={overlay.error}
          busy={props.busy}
          onPattern={(pattern) => props.onChange({ ...overlay, pattern, error: null })}
          onSubmit={(names) =>
            void props
              .onBatchRename(overlay.entries, names)
              .then((error) => props.onChange(error ? { ...overlay, error } : null))
          }
          onCancel={close}
        />
      ) : null}
      {overlay?.kind === "confirm" ? (
        <ConfirmDialog width={width} height={height} value={overlay.value} onDismiss={close} />
      ) : null}
      {props.transfer ? (
        <TransferDialog
          width={width}
          height={height}
          value={props.transfer}
          conflict={props.conflict}
          onCancel={props.onCancelTransfer}
          onDismiss={props.onDismissTransfer}
          onShowInFolder={props.onShowTransferFolder}
        />
      ) : null}
    </>
  );
}
