/**
 * The desktop's handlers for the standard file menu (shared with Files), and
 * how it opens things: Files for folders, Show in Files and Properties, the
 * default or chosen application for files, and Settings for the wallpaper.
 */
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { FileActivationPortalClient, FileActivationService } from "@moire/app-discovery";
import {
  operationError,
  writeFileClipboard,
  type FileMenuEntry,
  type FileMenuHandlers,
  type FileMenuItem,
  type FileSortField,
} from "@moire/file-operations";
import type { ContextMenuAction, IconName } from "@moire/ui";
import type { DesktopCell } from "./layout";
import type { DesktopConfirmation, DesktopToast } from "./overlay";
import { plural, type DesktopWork } from "./work";
import { settingsCommand } from "../settings-link";

export type DesktopSpawn = (opts: { exec: string }) => {
  unref?: () => void;
  once?: (event: "error", listener: (error: Error) => void) => unknown;
};

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Settings pages the desktop links to, as `MOIRE_SETTINGS_PAGE` deep links (`page#setting`). */
const SETTINGS_WALLPAPER = "appearance#wallpaper";
const SETTINGS_DISPLAYS = "displays";

export function toMenuActions(entries: readonly FileMenuEntry[]): ContextMenuAction[] {
  return entries.map((entry) => ({
    ...entry,
    icon: entry.icon as IconName | undefined,
    submenu: entry.submenu ? toMenuActions(entry.submenu) : undefined,
  }));
}

/** Copy text with wl-copy, which owns the Wayland selection the compositor offers to apps. */
export function wlCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("wl-copy", ["--"], (error) => {
      if (!error) resolve();
      else if ((error as NodeJS.ErrnoException).code === "ENOENT")
        reject(new Error("Copying text needs wl-copy (wl-clipboard), which is not installed."));
      else reject(error);
    });
    child.stdin?.end(text);
  });
}

export type DesktopOpener = ReturnType<typeof createDesktopOpener>;

export function createDesktopOpener(options: {
  spawn: DesktopSpawn;
  filesExec: string;
  settingsExec: string;
  activation(): FileActivationService;
  showToast(toast: Omit<DesktopToast, "id">): void;
}) {
  const launch = (exec: string, failure: string) => {
    try {
      const child = options.spawn({ exec });
      child.once?.("error", () => options.showToast({ message: failure, tone: "error" }));
      child.unref?.();
    } catch {
      options.showToast({ message: failure, tone: "error" });
    }
  };
  /** Open a folder in Files, or its parent with the item selected (and its properties shown). */
  const inFiles = (target: string, mode: "open" | "select" | "properties" = "open") =>
    launch(
      `${options.filesExec} ${mode === "open" ? "" : `--${mode} `}${quote(target)}`,
      "Could not open Files.",
    );
  return {
    inFiles,
    settings: (link: string) =>
      launch(settingsCommand(options.settingsExec, link), "Could not open Settings."),
    item(item: FileMenuItem) {
      if (item.isDir) {
        inFiles(item.path);
        return;
      }
      try {
        if (options.activation().openDefault(item.path)) return;
      } catch (error) {
        options.showToast({
          message: `Could not open ${path.basename(item.path)}. ${operationError(error)}`,
          tone: "error",
        });
        return;
      }
      launch(
        `xdg-open ${quote(pathToFileURL(item.path).href)}`,
        `No application can open ${path.basename(item.path)}. Try Open With.`,
      );
    },
  };
}

export type DesktopActionContext = {
  directory(): string;
  work: DesktopWork;
  open: DesktopOpener;
  activation(): FileActivationService;
  activationPortal: FileActivationPortalClient;
  showToast(toast: Omit<DesktopToast, "id">): void;
  copyText(text: string): Promise<void>;
  /** Where the menu was opened, so new items appear where the user asked for them. */
  menuCell(): DesktopCell | null;
  cellOf(name: string): DesktopCell | null;
  placeArrivals(names: readonly string[], near: DesktopCell | null): void;
  startRename(name: string): void;
  confirm(confirmation: Omit<DesktopConfirmation, "focus">): void;
  closeConfirmation(): void;
  selectAll(): void;
  sortBy(field: FileSortField, descending: boolean): void;
  arrange(): void;
  refresh(): void;
};

