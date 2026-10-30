/**
 * The workspace's commands: navigation, file operations, the context menus
 * and drag and drop, as one controller over the workspace's state.
 */
import fs from "node:fs";
import path from "node:path";
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  writeClipboardText,
  type HitKeyEvent,
  type HitPointerEvent,
  type NavigationRailItem,
  type SelectionModel,
} from "@moire/ui";
import {
  fileMenu,
  operationError,
  readFileClipboard,
  trashCount,
  writeFileClipboard,
  type FileMenuHandlers,
  type FileMenuItem,
  type FileMenuTarget,
  type TrashLocation,
  type TransferKind,
} from "@moire/file-operations";
import type { StorageVolume } from "@moire/system-management/storage-status";
import type { Entry, FilesPreferences } from "./filesystem";
import { countLabel } from "./format";
import { navigateFolderTab, openSpecialPage, travelFolderTab, type FolderTab } from "./navigation";
import { remainingCutPaths } from "./cut-clipboard";
import { pathsFromUriList } from "./uris";
import {
  DRIVES_UNAVAILABLE,
  canDriveAction,
  driveOperationBlocked,
  isWithinMount,
  storageVolumes,
} from "./removable-drives";
import { dropChangesSomething, dropIsValid } from "./model";
import { driveMenu, menuActions, pinnedMenu, placeMenu, trashPlaceMenu } from "./menus";
import type { FilePlace } from "./places";
import { RECENT_ITEM_ID, TRASH_ITEM_ID, driveItemId } from "./views/rail";
import type { FilesOperations } from "./use-operations";
import type { usePlaces } from "./use-places";
import type { useLauncher } from "./use-launcher";
import type { Overlay } from "./overlays";
import type { NamePrompt } from "./dialogs";
import type { ContextMenuRequest, WorkspaceProps } from "./workspace";

export const pathsOf = (items: readonly { path: string }[]) => items.map((item) => item.path);
export const itemsOf = (entries: readonly Entry[]): FileMenuItem[] =>
  entries.map((entry) => ({ path: entry.path, isDir: entry.isDir }));
/** Where a keyboard-opened menu sits inside the focused item. */
const KEYBOARD_MENU_INSET = 48;
/** The selection bar's menu opens above the bar. */
const SELECTION_MENU_INSET = 72;

export type WorkspaceContext = {
  props: WorkspaceProps;
  cwd: string;
  home: string;
  inTrash: boolean;
  trash: TrashLocation;
  entries: readonly Entry[];
  selectedEntries: readonly Entry[];
  selectedPaths: readonly string[];
  selection: SelectionModel<string>;
  ops: FilesOperations;
  places: ReturnType<typeof usePlaces>;
  launcher: ReturnType<typeof useLauncher>;
  preferences: FilesPreferences;
  changePreferences: (change: Partial<FilesPreferences>) => void;
  setOverlay: Dispatch<SetStateAction<Overlay | null>>;
  /** Show the Properties sheet for the selection, or the folder when nothing is selected. */
  showProperties: () => void;
  /** An item to select once it is listed. */
  pendingSelection: MutableRefObject<{ path: string; properties: boolean } | null>;
  /** Where a keyboard menu opens when no item is focused. */
  menuOrigin: { x: number; y: number };
  ui: number;
  notifyInfo: (message: string) => void;
  notifyError: (message: string) => void;
  refresh: () => void;
  updateTab: (change: (tab: FolderTab) => FolderTab) => void;
};

