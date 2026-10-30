import React, { type ReactNode } from "react";
import { Box, getUiScaleFactor } from "@moire/ui";
import { isDirty, readOnlyReason, type ArchiveDocument, type State } from "./model";
import type { ArchiveControls } from "./use-archive";
import { Contents, type EditAction } from "./contents";
import { TASK_STRIP_HEIGHT, TaskStrip } from "./task-strip";

const PAD = 16;
const GAP = 12;

/** An open (or new) archive: the extract/task strip, then its contents and edit actions. */
export function DocumentView(props: {
  width: number;
  height: number;
  state: State;
  doc: ArchiveDocument;
  controls: ArchiveControls;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { doc, controls, state } = props;
  const busy = state.task.kind === "running";
  const pad = PAD * ui;
  const width = props.width - pad * 2;
  const strip = !!doc.file || state.task.kind !== "idle";
  const stripH = strip ? TASK_STRIP_HEIGHT * ui + GAP * ui : 0;
  const readOnly = readOnlyReason(doc);
  const editable = !readOnly && !busy;
  const selected = doc.entries.find((entry) => entry.path === doc.selected) ?? null;
  const actions: EditAction[] = [
    {
      id: "add-files",
      label: "Add files…",
      icon: "plus",
      disabled: !editable,
      onPress: () => controls.setDialog({ kind: "chooser", purpose: "add-files" }),
    },
    {
      id: "add-folder",
      label: "Add folder…",
      icon: "folder",
      disabled: !editable,
      onPress: () => controls.setDialog({ kind: "chooser", purpose: "add-folder" }),
    },
    {
      id: "new-folder",
      label: "New folder",
      icon: "folder-filled",
      disabled: !editable,
      onPress: () => controls.setDialog({ kind: "new-folder" }),
    },
    {
      id: "rename",
      label: "Rename…",
      icon: "editor",
      disabled: !editable || !selected,
      onPress: () => selected && controls.setDialog({ kind: "rename", path: selected.path }),
    },
    {
      id: "remove",
      label: "Remove",
      icon: "trash",
      disabled: !editable || !selected,
      onPress: () => selected && controls.edit({ kind: "remove", path: selected.path }),
    },
  ];
  return (
    <Box width={props.width} height={props.height}>
      {strip ? (
        <Box x={pad} y={pad} width={width} height={TASK_STRIP_HEIGHT * ui}>
          <TaskStrip
            width={width}
            task={state.task}
            file={doc.file}
            dirty={isDirty(doc)}
            onExtract={() => controls.extract()}
            onExtractTo={() => controls.setDialog({ kind: "chooser", purpose: "extract-to" })}
            onCancel={controls.cancel}
            onShow={controls.showResult}
            onDismiss={controls.dismissTask}
          />
        </Box>
      ) : null}
      <Box x={pad} y={pad + stripH} width={width} height={props.height - pad * 2 - stripH}>
        <Contents
          width={width}
          height={props.height - pad * 2 - stripH}
          entries={doc.entries}
          selected={doc.selected}
          actions={actions}
          note={state.notice || readOnly}
          noteTone={state.notice ? "danger" : "muted"}
          onSelect={controls.select}
          onRename={(entry) => editable && controls.setDialog({ kind: "rename", path: entry })}
          onRemove={(entry) => editable && controls.edit({ kind: "remove", path: entry })}
        />
      </Box>
    </Box>
  );
}
