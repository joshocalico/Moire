/** The standard file menu: contents per context, reasons, submenus, and every entry wired. */
import assert from "node:assert/strict";
import {
  fileMenu,
  flattenFileMenu,
  type FileMenuEntry,
  type FileMenuHandlers,
  type FileMenuState,
} from "./actions";

const calls: string[] = [];
const record =
  (name: string) =>
  (...args: unknown[]) => {
    calls.push(`${name}:${JSON.stringify(args)}`);
  };
const core: FileMenuHandlers = {
  open: record("open"),
  cut: record("cut"),
  copy: record("copy"),
  paste: record("paste"),
  duplicate: record("duplicate"),
  rename: record("rename"),
  compress: record("compress"),
  copyPath: record("copyPath"),
  properties: record("properties"),
  trash: record("trash"),
  deletePermanently: record("deletePermanently"),
  restore: record("restore"),
  emptyTrash: record("emptyTrash"),
  newFolder: record("newFolder"),
  selectAll: record("selectAll"),
  undo: record("undo"),
};
const files: FileMenuHandlers = {
  ...core,
  openWithApplications: () => [{ id: "editor.desktop", name: "Text Editor" }],
  openWith: record("openWith"),
  chooseApplication: record("chooseApplication"),
  openInNewTab: record("openInNewTab"),
  openInNewWindow: record("openInNewWindow"),
  showInFiles: record("showInFiles"),
  copyTo: record("copyTo"),
  moveTo: record("moveTo"),
  newDocument: record("newDocument"),
  sortBy: record("sortBy"),
  setView: record("setView"),
  toggleHidden: record("toggleHidden"),
  refresh: record("refresh"),
};
const desktop: FileMenuHandlers = {
  ...core,
  openWithApplications: () => [],
  openWith: record("openWith"),
  chooseApplication: record("chooseApplication"),
  showInFiles: record("showInFiles"),
  sortBy: record("sortBy"),
  arrange: record("arrange"),
  refresh: record("refresh"),
  openFolderInFiles: record("openFolderInFiles"),
  changeBackground: record("changeBackground"),
  displaySettings: record("displaySettings"),
};
const state: FileMenuState = {
  directory: "/home/u/Projects",
  inTrash: false,
  busy: false,
  clipboard: null,
  undoLabel: null,
  itemCount: 3,
  sort: { field: "name", descending: false },
  view: "list",
  hiddenShown: false,
};
const ids = (entries: FileMenuEntry[]) => entries.map((entry) => entry.id);
const find = (entries: FileMenuEntry[], id: string) => {
  const entry = flattenFileMenu(entries).find((candidate) => candidate.id === id);
  assert.ok(entry, `menu offers ${id}`);
  return entry;
};
const groupsOf = (entries: FileMenuEntry[]) =>
  entries.reduce<string[][]>((all, entry) => {
    if (entry.separatorBefore || !all.length) all.push([]);
    all.at(-1)!.push(entry.id);
    return all;
  }, []);

const file = { path: "/home/u/Projects/notes.txt", isDir: false };
const folder = { path: "/home/u/Projects/Design", isDir: true };
const item = fileMenu({ kind: "items", items: [file] }, state, files);
assert.deepEqual(groupsOf(item), [
  ["open", "open-with"],
  ["cut", "copy", "copy-to", "move-to"],
  ["duplicate", "rename", "compress"],
  ["copy-path", "properties"],
  ["trash", "delete"],
]);
assert.equal(find(item, "cut").shortcut, "Ctrl+X");
assert.equal(find(item, "trash").shortcut, "Delete");
assert.deepEqual(ids(find(item, "open-with").submenu!), [
  "open-with:editor.desktop",
  "choose-application",
]);
find(item, "open-with:editor.desktop").onPress!();
assert.match(calls.at(-1)!, /^openWith:.*editor\.desktop/);

const folderMenu = fileMenu({ kind: "items", items: [folder] }, state, files);
assert.deepEqual(groupsOf(folderMenu)[0], ["open", "open-new-tab", "open-new-window"]);
const pasteInto = find(folderMenu, "paste-into");
assert.equal(pasteInto.disabled, true);
assert.match(pasteInto.disabledReason!, /Cut or copy items first/);

const many = fileMenu({ kind: "items", items: [file, folder] }, state, files);
assert.equal(find(many, "open").label, "Open 2 items");
assert.equal(find(many, "rename").disabled, true, "rename is disabled, not hidden, for many items");
assert.match(find(many, "rename").disabledReason!, /single item/);
assert.equal(find(many, "open-with").disabled, true);

const busy = fileMenu({ kind: "items", items: [file] }, { ...state, busy: true }, files);
assert.match(find(busy, "trash").disabledReason!, /current operation/);
assert.equal(find(busy, "copy").disabled, undefined, "copying to the clipboard never waits");

