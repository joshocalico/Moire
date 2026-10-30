import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Spinner,
  getUiScaleFactor,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import {
  AppFrame,
  OpenFileState,
  TitleActions,
  ToolButton,
  appFrameBody,
  initialFile,
  runApp,
  startMain,
} from "@moire/app-tools";
import { isDirty, statusText, targetFolder } from "./model";
import { ArchiveDialogs } from "./dialogs";
import { DocumentView } from "./document-view";
import { APP_ID, useArchive } from "./use-archive";

const TITLE = "Archive Manager";

export function ArchiveManagerApp(
  props: WindowSize & {
    initialPath?: string;
    window?: WindowActions | null;
    onCloseGuard?: (guard: (() => boolean) | null) => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const [state, controls] = useArchive({
    initialPath: props.initialPath,
    onCloseGuard: props.onCloseGuard,
    requestClose: () => props.window?.requestClose(),
  });
  const { screen } = state;
  const doc = screen.kind === "document" ? screen.doc : null;
  const busy = state.task.kind === "running";
  const dirty = !!doc && isDirty(doc);
  const body = appFrameBody({ height: props.height, title: TITLE });
  const name = doc ? (doc.file ? path.basename(doc.file) : "New archive") : undefined;
  return (
    <Box width={props.width} height={props.height}>
      <AppFrame
        {...props}
        title={TITLE}
        icon="archive"
        subtitle={name ? `${name}${dirty ? " — edited" : ""}` : undefined}
        status={statusText(state)}
        statusEnd={
          doc ? `${doc.entries.length} ${doc.entries.length === 1 ? "item" : "items"}` : undefined
        }
        actions={
          <TitleActions>
            {doc ? (
              <ToolButton
                icon="folder"
                tooltip="Open an archive"
                focusId="archive:open"
                disabled={busy}
                onPress={controls.browse}
              />
            ) : null}
            {doc ? (
              <ToolButton
                icon="plus"
                tooltip="New archive"
                focusId="archive:new"
                disabled={busy}
                onPress={controls.startNew}
              />
            ) : (
              <Button
                width={110 * ui}
                height={32 * ui}
                label="New archive"
                focusId="archive:new"
                onPress={controls.startNew}
              />
            )}
            {doc ? (
              <Button
                width={84 * ui}
                height={32 * ui}
                label="Save as…"
                focusId="archive:save-as"
                disabled={busy || !doc.entries.length}
                onPress={() => controls.setDialog({ kind: "chooser", purpose: "save-as" })}
              />
            ) : null}
            {doc ? (
              <Button
                width={64 * ui}
                height={32 * ui}
                label="Save"
                variant={dirty ? "primary" : "secondary"}
                focusId="archive:save"
                disabled={busy || !dirty}
                onPress={() => controls.save()}
              />
            ) : null}
          </TitleActions>
        }
      >
        {doc ? (
          <DocumentView
            width={props.width}
            height={body.height}
            state={state}
            doc={doc}
            controls={controls}
          />
        ) : screen.kind === "loading" ? (
          <Box width={props.width} height={body.height}>
            <Spinner x={(props.width - 32 * ui) / 2} y={body.height / 2 - 16 * ui} size={32 * ui} />
          </Box>
        ) : (
          <OpenFileState
            width={props.width}
            height={body.height}
            appId={APP_ID}
            icon="archive"
            title="Open an archive"
            message="Browse, extract and edit .zip and .tar archives."
            placeholder="Path to an archive"
            error={screen.kind === "start" ? screen.error : undefined}
            onBrowse={controls.browse}
            browseLabel="Open archive…"
            onOpen={(file) => controls.open(file)}
          />
        )}
      </AppFrame>
      <ArchiveDialogs
        width={props.width}
        height={props.height}
        dialog={state.dialog}
        doc={doc}
        controls={controls}
        onClose={() => controls.setDialog(null)}
        onRename={(entry, value) => controls.edit({ kind: "rename", path: entry, name: value })}
        onNewFolder={(value) =>
          doc &&
          controls.edit({
            kind: "create-folder",
            parent: targetFolder(doc),
            name: value,
          })
        }
      />
    </Box>
  );
}

startMain(import.meta.url, () =>
  runApp(TITLE, APP_ID, (size, window) => (
    <ArchiveManagerApp
      {...size}
      window={window}
      initialPath={initialFile()}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
    />
  )),
);
