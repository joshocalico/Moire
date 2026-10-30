/**
 * How an item on a page behaves: focus and selection, drag and drop, opening, its menu and
 * keys, the actions its row offers on hover, and the lines it is described by.
 */
import path from "node:path";
import type { HoverAction, SelectionModel } from "@moire/ui";
import type { Entry } from "./filesystem";
import { formatDay, tidyPath } from "./format";
import { entryCaption, entryKind, kindIcon } from "./kind-style";
import { entryFocusId } from "./model";
import { pathsToUriList } from "./uris";
import { itemsOf, pathsOf, type useWorkspaceCommands } from "./use-commands";
import type { FilesOperations } from "./use-operations";
import { handleCollectionKey, type CollectionShape } from "./collection-keys";
import type { ItemInteraction } from "./views/file-row";

export function itemBehaviour(context: {
  home: string;
  inTrash: boolean;
  entryKeys: readonly string[];
  selection: SelectionModel<string>;
  /** Items may take keyboard focus: no text field is being edited. */
  focusEntries: boolean;
  ops: FilesOperations;
  commands: ReturnType<typeof useWorkspaceCommands>;
  preview(key: string): void;
  /** Pressing an item closes an in-window menu. */
  closeOverlay(): void;
}) {
  const { home, inTrash, selection, ops, commands } = context;
  const focusKey = selection.focusKey ?? context.entryKeys[0] ?? null;
  const dragSource = (entry: Entry) => {
    const items = commands.itemTargets(entry);
    return {
      mimeTypes: ["text/uri-list"],
      getPayload: () => {
        commands.setDragging(pathsOf(items));
        return pathsToUriList(items.map((item) => item.path));
      },
      label: items.length > 1 ? `${items.length} items` : entry.name,
      previewIcon: { name: kindIcon(entryKind(entry)) },
      onDragEnd: () => commands.setDragging([]),
    };
  };
  const interaction = (entry: Entry, shape: CollectionShape): ItemInteraction => ({
    focusId: entryFocusId(entry.path),
    autoFocus: context.focusEntries && focusKey === entry.path,
    onFocusChange: (focused) => {
      if (focused) selection.focus(entry.path, false);
    },
    dragSource: inTrash ? undefined : dragSource(entry),
    dropData: commands.folderDropTarget(entry),
    onPress: (event) => {
      selection.select(entry.path, {
        toggle: event?.ctrlKey || event?.metaKey,
        range: event?.shiftKey,
      });
      context.closeOverlay();
    },
    onDoublePress: () => commands.openItems(itemsOf([entry])),
    onContextMenu: (event) => commands.showItemMenu(entry, { x: event.x, y: event.y }),
    onKeyDown: (event) =>
      handleCollectionKey(event, entry.path, { selection, shape, onPreview: context.preview }),
  });
  /** A row's hover actions; Trash restores or deletes, other places open, copy and trash. */
  const rowActions = (entry: Entry): HoverAction[] =>
    (inTrash
      ? ([
          {
            id: "restore",
            label: "Restore",
            icon: "restart",
            onPress: () => void ops.restore([entry.path]),
          },
          {
            id: "delete",
            label: "Delete Permanently",
            icon: "trash",
            tone: "danger",
            onPress: () => commands.confirmDelete([entry.path]),
          },
        ] satisfies HoverAction[])
      : ([
          {
            id: "open",
            label: "Open",
            icon: "forward",
            onPress: () => commands.openItems(itemsOf([entry])),
          },
          {
            id: "copy",
            label: "Copy",
            icon: "copy",
            onPress: () => commands.stash("copy", [entry.path]),
          },
          {
            id: "trash",
            label: "Move to Trash",
            icon: "trash",
            tone: "danger",
            onPress: () => void ops.trash([entry.path]),
          },
          {
            id: "more",
            label: "More actions",
            icon: "more",
            onPress: (event) =>
              commands.showItemMenu(
                entry,
                event ? { x: event.x, y: event.y } : commands.menuOrigin,
              ),
          },
        ] satisfies HoverAction[])
    ).map((action): HoverAction => ({ ...action, focusId: `action:${action.id}:${entry.path}` }));
  /** The line under the name: kind and size, or where a Trash item came from. */
  const caption = (entry: Entry, now: number) => {
    if (inTrash) {
      const origin = entry.trash?.originalPath;
      return origin ? `From ${tidyPath(path.dirname(origin), home)}` : "Original location unknown";
    }
    return entry.isDir ? `Folder · ${formatDay(entry.modified, now)}` : entryCaption(entry);
  };
  /** The row's end: when it changed, or when it was deleted. */
  const trailing = (entry: Entry, now: number) =>
    inTrash
      ? entry.trash?.deletedAt
        ? `Deleted ${formatDay(entry.trash.deletedAt, now)}`
        : "Deleted"
      : formatDay(entry.modified, now);
  return { interaction, rowActions, caption, trailing };
}