export function desktopMenuHandlers(context: DesktopActionContext): FileMenuHandlers {
  const { work, open } = context;
  const { operations } = work;
  const paths = (items: readonly FileMenuItem[]) => items.map((item) => item.path);
  const nearFirst = (items: readonly FileMenuItem[]) =>
    items[0] ? context.cellOf(path.basename(items[0].path)) : null;
  return {
    open: (items) => items.forEach(open.item),
    openWithApplications: (item) => {
      const database = context.activation().mimeDatabase;
      return database
        .applicationsForMime(database.mimeTypeForPath(item.path))
        .map((application) => ({ id: application.id, name: application.name }));
    },
    openWith: (item, id) => {
      if (!context.activation().openWith(item.path, id))
        context.showToast({ message: "That application is no longer installed.", tone: "error" });
    },
    chooseApplication: (item) => {
      void context.activationPortal
        .openWith(item.path)
        .then((response) => {
          if (response === 2)
            context.showToast({
              message: "Could not open the application chooser.",
              tone: "error",
            });
          else if (response === 0) context.activation().refreshAssociations();
        })
        .catch((error) =>
          context.showToast({
            message: `Could not open the application chooser. ${operationError(error)}`,
            tone: "error",
          }),
        );
    },
    showInFiles: (items) => {
      if (items[0]) open.inFiles(items[0].path, "select");
    },
    cut: (items) => {
      writeFileClipboard({ kind: "cut", paths: paths(items) });
      context.showToast({
        message: `${plural(items.length, "item")} cut. Paste to move.`,
        tone: "info",
      });
    },
    copy: (items) => {
      writeFileClipboard({ kind: "copy", paths: paths(items) });
      context.showToast({ message: `${plural(items.length, "item")} copied.`, tone: "info" });
    },
    paste: (target) =>
      work.paste(target, target === context.directory() ? context.menuCell() : null),
    duplicate: (items) =>
      void work.run(
        {
          label: `Duplicating ${plural(items.length, "item")}`,
          run: ({ signal, report }) => operations.duplicate(paths(items), signal, report),
          done: (copies) => (copies.length === 1 ? "1 copy made" : `${copies.length} copies made`),
        },
        (copies) =>
          context.placeArrivals(
            copies.map((copy) => path.basename(copy)),
            nearFirst(items),
          ),
        () => ({ label: "Duplicate" }),
      ),
    rename: (item) => context.startRename(path.basename(item.path)),
    compress: (items) =>
      void work.run(
        {
          label: `Compressing ${plural(items.length, "item")}`,
          run: ({ signal }) => operations.compress(paths(items), signal),
          done: (archive) => `Compressed into “${path.basename(archive)}”`,
        },
        (archive) => context.placeArrivals([path.basename(archive)], nearFirst(items)),
        () => ({ label: "Compress" }),
      ),
    copyPath: (items) => {
      void context.copyText(paths(items).join("\n")).then(
        () =>
          context.showToast({
            message: items.length === 1 ? "Path copied" : `${items.length} paths copied`,
            tone: "info",
          }),
        (error) => context.showToast({ message: operationError(error), tone: "error" }),
      );
    },
    properties: (items) => open.inFiles(items?.[0]?.path ?? context.directory(), "properties"),
    trash: (items) =>
      void work.run(
        {
          label: `Moving ${plural(items.length, "item")} to Trash`,
          run: ({ signal, report }) => operations.trash(paths(items), signal, report),
          done: (trashed) => `${plural(trashed.length, "item")} moved to Trash`,
        },
        undefined,
        () => ({ label: "Move to Trash" }),
      ),
    deletePermanently: (items) => {
      const names = items.map((item) => `“${path.basename(item.path)}”`);
      context.confirm({
        title:
          items.length === 1
            ? `Permanently delete ${names[0]}?`
            : `Permanently delete ${plural(items.length, "item")}?`,
        message: `${
          items.length === 1
            ? "It"
            : names.slice(0, 3).join(", ") + (items.length > 3 ? " and others" : "")
        } will be deleted immediately. This cannot be undone.`,
        confirmLabel: "Delete",
        onConfirm: () => {
          context.closeConfirmation();
          void work.run({
            label: `Deleting ${plural(items.length, "item")}`,
            run: ({ signal, report }) => operations.deletePermanently(paths(items), signal, report),
            done: () => `${plural(items.length, "item")} deleted`,
          });
        },
      });
    },
    restore: (items) =>
      void work.run({
        label: `Restoring ${plural(items.length, "item")}`,
        run: async () => {
          for (const item of items) await operations.restore(item.path);
        },
        done: () => `${plural(items.length, "item")} restored`,
      }),
    emptyTrash: () =>
      context.confirm({
        title: "Empty Trash?",
        message: "Everything in Trash will be deleted permanently. This cannot be undone.",
        confirmLabel: "Empty Trash",
        onConfirm: () => {
          context.closeConfirmation();
          void work.run({
            label: "Emptying Trash",
            run: ({ signal }) => operations.emptyTrash(signal),
            done: (count) => `${plural(count, "item")} deleted from Trash`,
          });
        },
      }),
    newFolder: (target) => {
      const near = context.menuCell();
      void work.run(
        {
          label: "Creating a folder",
          run: () => operations.createUnique(target, "New Folder", "folder"),
          done: (created) => `Created “${path.basename(created)}”`,
        },
        (created) => {
          if (path.dirname(created) !== context.directory()) return;
          context.placeArrivals([path.basename(created)], near);
          context.startRename(path.basename(created));
        },
        () => ({ label: "New Folder" }),
      );
    },
    selectAll: context.selectAll,
    sortBy: context.sortBy,
    arrange: context.arrange,
    undo: () => work.undoLast(),
    refresh: context.refresh,
    openFolderInFiles: () => open.inFiles(context.directory()),
    changeBackground: () => open.settings(SETTINGS_WALLPAPER),
    displaySettings: () => open.settings(SETTINGS_DISPLAYS),
  };
}
