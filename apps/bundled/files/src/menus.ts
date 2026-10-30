/** Files' menus: the shared file menu, plus places, Trash, tabs, drives, the window and sorting. */
import { ICON_NAMES, type ContextMenuAction, type IconName } from "@moire/ui";
import { FILE_SHORTCUTS, type FileMenuEntry } from "@moire/file-operations";
import type { SortField } from "./filesystem";
import type { FilePlace } from "./places";

const KNOWN_ICONS: ReadonlySet<string> = new Set(ICON_NAMES);

/** The shared menu model as widget actions. */
export function menuActions(entries: readonly FileMenuEntry[]): ContextMenuAction[] {
  return entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    icon: entry.icon && KNOWN_ICONS.has(entry.icon) ? (entry.icon as IconName) : undefined,
    danger: entry.danger,
    disabled: entry.disabled ?? false,
    disabledReason: entry.disabledReason,
    shortcut: entry.shortcut,
    checked: entry.checked,
    separatorBefore: entry.separatorBefore,
    submenu: entry.submenu ? menuActions(entry.submenu) : undefined,
    onPress: entry.onPress,
  }));
}

export type PlaceMenuHandlers = {
  open(place: FilePlace): void;
  openInNewTab(directory: string): void;
  openInNewWindow(directory: string): void;
  rename(place: FilePlace): void;
  remove(place: FilePlace): void;
  move(place: FilePlace, direction: -1 | 1): void;
  properties(directory: string): void;
};

const BUILT_IN_REASON = "Built-in places cannot be renamed or removed";

/** A place on the rail: where it goes, plus managing the user's own places. */
export function placeMenu(
  place: FilePlace,
  moves: { up: boolean; down: boolean },
  handlers: PlaceMenuHandlers,
): ContextMenuAction[] {
  const custom = !place.builtIn;
  const reason = custom ? undefined : BUILT_IN_REASON;
  return [
    { id: "open", label: "Open", icon: "folder", onPress: () => handlers.open(place) },
    {
      id: "open-new-tab",
      label: "Open in New Tab",
      onPress: () => handlers.openInNewTab(place.path),
    },
    {
      id: "open-new-window",
      label: "Open in New Window",
      onPress: () => handlers.openInNewWindow(place.path),
    },
    {
      id: "rename-place",
      label: "Rename…",
      separatorBefore: true,
      disabled: !custom,
      disabledReason: reason,
      onPress: () => handlers.rename(place),
    },
    {
      id: "move-place-up",
      label: "Move Up",
      disabled: !moves.up,
      disabledReason: custom ? (moves.up ? undefined : "This is the first of your places") : reason,
      onPress: () => handlers.move(place, -1),
    },
    {
      id: "move-place-down",
      label: "Move Down",
      disabled: !moves.down,
      disabledReason: custom
        ? moves.down
          ? undefined
          : "This is the last of your places"
        : reason,
      onPress: () => handlers.move(place, 1),
    },
    {
      id: "remove-place",
      label: "Remove from Sidebar",
      icon: "remove",
      disabled: !custom,
      disabledReason: reason,
      onPress: () => handlers.remove(place),
    },
    {
      id: "properties",
      label: "Properties",
      shortcut: FILE_SHORTCUTS.properties,
      separatorBefore: true,
      onPress: () => handlers.properties(place.path),
    },
  ];
}

/** A pinned folder's ⋯ on Home. */
export function pinnedMenu(
  place: FilePlace,
  handlers: Pick<PlaceMenuHandlers, "openInNewTab" | "properties"> & {
    unpin(place: FilePlace): void;
  },
): ContextMenuAction[] {
  return [
    {
      id: "open-new-tab",
      label: "Open in New Tab",
      onPress: () => handlers.openInNewTab(place.path),
    },
    { id: "unpin", label: "Unpin", icon: "remove", onPress: () => handlers.unpin(place) },
    {
      id: "properties",
      label: "Properties",
      shortcut: FILE_SHORTCUTS.properties,
      separatorBefore: true,
      onPress: () => handlers.properties(place.path),
    },
  ];
}

/** The top bar's ⋯: window-wide commands. */
export function windowMenu(
  state: { hiddenShown: boolean; busy: boolean },
  handlers: { newTab(): void; newWindow(): void; toggleHidden(): void; shortcuts(): void },
): ContextMenuAction[] {
  return [
    {
      id: "new-tab",
      label: "New Tab",
      shortcut: "Ctrl+T",
      icon: "plus",
      disabled: state.busy,
      disabledReason: state.busy ? "Wait for the current operation to finish" : undefined,
      onPress: handlers.newTab,
    },
    { id: "new-window", label: "New Window", shortcut: "Ctrl+N", onPress: handlers.newWindow },
    {
      id: "hidden",
      label: "Show Hidden Files",
      shortcut: FILE_SHORTCUTS.hidden,
      checked: state.hiddenShown,
      separatorBefore: true,
      onPress: handlers.toggleHidden,
    },
    {
      id: "keyboard-shortcuts",
      label: "Keyboard Shortcuts",
      shortcut: "Ctrl+?",
      separatorBefore: true,
      onPress: handlers.shortcuts,
    },
  ];
}

