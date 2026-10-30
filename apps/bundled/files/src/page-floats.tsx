/**
 * What floats over the page: the selection bar (two or more items) and the operation card above
 * it, both in the room left of the Properties pane, and the pane itself at the right edge.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  SelectionBar,
  getUiScaleFactor,
  selectionBarHeight,
  type SelectionBarAction,
} from "@moire/ui";
import type { Entry } from "./filesystem";
import { formatBytes } from "./format";
import type { InspectorActions } from "./inspector-actions";
import { itemsOf, pathsOf, type useWorkspaceCommands } from "./use-commands";
import type { FilesOperations } from "./use-operations";
import { InspectorSheet } from "./views/inspector/inspector-sheet";
import { OperationCard, operationCardSize } from "./views/operation-card";
import { PropertiesSheet, type PropertiesDock } from "./views/properties-sheet";

const EDGE = 16;
const BAR_PADDING = 12;
const BAR_MAX = 640;

export function PageFloats(props: {
  width: number;
  height: number;
  windowWidth: number;
  windowHeight: number;
  /** How the page and the Properties pane share the width. */
  dock: PropertiesDock;
  selectionBar: boolean;
  properties: boolean;
  onCloseProperties(): void;
  selected: readonly Entry[];
  cwd: string;
  trashDirectory: string;
  inTrash: boolean;
  revision: number;
  renameRequest: number;
  ops: FilesOperations;
  commands: ReturnType<typeof useWorkspaceCommands>;
  inspector: InspectorActions;
}): ReactNode {
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const { ops, commands, selected } = props;
  const paths = pathsOf(selected);
  const barHeight = selectionBarHeight();
  const bytes = selected
    .filter((entry) => !entry.isDir)
    .reduce((sum, entry) => sum + entry.size, 0);
  const more: SelectionBarAction = {
    id: "more",
    label: "More",
    icon: "more",
    onPress: () => commands.showSelectionMenu(),
  };
  const actions: SelectionBarAction[] = props.inTrash
    ? [
        {
          id: "restore",
          label: "Restore",
          icon: "restart",
          onPress: () => void ops.restore(paths),
        },
        {
          id: "delete",
          label: "Delete",
          icon: "trash",
          tone: "danger",
          onPress: () => commands.confirmDelete(paths),
        },
        more,
      ]
    : [
        {
          id: "open",
          label: "Open",
          icon: "forward",
          onPress: () => commands.openItems(itemsOf(selected)),
        },
        { id: "copy", label: "Copy", icon: "copy", onPress: () => commands.stash("copy", paths) },
        {
          id: "move",
          label: "Move to…",
          icon: "folder",
          onPress: () => commands.handlers.moveTo?.(itemsOf(selected)),
        },
        {
          id: "trash",
          label: "Trash",
          icon: "trash",
          tone: "danger",
          onPress: commands.removeSelection,
        },
        more,
      ];
  const card = operationCardSize(props.width, {
    running: ops.state.running,
    notice: ops.notice,
    canUndo: ops.operations.canUndo,
  });
  // The bar and the card sit in the page's own room, left of a docked pane; over the scrim of
  // an undocked one they would be covered, so they keep the room left of it too.
  const room = props.properties ? props.width - props.dock.sheet : props.width;
  return (
    <>
      {props.selectionBar ? (
        <SelectionBar
          y={props.height - barHeight - px(EDGE)}
          width={room}
          maxWidth={Math.min(px(BAR_MAX), room - px(EDGE * 2))}
          count={selected.length}
          detail={`selected${bytes ? ` · ${formatBytes(bytes)}` : ""}`}
          actions={actions}
        />
      ) : null}
      {ops.state.running || ops.notice ? (
        <Box
          x={Math.max(px(EDGE), room - card.width - px(EDGE))}
          y={
            props.height -
            card.height -
            px(EDGE) -
            (props.selectionBar ? barHeight + px(BAR_PADDING) : 0)
          }
          width={card.width}
          height={card.height}
        >
          <OperationCard
            width={card.width}
            height={card.height}
            running={ops.state.running}
            notice={ops.notice}
            canUndo={ops.operations.canUndo}
            onCancel={ops.cancel}
            onUndo={() => void ops.undo()}
            onDismiss={ops.dismissNotice}
          />
        </Box>
      ) : null}
      {props.properties ? (
        <PropertiesSheet
          pageWidth={props.width}
          dock={props.dock}
          height={props.height}
          onClose={props.onCloseProperties}
        >
          {(size) => (
            <InspectorSheet
              {...size}
              entries={selected}
              cwd={props.cwd}
              trashDirectory={props.trashDirectory}
              refresh={props.revision}
              actions={props.inspector}
              viewport={{ width: props.windowWidth, height: props.windowHeight }}
              renameRequest={props.renameRequest}
            />
          )}
        </PropertiesSheet>
      ) : null}
    </>
  );
}
