/**
 * The standard file context menu, shared by Files and the desktop so both
 * offer the same actions, in the same order, with the same shortcuts and the
 * same reasons when something is unavailable.
 *
 * An action appears only when the surface supplies its handler (a capability:
 * the desktop has no tabs). State that blocks an action disables it with a
 * reason instead of hiding it, so the menu never changes shape under the user.
 */
import path from "node:path";
import type { FileClipboard } from "./clipboard";

export type FileMenuEntry = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  shortcut?: string;
  checked?: boolean;
  separatorBefore?: boolean;
  submenu?: FileMenuEntry[];
  onPress?: () => void;
};

export type FileMenuItem = { readonly path: string; readonly isDir: boolean };

export type FileMenuTarget =
  | { readonly kind: "items"; readonly items: readonly FileMenuItem[] }
  | { readonly kind: "folder"; readonly directory: string };

export type FileSortField = "name" | "modified" | "size" | "type";
export type FileView = "grid" | "list" | "columns";

export type FileMenuState = {
  /** The folder the menu belongs to: the view's folder, or the desktop folder. */
  readonly directory: string;
  /** The folder is Trash, so items are Trash entries. */
  readonly inTrash: boolean;
  /** An operation is running; mutating actions wait for it. */
  readonly busy: boolean;
  readonly clipboard: FileClipboard | null;
  readonly undoLabel: string | null;
  /** Items in the view, for Select All. */
  readonly itemCount: number;
  readonly trashCount?: number;
  readonly sort?: {
    readonly field: FileSortField;
    readonly descending: boolean;
  };
  readonly view?: FileView;
  readonly hiddenShown?: boolean;
  readonly previewShown?: boolean;
};

export type OpenWithApplication = {
  readonly id: string;
  readonly name: string;
};

export type FileMenuHandlers = {
  open(items: readonly FileMenuItem[]): void;
  /** Recommended applications for a file, for the Open With submenu. */
  openWithApplications?(item: FileMenuItem): readonly OpenWithApplication[];
  openWith?(item: FileMenuItem, applicationId: string): void;
  /** The full application chooser. */
  chooseApplication?(item: FileMenuItem): void;
  openInNewTab?(directory: string): void;
  openInNewWindow?(directory: string): void;
  /** Present only when a terminal emulator is installed. */
  openInTerminal?(directory: string): void;
  /** Reveal items in a Files window (from the desktop) or in their own folder (from a search). */
  showInFiles?(items: readonly FileMenuItem[]): void;
  cut(items: readonly FileMenuItem[]): void;
  copy(items: readonly FileMenuItem[]): void;
  paste(directory: string): void;
  copyTo?(items: readonly FileMenuItem[]): void;
  moveTo?(items: readonly FileMenuItem[]): void;
  duplicate(items: readonly FileMenuItem[]): void;
  rename(item: FileMenuItem): void;
  compress(items: readonly FileMenuItem[]): void;
  copyPath(items: readonly FileMenuItem[]): void;
  properties(items: readonly FileMenuItem[] | null): void;
  trash(items: readonly FileMenuItem[]): void;
  deletePermanently(items: readonly FileMenuItem[]): void;
  restore(items: readonly FileMenuItem[]): void;
  emptyTrash(): void;
  newFolder(directory: string): void;
  newDocument?(directory: string): void;
  selectAll(): void;
  sortBy?(field: FileSortField, descending: boolean): void;
  setView?(view: FileView): void;
  toggleHidden?(): void;
  togglePreview?(): void;
  /** Desktop: snap icons back onto the grid in sort order. */
  arrange?(): void;
  undo(): void;
  refresh?(): void;
  /** Desktop: open the Desktop folder in Files. */
  openFolderInFiles?(): void;
  changeBackground?(): void;
  displaySettings?(): void;
};

export const FILE_SHORTCUTS = {
  open: "Enter",
  cut: "Ctrl+X",
  copy: "Ctrl+C",
  paste: "Ctrl+V",
  rename: "F2",
  properties: "Ctrl+I",
  trash: "Delete",
  deletePermanently: "Shift+Delete",
  newFolder: "Ctrl+Shift+N",
  selectAll: "Ctrl+A",
  hidden: "Ctrl+H",
  undo: "Ctrl+Z",
  refresh: "F5",
} as const;