const background = fileMenu(
  { kind: "folder", directory: state.directory },
  { ...state, clipboard: { kind: "copy", paths: [file.path], at: 1 }, undoLabel: "Move to Trash" },
  files,
);
assert.deepEqual(groupsOf(background), [
  ["new-folder", "new-file", "paste", "select-all"],
  ["sort", "view"],
  ["undo", "refresh"],
  ["properties"],
]);
assert.equal(find(background, "paste").disabled, undefined);
assert.equal(find(background, "undo").label, "Undo Move to Trash");
assert.deepEqual(ids(find(background, "sort").submenu!), [
  "sort-name",
  "sort-modified",
  "sort-size",
  "sort-type",
  "sort-reverse",
]);
assert.equal(find(background, "sort-name").checked, true);
find(background, "sort-reverse").onPress!();
assert.equal(calls.at(-1), 'sortBy:["name",true]');
assert.equal(find(background, "view-list").checked, true);

const empty = fileMenu({ kind: "folder", directory: "/x" }, { ...state, itemCount: 0 }, files);
assert.match(find(empty, "select-all").disabledReason!, /nothing here/);
assert.match(find(empty, "undo").disabledReason!, /Nothing to undo/);

// Trash: restore and permanent deletion for items; Empty Trash with its count.
const trashState = { ...state, inTrash: true, directory: "/home/u/.local/share/Trash/files" };
const trashed = fileMenu(
  { kind: "items", items: [{ path: `${trashState.directory}/a`, isDir: false }] },
  trashState,
  files,
);
assert.deepEqual(ids(trashed), ["restore", "properties", "delete"]);
const trashBackground = fileMenu(
  { kind: "folder", directory: trashState.directory },
  { ...trashState, trashCount: 0, itemCount: 0 },
  files,
);
assert.equal(trashBackground[0]?.id, "empty-trash");
assert.match(trashBackground[0]!.disabledReason!, /already empty/);

// The desktop gets the same item semantics, plus arrange and wallpaper routing.
const desktopItem = fileMenu(
  { kind: "items", items: [file] },
  { ...state, directory: "/home/u/Desktop" },
  desktop,
);
assert.ok(ids(desktopItem).includes("show-in-files"));
assert.equal(find(desktopItem, "show-in-files").label, "Show in Files");
for (const id of [
  "cut",
  "copy",
  "duplicate",
  "rename",
  "compress",
  "copy-path",
  "properties",
  "trash",
  "delete",
])
  find(desktopItem, id);
const desktopBackground = fileMenu(
  { kind: "folder", directory: "/home/u/Desktop" },
  state,
  desktop,
);
for (const id of [
  "new-folder",
  "paste",
  "select-all",
  "sort",
  "arrange",
  "undo",
  "open-in-files",
  "change-background",
  "display-settings",
])
  find(desktopBackground, id);

// "Open in Terminal" appears only with a terminal installed: on folders and the folder background,
// never on files or in Trash.
const withTerminal: FileMenuHandlers = { ...files, openInTerminal: record("openInTerminal") };
const terminalFolder = fileMenu({ kind: "items", items: [folder] }, state, withTerminal);
assert.deepEqual(groupsOf(terminalFolder)[0], [
  "open",
  "open-new-tab",
  "open-new-window",
  "open-in-terminal",
]);
find(terminalFolder, "open-in-terminal").onPress!();
assert.equal(calls.at(-1), `openInTerminal:${JSON.stringify([folder.path])}`);
assert.ok(
  !ids(fileMenu({ kind: "items", items: [file] }, state, withTerminal)).includes(
    "open-in-terminal",
  ),
);
const terminalBackground = fileMenu({ kind: "folder", directory: "/x" }, state, withTerminal);
assert.deepEqual(groupsOf(terminalBackground).at(-1), ["open-in-terminal", "properties"]);
find(terminalBackground, "open-in-terminal").onPress!();
assert.equal(calls.at(-1), 'openInTerminal:["/x"]');
assert.ok(
  !ids(
    fileMenu({ kind: "folder", directory: trashState.directory }, trashState, withTerminal),
  ).includes("open-in-terminal"),
);
assert.ok(!ids(background).includes("open-in-terminal"), "absent without a terminal");

// Every enabled leaf is wired to a handler.
for (const menu of [item, folderMenu, background, trashed, desktopItem, desktopBackground])
  for (const entry of flattenFileMenu(menu))
    if (!entry.submenu)
      assert.equal(typeof entry.onPress, "function", `${entry.id} runs something`);
console.log("[file-operations/actions] item, multi, folder, trash and desktop menus passed");
