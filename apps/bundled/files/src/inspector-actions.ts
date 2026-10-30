/**
 * Everything the inspector (the Properties pane and the columns preview pane) can do, as one
 * object built from the workspace's commands, operations, tag catalog and launcher. Views call
 * these with intent; every change to files goes through the operation queue.
 */
import { writeClipboardText } from "@moire/ui";
import { operationError } from "@moire/file-operations";
import { TAG_COLOURS, type FileCatalog } from "./catalog";
import type { Entry } from "./filesystem";
import { countLabel } from "./format";
import { kindName } from "./kind-style";
import { itemsOf, pathsOf, type useWorkspaceCommands } from "./use-commands";
import type { FileAssociation, useLauncher } from "./use-launcher";
import type { FilesOperations } from "./use-operations";
import type { Overlay } from "./overlays";

export type MenuPoint = { x: number; y: number };

export type InspectorActions = ReturnType<typeof useInspectorActions>;

const COLOUR_NAMES = ["Blue", "Green", "Orange", "Pink", "Violet", "Amber"];

export function useInspectorActions(options: {
  commands: ReturnType<typeof useWorkspaceCommands>;
  ops: FilesOperations;
  catalog: FileCatalog;
  catalogReady: boolean;
  launcher: ReturnType<typeof useLauncher>;
  inTrash: boolean;
  home: string;
  /** Where a menu opens when a control was activated from the keyboard. */
  menuOrigin: MenuPoint;
  setOverlay(overlay: Overlay | null): void;
  notifyInfo(message: string): void;
  notifyError(message: string): void;
  onTextFocus(focused: boolean): void;
}) {
  const { commands, ops, catalog, launcher } = options;
  const at = (point?: MenuPoint | null) => point ?? options.menuOrigin;
  const tagsReady = options.catalogReady && !options.inTrash;
  const changeTags = (
    paths: readonly string[],
    tags: readonly string[],
    mode: "add" | "remove",
  ) => {
    if (!tagsReady || !tags.length || !paths.length) return;
    void ops.tagged(
      mode === "add" ? "Adding tags" : "Removing tags",
      () => catalog.update(paths, tags, mode),
      mode === "add" ? "Tags added" : "Tags removed",
    );
  };
  return {
    home: options.home,
    inTrash: options.inTrash,
    busy: ops.busy,
    onTextFocus: options.onTextFocus,
    open: (entries: readonly Entry[]) => commands.openItems(itemsOf(entries)),
    restore: (entries: readonly Entry[]) => void ops.restore(pathsOf(entries)),
    openInNewTab: (directory: string) => commands.handlers.openInNewTab?.(directory),
    navigate: (directory: string) => commands.navigateTo(directory),
    showInFolder: (entry: Entry) => commands.handlers.showInFiles?.(itemsOf([entry])),
    copyPath: (entries: readonly Entry[]) =>
      void writeClipboardText(pathsOf(entries).join("\n")).then(
        () =>
          options.notifyInfo(
            entries.length === 1 ? "Path copied" : `${countLabel(entries.length, "path")} copied`,
          ),
        (error) => options.notifyError(`Could not copy the path. ${operationError(error)}`),
      ),
    copyText: (text: string, what: string) =>
      void writeClipboardText(text).then(
        () => options.notifyInfo(`${what} copied`),
        (error) => options.notifyError(`Could not copy. ${operationError(error)}`),
      ),
    /** The item's own menu, as a right-click on it would show. */
    moreMenu: (entries: readonly Entry[], point?: MenuPoint | null) =>
      commands.showMenu({
        ...at(point),
        title: commands.itemTitle(entries),
        actions: commands.menuFor({ kind: "items", items: itemsOf(entries) }),
      }),
    /** Open With ▾: the applications for the type, the chooser, and making one the default. */
    openWithMenu: (entry: Entry, point?: MenuPoint | null) => {
      const association = launcher.association(entry.path);
      const applications = association?.applications ?? [];
      commands.showMenu({
        ...at(point),
        title: `Open “${entry.name}” With`,
        actions: [
          ...applications.map((application) => ({
            id: `open-with:${application.id}`,
            label: application.name,
            checked: application.id === association?.defaultId,
            onPress: () => launcher.openWith(entry.path, application.id),
          })),
          {
            id: "open-with:other",
            label: "Other Application…",
            separatorBefore: applications.length > 0,
            onPress: () => launcher.chooseApplication(entry.path),
          },
          ...(association && applications.length > 1
            ? [
                {
                  id: "open-with:default",
                  label: `Always Open ${kindName(entry)}s With`,
                  submenu: applications.map((application) => ({
                    id: `default:${application.id}`,
                    label: application.name,
                    checked: application.id === association.defaultId,
                    onPress: () => setDefault(association, application.id),
                  })),
                },
              ]
            : []),
        ],
      });
    },
    association: (file: string) => launcher.association(file),
    setDefault: (association: FileAssociation, applicationId: string) =>
      setDefault(association, applicationId),
    applicationName: (appId: string) => launcher.applicationName(appId),
    rename: async (entry: Entry, name: string): Promise<string | null> => {
      if (!name.trim() || name === entry.name) return null;
      const result = await ops.rename(entry.path, name.trim());
      return result.ok || result.cancelled ? null : operationError(result.error);
    },
    batchRename: (entries: readonly Entry[]) =>
      options.setOverlay({
        kind: "batch-rename",
        entries: [...entries],
        pattern: "{name}",
        error: null,
      }),
    compress: (entries: readonly Entry[]) => void ops.compress(pathsOf(entries)),
    moveTo: (entries: readonly Entry[]) => commands.handlers.moveTo?.(itemsOf(entries)),
    copyTo: (entries: readonly Entry[]) => commands.handlers.copyTo?.(itemsOf(entries)),
    extract: (entry: Entry) => void ops.extract(entry.path),
    setPermissions: (changes: ReadonlyArray<{ path: string; mode: number }>) =>
      void ops.setPermissions(changes),
    tags: {
      ready: tagsReady,
      of: (file: string) => catalog.tags(file),
      known: () => catalog.allTags(),
      colourOf: (tag: string) => catalog.colourOf(tag),
      add: (paths: readonly string[], tags: readonly string[]) => changeTags(paths, tags, "add"),
      remove: (paths: readonly string[], tags: readonly string[]) =>
        changeTags(paths, tags, "remove"),
      /** A tag's menu: its colour, and removing it from these items. */
      menu: (tag: string, paths: readonly string[], point?: MenuPoint | null) =>
        commands.showMenu({
          ...at(point),
          title: tag,
          actions: [
            ...TAG_COLOURS.map((colour, index) => ({
              id: `tag-colour:${index}`,
              label: COLOUR_NAMES[index] ?? `Colour ${index + 1}`,
              checked: catalog.colourOf(tag) === colour,
              onPress: () =>
                void ops.tagged(
                  "Changing tag colour",
                  () => catalog.setColour(tag, colour),
                  "Tag colour changed",
                ),
            })),
            {
              id: "tag-remove",
              label: "Remove Tag",
              separatorBefore: true,
              danger: true,
              onPress: () => changeTags(paths, [tag], "remove"),
            },
          ],
        }),
    },
  };

  function setDefault(association: FileAssociation, applicationId: string) {
    const name =
      association.applications.find((application) => application.id === applicationId)?.name ??
      applicationId;
    if (launcher.setDefault(association.mime, applicationId))
      options.notifyInfo(
        `${name} now opens every ${association.extension || association.mime} file`,
      );
  }
}