export const SORT_LABELS: Readonly<Record<SortField, string>> = {
  name: "Name",
  size: "Size",
  modified: "Modified",
  type: "Kind",
};

/** The title row's sort button: a field, then Reverse. */
export function sortMenu(
  sort: { field: SortField; descending: boolean },
  onSort: (field: SortField, descending: boolean) => void,
): ContextMenuAction[] {
  return [
    ...(Object.keys(SORT_LABELS) as SortField[]).map((field) => ({
      id: `sort-${field}`,
      label: SORT_LABELS[field],
      checked: sort.field === field,
      onPress: () => onSort(field, sort.field === field ? sort.descending : field === "modified"),
    })),
    {
      id: "sort-reverse",
      label: "Reverse Order",
      checked: sort.descending,
      separatorBefore: true,
      onPress: () => onSort(sort.field, !sort.descending),
    },
  ];
}

/** The Trash place: open it, or empty it without opening it first. */
export function trashPlaceMenu(
  trashCount: number,
  busy: boolean,
  handlers: { open(): void; openInNewTab(): void; empty(): void },
): ContextMenuAction[] {
  return [
    { id: "open", label: "Open", icon: "trash", onPress: handlers.open },
    { id: "open-new-tab", label: "Open in New Tab", onPress: handlers.openInNewTab },
    {
      id: "empty-trash",
      label: "Empty Trash…",
      danger: true,
      separatorBefore: true,
      disabled: busy || trashCount === 0,
      disabledReason: busy
        ? "Wait for the current operation to finish"
        : trashCount === 0
          ? "Trash is already empty"
          : undefined,
      onPress: handlers.empty,
    },
  ];
}

/** A folder tab. */
export function tabMenu(
  index: number,
  tabCount: number,
  handlers: {
    newTab(): void;
    duplicate(index: number): void;
    move(index: number, offset: -1 | 1): void;
    close(index: number): void;
    closeOthers(index: number): void;
  },
): ContextMenuAction[] {
  return [
    { id: "new-tab", label: "New Tab", shortcut: "Ctrl+T", icon: "plus", onPress: handlers.newTab },
    { id: "duplicate-tab", label: "Duplicate Tab", onPress: () => handlers.duplicate(index) },
    {
      id: "move-tab-left",
      label: "Move Tab Left",
      separatorBefore: true,
      disabled: index === 0,
      disabledReason: index === 0 ? "This is the first tab" : undefined,
      onPress: () => handlers.move(index, -1),
    },
    {
      id: "move-tab-right",
      label: "Move Tab Right",
      disabled: index === tabCount - 1,
      disabledReason: index === tabCount - 1 ? "This is the last tab" : undefined,
      onPress: () => handlers.move(index, 1),
    },
    {
      id: "close-other-tabs",
      label: "Close Other Tabs",
      separatorBefore: true,
      disabled: tabCount === 1,
      disabledReason: tabCount === 1 ? "There are no other tabs" : undefined,
      onPress: () => handlers.closeOthers(index),
    },
    {
      id: "close-tab",
      label: "Close Tab",
      shortcut: "Ctrl+W",
      icon: "close",
      onPress: () => handlers.close(index),
    },
  ];
}

export type DriveMenuState = {
  label: string;
  mounted: boolean;
  /** Why opening is impossible right now, or null. */
  openBlocked: boolean;
  canUnmount: boolean;
  canEject: boolean;
};

/** A removable drive: open (mounting first), unmount, eject. */
export function driveMenu(
  drive: DriveMenuState,
  handlers: { open(): void; unmount(): void; eject(): void; refresh(): void },
): ContextMenuAction[] {
  return [
    {
      id: "drive-open",
      label: drive.mounted ? "Open drive" : "Mount and open",
      disabled: drive.openBlocked,
      onPress: handlers.open,
    },
    {
      id: "drive-unmount",
      label: "Unmount",
      disabled: !drive.canUnmount,
      onPress: handlers.unmount,
    },
    { id: "drive-eject", label: "Eject", disabled: !drive.canEject, onPress: handlers.eject },
    {
      id: "drive-refresh",
      label: "Refresh drive status",
      separatorBefore: true,
      onPress: handlers.refresh,
    },
  ];
}