const BUSY = "Wait for the current operation to finish";
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;

/** Separate groups; empty groups vanish without leaving doubled separators. */
function groups(
  ...sections: Array<Array<FileMenuEntry | null | false | undefined>>
): FileMenuEntry[] {
  const entries: FileMenuEntry[] = [];
  for (const section of sections) {
    const present = section.filter((entry): entry is FileMenuEntry => !!entry);
    present.forEach((entry, index) =>
      entries.push(index === 0 && entries.length ? { ...entry, separatorBefore: true } : entry),
    );
  }
  return entries;
}

function blocked(
  busy: boolean,
  reason?: string | null,
): Pick<FileMenuEntry, "disabled" | "disabledReason"> {
  const why = busy ? BUSY : reason;
  return why ? { disabled: true, disabledReason: why } : {};
}

function pasteReason(state: FileMenuState): string | null {
  return state.clipboard ? null : "Cut or copy items first";
}

function itemMenu(
  items: readonly FileMenuItem[],
  state: FileMenuState,
  handlers: FileMenuHandlers,
): FileMenuEntry[] {
  const single = items.length === 1 ? items[0]! : null;
  const folder = single?.isDir ? single : null;
  const many = items.length > 1;
  const noun = many ? count(items.length, "item") : null;
  if (state.inTrash)
    return groups(
      [
        {
          id: "restore",
          label: many ? `Restore ${noun}` : "Restore",
          ...blocked(state.busy),
          onPress: () => handlers.restore(items),
        },
      ],
      [
        {
          id: "properties",
          label: "Properties",
          shortcut: FILE_SHORTCUTS.properties,
          onPress: () => handlers.properties(items),
        },
      ],
      [
        {
          id: "delete",
          label: "Delete Permanently…",
          shortcut: FILE_SHORTCUTS.trash,
          icon: "trash",
          danger: true,
          ...blocked(state.busy),
          onPress: () => handlers.deletePermanently(items),
        },
      ],
    );

  const applications =
    single && !single.isDir ? (handlers.openWithApplications?.(single) ?? []) : [];
  const openWith: FileMenuEntry | null =
    handlers.openWith || handlers.chooseApplication
      ? folder
        ? null
        : {
            id: "open-with",
            label: "Open With",
            icon: "app",
            ...blocked(false, many ? "Choose one file to pick an application" : null),
            submenu: single
              ? groups(
                  applications.map((application) => ({
                    id: `open-with:${application.id}`,
                    label: application.name,
                    onPress: () => handlers.openWith?.(single, application.id),
                  })),
                  [
                    handlers.chooseApplication && {
                      id: "choose-application",
                      label: "Other Application…",
                      onPress: () => handlers.chooseApplication?.(single),
                    },
                  ],
                )
              : undefined,
          }
      : null;
  return groups(
    [
      {
        id: "open",
        label: many ? `Open ${noun}` : "Open",
        shortcut: FILE_SHORTCUTS.open,
        icon: items.every((item) => item.isDir) ? "folder" : "file",
        onPress: () => handlers.open(items),
      },
      openWith,
      folder &&
        handlers.openInNewTab && {
          id: "open-new-tab",
          label: "Open in New Tab",
          onPress: () => handlers.openInNewTab?.(folder.path),
        },
      folder &&
        handlers.openInNewWindow && {
          id: "open-new-window",
          label: "Open in New Window",
          onPress: () => handlers.openInNewWindow?.(folder.path),
        },
      folder &&
        handlers.openInTerminal && {
          id: "open-in-terminal",
          label: "Open in Terminal",
          icon: "terminal",
          onPress: () => handlers.openInTerminal?.(folder.path),
        },
      handlers.showInFiles &&
        (state.inTrash ||
          items.some((item) => path.dirname(item.path) !== path.resolve(state.directory)) ||
          !handlers.openInNewTab) && {
          id: "show-in-files",
          label: handlers.openInNewTab ? "Open Item Location" : "Show in Files",
          icon: "folder",
          onPress: () => handlers.showInFiles?.(items),
        },
    ],
    [
      {
        id: "cut",
        label: "Cut",
        shortcut: FILE_SHORTCUTS.cut,
        ...blocked(state.busy),
        onPress: () => handlers.cut(items),
      },
      {
        id: "copy",
        label: "Copy",
        shortcut: FILE_SHORTCUTS.copy,
        onPress: () => handlers.copy(items),
      },
      folder && {
        id: "paste-into",
        label: "Paste Into Folder",
        ...blocked(state.busy, pasteReason(state)),
        onPress: () => handlers.paste(folder.path),
      },
      handlers.copyTo && {
        id: "copy-to",
        label: "Copy To…",
        ...blocked(state.busy),
        onPress: () => handlers.copyTo?.(items),
      },
      handlers.moveTo && {
        id: "move-to",
        label: "Move To…",
        ...blocked(state.busy),
        onPress: () => handlers.moveTo?.(items),
      },
    ],
    [
      {
        id: "duplicate",
        label: "Duplicate",
        ...blocked(state.busy),
        onPress: () => handlers.duplicate(items),
      },
      {
        id: "rename",
        label: "Rename…",
        shortcut: FILE_SHORTCUTS.rename,
        ...blocked(state.busy, many ? "Select a single item to rename" : null),
        onPress: () => single && handlers.rename(single),
      },
      {
        id: "compress",
        // One line, like every other row; the outcome names the archive it made.
        label: "Compress",
        ...blocked(state.busy),
        onPress: () => handlers.compress(items),
      },
    ],
    [
      {
        id: "copy-path",
        label: many ? "Copy Paths" : "Copy Path",
        onPress: () => handlers.copyPath(items),
      },
      {
        id: "properties",
        label: "Properties",
        shortcut: FILE_SHORTCUTS.properties,
        onPress: () => handlers.properties(items),
      },
    ],
    [
      {
        id: "trash",
        label: "Move to Trash",
        shortcut: FILE_SHORTCUTS.trash,
        icon: "trash",
        danger: true,
        ...blocked(state.busy),
        onPress: () => handlers.trash(items),
      },
      {
        id: "delete",
        label: "Delete Permanently…",
        shortcut: FILE_SHORTCUTS.deletePermanently,
        danger: true,
        ...blocked(state.busy),
        onPress: () => handlers.deletePermanently(items),
      },
    ],
  );
}

