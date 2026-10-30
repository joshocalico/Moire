/**
 * A tab's keyboard: the shortcut table, and the keys no shortcut took. Escape leaves search or
 * closes Properties; typing on a page starts a search with what was typed (Ctrl, Alt and Meta
 * keys never do). Text fields, the preview and dialogs keep their keys.
 */
import type { HitKeyEvent } from "@moire/ui";
import type { Overlay } from "./overlays";
import { filesShortcuts } from "./shortcuts";
import { railItemIds } from "./views/rail";
import type { FilePlace } from "./places";
import type { FilesPreferences } from "./filesystem";
import type { useFilesOperations } from "./use-operations";
import type { useSheets } from "./use-sheets";
import type { useWorkspaceCommands } from "./use-commands";
import type { usePageSearch } from "./search/use-page-search";
import type { useSearchField } from "./search/use-search-field";
import type { WorkspaceProps } from "./workspace";

export function useWorkspaceKeyboard(options: {
  props: WorkspaceProps;
  cwd: string;
  inTrash: boolean;
  entryCount: number;
  selectedPaths: readonly string[];
  selection: { selectAll(): void };
  ops: ReturnType<typeof useFilesOperations>;
  sheets: ReturnType<typeof useSheets>;
  commands: ReturnType<typeof useWorkspaceCommands>;
  search: ReturnType<typeof usePageSearch>;
  field: ReturnType<typeof useSearchField>;
  places: readonly FilePlace[];
  preferences: FilesPreferences;
  changePreferences(change: Partial<FilesPreferences>): void;
  overlay: Overlay | null;
  setOverlay(overlay: Overlay | null): void;
  pathEditing: boolean;
  setPathEditing(editing: boolean): void;
  refresh(): void;
}) {
  const { props, ops, sheets, commands, search, field, overlay, preferences } = options;
  const editingText =
    field.focused ||
    options.pathEditing ||
    sheets.tagFocused ||
    sheets.previewKey !== null ||
    (overlay !== null && overlay.kind !== "menu");
  const railIds = railItemIds(options.places);
  const shortcuts = filesShortcuts(
    {
      editingText,
      busy: ops.busy,
      inTrash: options.inTrash,
      hasEntries: options.entryCount > 0,
      selectionCount: options.selectedPaths.length,
      canUndo: ops.operations.canUndo,
    },
    {
      newTab: () => props.onNewTab(),
      closeTab: props.onCloseTab,
      changeTab: props.onChangeTab,
      // The path line belongs to the folder page; asking for it leaves search.
      focusLocation: () => {
        if (search.active) field.leave(null);
        options.setPathEditing(true);
      },
      focusSearch: field.focus,
      contextMenu: commands.showKeyboardMenu,
      refresh: options.refresh,
      selectAll: () => options.selection.selectAll(),
      toggleHidden: () => options.changePreferences({ hidden: !preferences.hidden }),
      newFolder: () => commands.beginName("folder"),
      copy: () => commands.stash("copy", options.selectedPaths),
      cut: () => commands.stash("cut", options.selectedPaths),
      paste: () => commands.paste(),
      undo: () => void ops.undo(),
      properties: sheets.showProperties,
      pinFolder: () => commands.pinFolder(),
      // With Properties open the name is edited in place, in the pane.
      rename: () =>
        sheets.propertiesOpen
          ? sheets.requestRename()
          : commands.beginName("rename", options.cwd, options.selectedPaths[0]),
      remove: commands.removeSelection,
      deletePermanently: () => commands.confirmDelete(options.selectedPaths),
      back: () => commands.travel(-1),
      forward: () => commands.travel(1),
      up: commands.goUp,
      setView: (view) => options.changePreferences({ view }),
      toggleRail: () => options.changePreferences({ railExpanded: !preferences.railExpanded }),
      railItem: (index) => {
        const id = railIds[index];
        if (id) commands.selectRailItem({ id, label: id, icon: "folder" });
      },
      newWindow: () => commands.handlers.openInNewWindow?.(options.cwd),
      showShortcuts: () => options.setOverlay({ kind: "shortcuts" }),
    },
  );
  const pageKey = (event: HitKeyEvent): boolean => {
    if ((event.key === "Escape" || event.code === 1) && overlay === null && !event.repeat) {
      // In the field, Escape first closes its completions; the field leaves search itself.
      if (field.focused) return false;
      if (search.active) {
        field.leave(search.highlightedHit);
        return true;
      }
      if (sheets.propertiesOpen && !editingText) {
        sheets.close();
        return true;
      }
      return false;
    }
    if (editingText || event.ctrlKey || event.altKey || event.metaKey) return false;
    const text = event.text ?? (event.key?.length === 1 ? event.key : undefined);
    if (!text || text.length !== 1 || !text.trim()) return false;
    field.setQuery(props.tab.query + text);
    field.focus();
    return true;
  };
  return { editingText, shortcuts, pageKey };
}
