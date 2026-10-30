/** The dialog over the window, if any: the file chooser, a name prompt, or unsaved changes. */
import path from "node:path";
import React, { type ReactNode } from "react";
import { ConfirmationDialog, type WindowSize } from "@moire/ui";
import { FileChooser } from "@moire/app-tools";
import { suggestedName, type ArchiveDocument, type Dialog, type ChooserPurpose } from "./model";
import { APP_ID, type ArchiveControls } from "./use-archive";
import { NameDialog } from "./name-dialog";

const ARCHIVE_TYPES = [
  "zip",
  "tar",
  "gz",
  "tgz",
  "xz",
  "txz",
  "bz2",
  "tbz2",
  "zst",
  "7z",
  "rar",
  "iso",
  "cpio",
];

export function ArchiveDialogs(
  props: WindowSize & {
    dialog: Dialog;
    doc: ArchiveDocument | null;
    controls: ArchiveControls;
    onClose: () => void;
    onRename: (path: string, name: string) => void;
    onNewFolder: (name: string) => void;
  },
): ReactNode {
  const { dialog, doc, controls } = props;
  const size = { width: props.width, height: props.height };
  if (!dialog) return null;
  if (dialog.kind === "chooser") {
    const directory = doc?.file ? path.dirname(doc.file) : undefined;
    const choose = (file: string) => {
      const handlers: Record<ChooserPurpose, () => void> = {
        open: () => controls.open(file, true),
        "add-files": () => void controls.addSources([file]),
        "add-folder": () => void controls.addSources([file]),
        "save-as": () => controls.save(file),
        "extract-to": () => controls.extract(file),
      };
      props.onClose();
      handlers[dialog.purpose]();
    };
    const purpose = dialog.purpose;
    return (
      <FileChooser
        {...size}
        appId={APP_ID}
        mode={
          purpose === "save-as"
            ? "save"
            : purpose === "add-folder" || purpose === "extract-to"
              ? "folder"
              : "open"
        }
        title={
          {
            open: "Open an archive",
            "add-files": "Add a file to the archive",
            "add-folder": "Add a folder to the archive",
            "save-as": "Save archive as",
            "extract-to": "Extract into folder",
          }[purpose]
        }
        accept={purpose === "open" ? ARCHIVE_TYPES : undefined}
        directory={purpose === "open" || purpose.startsWith("add") ? undefined : directory}
        name={purpose === "save-as" && doc ? suggestedName(doc) : undefined}
        onChoose={choose}
        onCancel={props.onClose}
      />
    );
  }
  if (dialog.kind === "rename")
    return (
      <NameDialog
        {...size}
        title="Rename"
        initial={path.posix.basename(dialog.path)}
        confirmLabel="Rename"
        onConfirm={(name) => props.onRename(dialog.path, name)}
        onCancel={props.onClose}
      />
    );
  if (dialog.kind === "new-folder")
    return (
      <NameDialog
        {...size}
        title="New folder"
        initial="New folder"
        confirmLabel="Create"
        onConfirm={props.onNewFolder}
        onCancel={props.onClose}
      />
    );
  return (
    <ConfirmationDialog
      open
      viewportWidth={props.width}
      viewportHeight={props.height}
      title="Discard unsaved changes?"
      message={`Your changes to ${doc?.file ? path.basename(doc.file) : "the new archive"} haven't been saved. Cancel to go back and Save them.`}
      confirmLabel="Discard"
      danger
      onConfirm={() => controls.discardAndContinue(dialog.next)}
      onDismiss={props.onClose}
    />
  );
}