const SORT_LABELS: Record<FileSortField, string> = {
  name: "Name",
  modified: "Modified",
  size: "Size",
  type: "Type",
};

function folderMenu(
  directory: string,
  state: FileMenuState,
  handlers: FileMenuHandlers,
): FileMenuEntry[] {
  const sort = state.sort;
  const sortMenu: FileMenuEntry | null =
    handlers.sortBy && sort
      ? {
          id: "sort",
          label: "Sort By",
          submenu: groups(
            (Object.keys(SORT_LABELS) as FileSortField[]).map((field) => ({
              id: `sort-${field}`,
              label: SORT_LABELS[field],
              checked: sort.field === field,
              onPress: () =>
                handlers.sortBy?.(field, sort.field === field ? sort.descending : false),
            })),
            [
              {
                id: "sort-reverse",
                label: "Reverse Order",
                checked: sort.descending,
                onPress: () => handlers.sortBy?.(sort.field, !sort.descending),
              },
            ],
          ),
        }
      : null;
  const viewMenu: FileMenuEntry | null =
    handlers.setView && state.view
      ? {
          id: "view",
          label: "View",
          submenu: groups(
            [
              {
                id: "view-grid",
                label: "Grid",
                icon: "grid",
                checked: state.view === "grid",
                onPress: () => handlers.setView?.("grid"),
              },
              {
                id: "view-list",
                label: "List",
                icon: "list",
                checked: state.view === "list",
                onPress: () => handlers.setView?.("list"),
              },
              {
                id: "view-columns",
                label: "Columns",
                icon: "columns",
                checked: state.view === "columns",
                onPress: () => handlers.setView?.("columns"),
              },
            ],
            [
              handlers.toggleHidden && {
                id: "hidden",
                label: "Show Hidden Files",
                shortcut: FILE_SHORTCUTS.hidden,
                checked: !!state.hiddenShown,
                onPress: () => handlers.toggleHidden?.(),
              },
              handlers.togglePreview && {
                id: "preview-toggle",
                label: "Show Preview",
                checked: !!state.previewShown,
                onPress: () => handlers.togglePreview?.(),
              },
            ],
          ),
        }
      : null;
  const selectAll: FileMenuEntry = {
    id: "select-all",
    label: "Select All",
    shortcut: FILE_SHORTCUTS.selectAll,
    ...blocked(false, state.itemCount ? null : "There is nothing here to select"),
    onPress: () => handlers.selectAll(),
  };
  if (state.inTrash)
    return groups(
      [
        {
          id: "empty-trash",
          label: "Empty Trash…",
          icon: "trash",
          danger: true,
          ...blocked(
            state.busy,
            (state.trashCount ?? state.itemCount) ? null : "Trash is already empty",
          ),
          onPress: () => handlers.emptyTrash(),
        },
      ],
      [selectAll, sortMenu, viewMenu],
      [
        handlers.refresh && {
          id: "refresh",
          label: "Refresh",
          shortcut: FILE_SHORTCUTS.refresh,
          onPress: () => handlers.refresh?.(),
        },
      ],
    );
  return groups(
    [
      {
        id: "new-folder",
        label: "New Folder…",
        shortcut: FILE_SHORTCUTS.newFolder,
        icon: "folder",
        ...blocked(state.busy),
        onPress: () => handlers.newFolder(directory),
      },
      handlers.newDocument && {
        id: "new-file",
        label: "New Document…",
        icon: "document",
        ...blocked(state.busy),
        onPress: () => handlers.newDocument?.(directory),
      },
      {
        id: "paste",
        label: "Paste",
        shortcut: FILE_SHORTCUTS.paste,
        ...blocked(state.busy, pasteReason(state)),
        onPress: () => handlers.paste(directory),
      },
      selectAll,
    ],
    [
      sortMenu,
      viewMenu,
      handlers.arrange && {
        id: "arrange",
        label: "Arrange Icons",
        icon: "grid",
        onPress: () => handlers.arrange?.(),
      },
    ],
    [
      {
        id: "undo",
        label: state.undoLabel ? `Undo ${state.undoLabel}` : "Undo",
        shortcut: FILE_SHORTCUTS.undo,
        ...blocked(state.busy, state.undoLabel ? null : "Nothing to undo"),
        onPress: () => handlers.undo(),
      },
      handlers.refresh && {
        id: "refresh",
        label: "Refresh",
        shortcut: FILE_SHORTCUTS.refresh,
        onPress: () => handlers.refresh?.(),
      },
    ],
    [
      handlers.openFolderInFiles && {
        id: "open-in-files",
        label: "Open Desktop in Files",
        icon: "folder",
        onPress: () => handlers.openFolderInFiles?.(),
      },
      handlers.openInTerminal && {
        id: "open-in-terminal",
        label: "Open in Terminal",
        icon: "terminal",
        onPress: () => handlers.openInTerminal?.(directory),
      },
      !handlers.openFolderInFiles && {
        id: "properties",
        label: "Properties",
        shortcut: FILE_SHORTCUTS.properties,
        onPress: () => handlers.properties(null),
      },
    ],
    [
      handlers.changeBackground && {
        id: "change-background",
        label: "Change Background…",
        icon: "image",
        onPress: () => handlers.changeBackground?.(),
      },
      handlers.displaySettings && {
        id: "display-settings",
        label: "Display Settings…",
        icon: "monitor",
        onPress: () => handlers.displaySettings?.(),
      },
    ],
  );
}

export function fileMenu(
  target: FileMenuTarget,
  state: FileMenuState,
  handlers: FileMenuHandlers,
): FileMenuEntry[] {
  return target.kind === "items"
    ? itemMenu(target.items, state, handlers)
    : folderMenu(target.directory, state, handlers);
}

/** Every entry in a menu tree, submenus included — for finding an action by id. */
export function flattenFileMenu<T extends { submenu?: T[] }>(entries: readonly T[]): T[] {
  return entries.flatMap((entry) => [
    entry,
    ...(entry.submenu ? flattenFileMenu(entry.submenu) : []),
  ]);
}