export function useWorkspaceCommands(context: WorkspaceContext) {
  const {
    props,
    cwd,
    home,
    inTrash,
    trash,
    entries,
    selectedEntries,
    selectedPaths,
    selection,
    ops,
    places,
    launcher,
    preferences,
    changePreferences,
    setOverlay,
    showProperties,
    pendingSelection,
    menuOrigin,
    ui,
    notifyInfo,
    notifyError,
    refresh,
    updateTab,
  } = context;
  // ── Navigation ────────────────────────────────────────────────────────────
  const navigateTo = useCallback(
    (directory: string) => {
      updateTab((tab) => navigateFolderTab(tab, directory));
      setOverlay(null);
    },
    [updateTab],
  );
  const travel = (offset: -1 | 1) => {
    updateTab((tab) => travelFolderTab(tab, offset));
    setOverlay(null);
  };
  const goUp = () => {
    const parent = path.dirname(cwd);
    if (!inTrash && parent !== cwd) navigateTo(parent);
  };
  const openRecent = () => {
    updateTab((tab) => openSpecialPage(tab, "recent", home));
    setOverlay(null);
  };
  const openTrash = () =>
    fs.promises
      .mkdir(trash.files, { recursive: true, mode: 0o700 })
      .then(() => navigateTo(trash.files))
      .catch((error) => notifyError(operationError(error)));
  const openWindow = (directory: string) =>
    props.onOpenWindow ? props.onOpenWindow(directory) : launcher.openExternally(directory);
  const openItems = (items: readonly FileMenuItem[]) => {
    if (inTrash) {
      notifyInfo("Restore items from Trash to open them.");
      return;
    }
    const [only] = items;
    if (items.length === 1 && only?.isDir) {
      navigateTo(only.path);
      return;
    }
    // Several items: folders open in tabs, files in their applications.
    for (const item of items) {
      if (item.isDir) props.onNewTab(item.path);
      else launcher.open(item.path);
    }
  };

  // ── Commands ──────────────────────────────────────────────────────────────
  const stash = (kind: "copy" | "cut", paths: readonly string[]) => {
    if (!paths.length) return;
    try {
      writeFileClipboard({ kind, paths });
      const verb = kind === "copy" ? "copy" : "move";
      notifyInfo(
        `${countLabel(paths.length)} ${kind === "copy" ? "copied" : "cut"}. Paste in a folder to ${verb} ${paths.length === 1 ? "it" : "them"}.`,
      );
    } catch (error) {
      notifyError(`Could not use the clipboard. ${operationError(error)}`);
    }
  };
  const paste = (directory = cwd) => {
    const clipboard = readFileClipboard();
    if (!clipboard) {
      notifyInfo("Nothing to paste. Cut or copy items first.");
      return;
    }
    const kind: TransferKind = clipboard.kind === "cut" ? "move" : "copy";
    void ops.transfer(kind, clipboard.paths, directory).then(async () => {
      if (kind !== "move") return;
      try {
        // Keep only what a skip or a stop left behind; a newer cut or copy owns the clipboard.
        const remaining = await remainingCutPaths(clipboard.paths);
        if (readFileClipboard()?.at === clipboard.at)
          writeFileClipboard(remaining.length ? { kind: "cut", paths: remaining } : null);
      } catch (error) {
        notifyError(`Could not refresh the remaining cut items. ${operationError(error)}`);
      }
    });
  };
  const confirmDelete = (paths: readonly string[]) => {
    if (!paths.length) return;
    const name = entries.find((entry) => entry.path === paths[0])?.name ?? path.basename(paths[0]!);
    setOverlay({
      kind: "confirm",
      value: {
        title:
          paths.length === 1
            ? `Permanently delete “${name}”?`
            : `Permanently delete ${countLabel(paths.length)}?`,
        message: "Deleted items cannot be restored from Trash. This cannot be undone.",
        confirmLabel: "Delete",
        run: () => void ops.deletePermanently(paths),
      },
    });
  };
  const confirmEmptyTrash = () =>
    void trashCount(trash).then((items) => {
      if (!items) notifyInfo("Trash is already empty.");
      else
        setOverlay({
          kind: "confirm",
          value: {
            title: "Empty Trash?",
            message: `All ${countLabel(items)} in Trash will be permanently deleted. This cannot be undone.`,
            confirmLabel: "Empty Trash",
            run: () => void ops.emptyTrash(),
          },
        });
    });
  const beginName = (kind: NamePrompt["kind"], directory = cwd, source?: string) => {
    if (ops.busy) return;
    const draft = source
      ? (entries.find((entry) => entry.path === source)?.name ?? path.basename(source))
      : kind === "folder"
        ? "New Folder"
        : "Untitled.txt";
    setOverlay({ kind: "name", prompt: { kind, directory, source }, draft, error: null });
  };
  const submitName = async (prompt: NamePrompt, name: string) => {
    if (ops.busy) return;
    const result =
      prompt.kind === "rename" && prompt.source
        ? await ops.rename(prompt.source, name)
        : await ops.create(prompt.kind === "folder" ? "folder" : "file", prompt.directory, name);
    if (result.ok) {
      setOverlay(null);
      pendingSelection.current = { path: result.value, properties: false };
    } else if (!result.cancelled)
      setOverlay({ kind: "name", prompt, draft: name, error: operationError(result.error) });
  };
  const pinFolder = (directory = cwd) => {
    if (directory === trash.files || places.isPinned(directory)) return;
    places.pin(directory);
    notifyInfo(`“${path.basename(directory) || directory}” added to the sidebar`);
  };
  const removeSelection = () =>
    inTrash ? confirmDelete(selectedPaths) : void ops.trash(selectedPaths);

  // ── Menus ─────────────────────────────────────────────────────────────────
  const handlers: FileMenuHandlers = {
    open: openItems,
    openWithApplications: (item) => launcher.applicationsFor(item.path),
    openWith: (item, id) => launcher.openWith(item.path, id),
    chooseApplication: (item) => launcher.chooseApplication(item.path),
    openInNewTab: (directory) => props.onNewTab(directory),
    openInNewWindow: openWindow,
    openInTerminal: launcher.openTerminal,
    showInFiles: (items) => {
      const first = items[0];
      if (!first) return;
      navigateTo(path.dirname(first.path));
      pendingSelection.current = { path: first.path, properties: false };
    },
    cut: (items) => stash("cut", pathsOf(items)),
    copy: (items) => stash("copy", pathsOf(items)),
    paste,
    copyTo: (items) =>
      setOverlay({ kind: "destination", transfer: "copy", paths: pathsOf(items), draft: cwd }),
    moveTo: (items) =>
      setOverlay({ kind: "destination", transfer: "move", paths: pathsOf(items), draft: cwd }),
    duplicate: (items) => void ops.duplicate(pathsOf(items)),
    rename: (item) => beginName("rename", cwd, item.path),
    compress: (items) => void ops.compress(pathsOf(items)),
    copyPath: (items) =>
      void writeClipboardText(pathsOf(items).join("\n")).then(
        () =>
          notifyInfo(
            items.length === 1 ? "Path copied" : `${countLabel(items.length, "path")} copied`,
          ),
        (error) => notifyError(`Could not copy the path. ${operationError(error)}`),
      ),
    properties: showProperties,
    trash: (items) => void ops.trash(pathsOf(items)),
    deletePermanently: (items) => confirmDelete(pathsOf(items)),
    restore: (items) => void ops.restore(pathsOf(items)),
    emptyTrash: confirmEmptyTrash,
    newFolder: (directory) => beginName("folder", directory),
    newDocument: (directory) => beginName("file", directory),
    selectAll: () => selection.selectAll(),
    sortBy: (field, descending) => changePreferences({ sort: field, descending }),
    setView: (view) => changePreferences({ view }),
    toggleHidden: () => changePreferences({ hidden: !preferences.hidden }),
    undo: () => void ops.undo(),
    refresh,
  };
  const showMenu = (request: ContextMenuRequest) => {
    if (!props.onShowContextMenu?.(request)) setOverlay({ kind: "menu", request });
  };
  const menuFor = (target: FileMenuTarget) =>
    menuActions(
      fileMenu(
        target,
        {
          directory: cwd,
          inTrash,
          busy: ops.busy,
          // Read when the menu opens: another window or the desktop may have cut or copied.
          clipboard: readFileClipboard(),
          undoLabel: ops.operations.undoLabel,
          itemCount: entries.length,
          sort: { field: preferences.sort, descending: preferences.descending },
          view: preferences.view,
          hiddenShown: preferences.hidden,
        },
        handlers,
      ),
    );
  const itemTargets = (entry: Entry) =>
    selection.isSelected(entry.path) ? selectedEntries : [entry];
  const itemTitle = (targets: readonly Entry[]) =>
    targets.length > 1 ? `${targets.length} Items` : (targets[0]?.name ?? "");
  const showItemMenu = (entry: Entry, at: { x: number; y: number }) => {
    if (!selection.isSelected(entry.path)) selection.select(entry.path);
    const targets = itemTargets(entry);
    showMenu({
      ...at,
      title: itemTitle(targets),
      actions: menuFor({ kind: "items", items: itemsOf(targets) }),
    });
  };
  const showFolderMenu = (at: { x: number; y: number }) => {
    const pinned = places.isPinned(cwd);
    showMenu({
      ...at,
      title: inTrash ? "Trash" : path.basename(cwd) || cwd,
      actions: [
        ...menuFor({ kind: "folder", directory: cwd }),
        ...(inTrash
          ? []
          : [
              {
                id: "pin-folder",
                label: "Add to Sidebar",
                shortcut: "Ctrl+D",
                separatorBefore: true,
                disabled: pinned,
                disabledReason: pinned ? "This folder is already in the sidebar" : undefined,
                onPress: () => pinFolder(),
              },
            ]),
      ],
    });
  };
  /** The selection bar's ⋯: the same menu as a right-click on the selection. */
  const showSelectionMenu = () =>
    showMenu({
      x: props.width / 2,
      y: props.height - SELECTION_MENU_INSET * ui,
      title: itemTitle(selectedEntries),
      actions: menuFor({ kind: "items", items: itemsOf(selectedEntries) }),
    });
  /** The Menu key and Shift+F10 open the menu beside the focused item, or for the folder. */
  const showKeyboardMenu = (event: HitKeyEvent) => {
    const bounds = event.targetBounds;
    const at = bounds
      ? {
          x: bounds.x + Math.min(bounds.width - 8, KEYBOARD_MENU_INSET * ui),
          y: bounds.y + bounds.height / 2,
        }
      : menuOrigin;
    const target =
      entries.find(
        (entry) => entry.path === selection.focusKey && selection.isSelected(entry.path),
      ) ?? selectedEntries[0];
    if (target) showItemMenu(target, at);
    else showFolderMenu(at);
  };

  // ── Drives ────────────────────────────────────────────────────────────────
  const driveState = props.drives?.state ?? DRIVES_UNAVAILABLE;
  const volumes = storageVolumes(driveState);
  const activeDrive = volumes.find(
    (volume) =>
      volume.mount.kind === "mounted" &&
      volume.mount.paths.some((root) => isWithinMount(cwd, root)),
  );
  const driveRequest = (volume: StorageVolume) =>
    driveState.kind === "ready"
      ? { owner: driveState.owner, revision: driveState.snapshot.revision, id: volume.id }
      : undefined;
  const activateDrive = (volume: StorageVolume) => {
    if (!props.driveBusy)
      void props.drives?.activate(
        volume.id,
        { tabId: props.tab.id, navigation: props.tab.navigation },
        driveRequest(volume),
      );
  };
  const showDriveMenu = (volume: StorageVolume, at: { x: number; y: number }) => {
    const expected = driveRequest(volume);
    showMenu({
      ...at,
      title: volume.label,
      actions: driveMenu(
        {
          label: volume.label,
          mounted: volume.mount.kind === "mounted",
          openBlocked:
            props.driveBusy ||
            driveOperationBlocked(driveState, volume.id) ||
            volume.mount.kind === "unsupported" ||
            (volume.mount.kind !== "mounted" && !canDriveAction(driveState, volume.id, "mount")),
          canUnmount: !props.driveBusy && canDriveAction(driveState, volume.id, "unmount"),
          canEject: !props.driveBusy && canDriveAction(driveState, volume.id, "eject"),
        },
        {
          open: () => activateDrive(volume),
          unmount: () =>
            expected && void props.drives?.action(volume.id, "unmount", false, expected),
          eject: () => expected && void props.drives?.action(volume.id, "eject", false, expected),
          refresh: () => void props.drives?.refresh(),
        },
      ),
    });
  };
  const ejectDrive = (volume: StorageVolume) => {
    const expected = driveRequest(volume);
    if (expected) void props.drives?.action(volume.id, "eject", false, expected);
  };
  useEffect(() => {
    setOverlay((current) => (current?.kind === "menu" ? null : current));
    if (props.drives?.error) notifyError(props.drives.error);
  }, [props.driveRevision, props.drives, notifyError]);

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<readonly string[]>([]);
  const dropInto = (payload: unknown, directory: string) => {
    const paths = pathsFromUriList(payload);
    setDragging([]);
    // Dropping items where they already are changes nothing, and says nothing.
    if (!paths.length || !dropChangesSomething(paths, directory)) return;
    if (!dropIsValid(paths, directory)) notifyInfo("A folder cannot be moved into itself.");
    else if (directory === trash.files) void ops.trash(paths);
    else void ops.transfer("move", paths, directory);
  };
  /** A folder accepts a drop unless this window's own drag would land on itself or nowhere new. */
  const folderDropTarget = (entry: Entry) =>
    entry.isDir &&
    !inTrash &&
    (!dragging.length ||
      (dropChangesSomething(dragging, entry.path) && dropIsValid(dragging, entry.path)))
      ? entry.path
      : undefined;

  // ── Rail ──────────────────────────────────────────────────────────────────
  const selectRailItem = (item: NavigationRailItem) => {
    if (item.id === TRASH_ITEM_ID) void openTrash();
    else if (item.id === RECENT_ITEM_ID) openRecent();
    else {
      const volume = volumes.find((candidate) => driveItemId(candidate) === item.id);
      if (volume) activateDrive(volume);
      const place = places.places.find((candidate) => candidate.id === item.id);
      if (place) navigateTo(place.path);
    }
  };
  const placeHandlers = {
    open: (place: FilePlace) => navigateTo(place.path),
    openInNewTab: (directory: string) => props.onNewTab(directory),
    openInNewWindow: openWindow,
    rename: (place: FilePlace) =>
      setOverlay({ kind: "place-name", place, draft: place.label, error: null }),
    remove: (place: FilePlace) => places.remove(place.id),
    move: (place: FilePlace, direction: -1 | 1) => places.move(place.id, direction),
    properties: (directory: string) => {
      navigateTo(directory);
      showProperties();
    },
  };
  const showRailMenu = (item: NavigationRailItem, event: HitPointerEvent) => {
    const at = { x: event.x, y: event.y };
    if (item.id === TRASH_ITEM_ID) {
      void trashCount(trash).then((items) =>
        showMenu({
          ...at,
          title: "Trash",
          actions: trashPlaceMenu(items, ops.busy, {
            open: () => void openTrash(),
            openInNewTab: () => props.onNewTab(trash.files),
            empty: confirmEmptyTrash,
          }),
        }),
      );
      return;
    }
    const volume = volumes.find((candidate) => driveItemId(candidate) === item.id);
    if (volume) {
      showDriveMenu(volume, at);
      return;
    }
    const place = places.places.find((candidate) => candidate.id === item.id);
    if (!place) return;
    showMenu({
      ...at,
      title: place.label,
      actions: placeMenu(place, places.moves(place.id), placeHandlers),
    });
  };
  const showPinnedMenu = (place: FilePlace, at: { x: number; y: number }) =>
    showMenu({
      ...at,
      title: place.label,
      actions: pinnedMenu(place, { ...placeHandlers, unpin: (target) => places.unpin(target.id) }),
    });

  return {
    navigateTo,
    travel,
    goUp,
    openTrash,
    openItems,
    stash,
    paste,
    confirmDelete,
    beginName,
    submitName,
    pinFolder,
    removeSelection,
    handlers,
    showMenu,
    menuFor,
    itemTargets,
    itemTitle,
    showItemMenu,
    showFolderMenu,
    showKeyboardMenu,
    driveState,
    volumes,
    activeDrive,
    activateDrive,
    showDriveMenu,
    setDragging,
    dropInto,
    folderDropTarget,
    selectRailItem,
    showRailMenu,
    showPinnedMenu,
    openRecent,
    ejectDrive,
    showSelectionMenu,
    menuOrigin,
  };
}
