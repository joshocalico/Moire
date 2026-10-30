/**
 * The desktop as a Files folder view: grid layout, menus and their actions,
 * targeted drop feedback, drops from Files, rubber band, rename and keys.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import { Group, collectHits, createShellRoot, renderShell } from "@moire/react-host";
import { ContextMenu, installUiFonts, tickAllMotions, type ContextMenuAction } from "@moire/ui";
import { FileActivationService, type FileActivationPortalClient } from "@moire/app-discovery";
import { readFileClipboard, listTrash, trashAt } from "@moire/file-operations";
import { createDesktop, type DesktopModifiers } from "./desktop/controller";
import { cellAt, desktopGrid, placeIcons } from "./desktop/layout";

const W = 1024;
const H = 768;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-desktop-smoke-"));
const previous = Object.fromEntries(
  ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR"].map((key) => [
    key,
    process.env[key],
  ]),
);
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, ".config");
process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
process.env.XDG_RUNTIME_DIR = path.join(home, "run");

// The desktop follows the XDG Desktop directory, as Files does — not a hard-coded ~/Desktop.
const desk = path.join(home, "Schreibtisch");
fs.mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
fs.writeFileSync(
  path.join(process.env.XDG_CONFIG_HOME, "user-dirs.dirs"),
  'XDG_DESKTOP_DIR="$HOME/Schreibtisch"\n',
);
fs.mkdirSync(path.join(desk, "Projects"), { recursive: true });
for (const name of ["alpha.txt", "beta.txt", "gamma.txt"])
  fs.writeFileSync(path.join(desk, name), name);

try {
  await installUiFonts();

  // ---- Layout: no overlap, nothing off screen, an overflow tile when the grid is full ----
  const grid = desktopGrid(W, H - 48);
  const many = Array.from({ length: grid.cols * grid.rows + 7 }, (_, index) => `file-${index}`);
  const crowded = placeIcons(
    many,
    { "file-3": { col: 0, row: 0 }, "file-4": { col: 0, row: 0 } },
    grid,
  );
  const used = [...crowded.cells.values()].map((cell) => `${cell.col}:${cell.row}`);
  assert.equal(new Set(used).size, used.length, "two icons share a cell");
  assert.ok(
    [...crowded.cells.values()].every((cell) => cell.col < grid.cols && cell.row < grid.rows),
    "an icon was placed off screen",
  );
  assert.deepEqual(crowded.cells.get("file-3"), { col: 0, row: 0 }, "a saved cell is honoured");
  assert.notDeepEqual(
    crowded.cells.get("file-4"),
    { col: 0, row: 0 },
    "a taken cell is not reused",
  );
  assert.equal(crowded.overflow.length, 8, "icons that do not fit gather behind the overflow tile");
  assert.ok(crowded.overflowCell, "the overflow tile has a cell");
  assert.ok(!used.includes(`${crowded.overflowCell.col}:${crowded.overflowCell.row}`));

  // ---- A desktop driven the way the shell drives it ----
  const launched: string[] = [];
  const modifiers: DesktopModifiers = { ctrl: false, shift: false, alt: false, meta: false };
  const chromeRoot = createShellRoot();
  const copied: string[] = [];
  const desktop = createDesktop({
    spawn: ({ exec }) => {
      launched.push(exec);
      return {};
    },
    filesExec: "files",
    settingsExec: "settings",
    activation: () => activation,
    activationPortal: { openWith: async () => 1 } as unknown as FileActivationPortalClient,
    modifiers: () => modifiers,
    invalidateChrome: () => {},
    chromeHits: () => {
      renderShell(
        chromeRoot,
        <Group width={W} height={H}>
          {desktop.overlay(W, H)}
        </Group>,
      );
      return collectHits(chromeRoot.container);
    },
    showIcons: () => true,
    copyText: async (text) => {
      copied.push(text);
    },
  });
  const activation = new FileActivationService(() => {}, []);
  const raster = () => desktop.raster(W, H)!;
  raster();
  const center = (name: string) => {
    const cell = desktop.layout().get(name);
    assert.ok(cell, `${name} has an icon`);
    return { x: 28 + cell.col * 128 + 56, y: 28 + cell.row * 116 + 50 };
  };
  // Two presses on one icon within 400ms are a double click; keep single clicks single.
  let lastPress = 0;
  const click = (x: number, y: number, button = 0x110) => {
    if (button === 0x110) {
      while (Date.now() - lastPress < 450)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      lastPress = Date.now();
    }
    desktop.onPointerButton({ button, value: 1, x, y });
    if (button === 0x110) desktop.onPointerButton({ button, value: 0, x, y });
    raster();
  };
  const key = (code: number, mods: Partial<DesktopModifiers> = {}) => {
    Object.assign(modifiers, { ctrl: false, shift: false, alt: false, meta: false }, mods);
    const consumed = desktop.capturesInput() ? desktop.onModalKey(code, 1) : desktop.onKey(code, 1);
    Object.assign(modifiers, { ctrl: false, shift: false });
    raster();
    return consumed;
  };
  const settle = async () => {
    await desktop.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await desktop.whenIdle();
    raster();
  };
  const findMenu = (
    node: ReactNode,
  ): ReactElement<{ actions: ContextMenuAction[]; title: string }> | null => {
    if (!isValidElement(node))
      return Array.isArray(node) ? (node.map(findMenu).find(Boolean) ?? null) : null;
    if (node.type === ContextMenu)
      return node as ReactElement<{ actions: ContextMenuAction[]; title: string }>;
    return findMenu((node.props as { children?: ReactNode }).children);
  };
  const menu = () => findMenu(desktop.overlay(W, H));
  const flatten = (actions: readonly ContextMenuAction[]): ContextMenuAction[] =>
    actions.flatMap((action) => [action, ...flatten(action.submenu ?? [])]);
  const action = (id: string) => {
    const found = flatten(menu()?.props.actions ?? []).find((candidate) => candidate.id === id);
    assert.ok(found, `menu offers ${id}`);
    return found;
  };
  const press = (id: string) => {
    const found = action(id);
    assert.ok(!found.disabled, `${id} is enabled`);
    found.onPress!();
    desktop.onModalKey(1, 1); // the menu closes once its action runs
  };

  // Item menu: the same catalogue as Files, with shortcuts and reasons.
  const alpha = center("alpha.txt");
  click(alpha.x, alpha.y, 0x111);
  assert.equal(menu()?.props.title, "alpha.txt");
  for (const id of [
    "open",
    "open-with",
    "show-in-files",
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
    action(id);
  assert.equal(action("copy").shortcut, "Ctrl+C");
  assert.equal(action("trash").shortcut, "Delete");
  assert.ok(action("open-with").submenu?.some((entry) => entry.id === "choose-application"));
  press("show-in-files");
  assert.equal(launched.at(-1), `files --select '${path.join(desk, "alpha.txt")}'`);
  click(alpha.x, alpha.y, 0x111);
  press("properties");
  assert.equal(launched.at(-1), `files --properties '${path.join(desk, "alpha.txt")}'`);
  click(alpha.x, alpha.y, 0x111);
  press("copy-path");
  await settle();
  assert.deepEqual(copied, [path.join(desk, "alpha.txt")]);

  // Multi-selection: Ctrl+click adds, and the menu speaks for both items.
  const beta = center("beta.txt");
  modifiers.ctrl = true;
  click(beta.x, beta.y);
  modifiers.ctrl = false;
  click(beta.x, beta.y, 0x111);
  assert.equal(menu()?.props.title, "2 Items");
  assert.equal(action("rename").disabled, true, "rename is disabled, not hidden, for two items");
  assert.match(action("rename").disabledReason ?? "", /single item/);
  press("copy");
  assert.deepEqual(readFileClipboard()?.paths, [
    path.join(desk, "alpha.txt"),
    path.join(desk, "beta.txt"),
  ]);

  // Background menu: paste into the Desktop folder, wallpaper and display routing.
  click(700, 400, 0x111);
  assert.equal(menu()?.props.title, "Desktop");
  for (const id of [
    "new-folder",
    "paste",
    "select-all",
    "sort",
    "arrange",
    "undo",
    "refresh",
    "open-in-files",
    "change-background",
    "display-settings",
  ])
    action(id);
  assert.match(action("undo").disabledReason ?? "", /Nothing to undo/);
  press("change-background");
  assert.equal(launched.at(-1), "MOIRE_SETTINGS_PAGE='appearance#wallpaper' settings");
  click(700, 400, 0x111);
  press("display-settings");
  assert.equal(launched.at(-1), "MOIRE_SETTINGS_PAGE='displays' settings");
  click(700, 400, 0x111);
  press("paste");
  await settle();
  assert.ok(
    fs.existsSync(path.join(desk, "alpha (copy).txt")),
    "pasting a copy beside the original duplicates it",
  );
  assert.deepEqual(
    desktop.layout().get("alpha (copy).txt"),
    cellAt(desktopGrid(W, H - 48), 700, 400),
    "the pasted copy lands where the menu was opened",
  );

  // A press on the panel (below the desktop area) closes an open menu before it acts.
  click(center("gamma.txt").x, center("gamma.txt").y, 0x111);
  assert.equal(menu()?.props.title, "gamma.txt");
  desktop.pressOutsideDesktop(H - 10);
  raster();
  assert.equal(desktop.capturesInput(), false, "a panel press closes the desktop menu");

  // Keyboard menu navigation: Menu key opens it at the focused icon; arrows and Enter run a row.
  click(center("gamma.txt").x, center("gamma.txt").y);
  key(139);
  assert.equal(menu()?.props.title, "gamma.txt");
  key(108); // Open With
  key(108); // Show in Files
  key(108); // Cut
  key(28);
  // The menu runs its row once its closing motion ends.
  for (let frame = 0; frame < 60 && desktop.capturesInput(); frame++) {
    tickAllMotions(1 / 60);
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderShell(
      chromeRoot,
      <Group width={W} height={H}>
        {desktop.overlay(W, H)}
      </Group>,
    );
  }
  assert.equal(readFileClipboard()?.kind, "cut", "the keyboard ran the focused row");
  assert.deepEqual(readFileClipboard()?.paths, [path.join(desk, "gamma.txt")]);

  // Cut + paste into a folder through its own menu, then Undo restores it.
  const projects = center("Projects");
  click(projects.x, projects.y, 0x111);
  press("paste-into");
  await settle();
  assert.ok(fs.existsSync(path.join(desk, "Projects", "gamma.txt")));
  assert.equal(readFileClipboard(), null, "a finished cut empties the clipboard");
  key(44, { ctrl: true });
  await settle();
  assert.ok(fs.existsSync(path.join(desk, "gamma.txt")), "Ctrl+Z undid the move");

  // Delete moves to Trash with an Undo; Shift+Delete asks first and names the item.
  const trash = trashAt(path.join(home, ".local", "share", "Trash"));
  click(center("beta.txt").x, center("beta.txt").y);
  key(111);
  await settle();
  assert.equal(fs.existsSync(path.join(desk, "beta.txt")), false);
  assert.equal((await listTrash(trash))[0]?.originalPath, path.join(desk, "beta.txt"));
  key(44, { ctrl: true });
  await settle();
  assert.ok(fs.existsSync(path.join(desk, "beta.txt")), "Undo restored the trashed item");
  click(center("beta.txt").x, center("beta.txt").y);
  key(111, { shift: true });
  assert.equal(desktop.capturesInput(), true, "permanent deletion asks for confirmation");
  key(28); // Enter on the default Cancel button keeps the file
  assert.ok(fs.existsSync(path.join(desk, "beta.txt")));
  key(111, { shift: true });
  key(15); // Tab to Delete
  key(28);
  await settle();
  assert.equal(fs.existsSync(path.join(desk, "beta.txt")), false, "confirmed deletion ran");

  // New folder from the keyboard starts an inline rename; typing and Enter rename it.
  key(49, { ctrl: true, shift: true });
  await settle();
  assert.ok(fs.existsSync(path.join(desk, "New Folder")));
  for (const code of [44, 48, 48]) key(code); // "zbb" replaces the selected name
  key(28);
  await settle();
  assert.ok(fs.existsSync(path.join(desk, "zbb")), "inline rename committed the typed name");
  assert.ok(desktop.layout().get("zbb"), "the renamed icon kept a cell");

  // F2 rename, Escape cancels.
  click(center("alpha.txt").x, center("alpha.txt").y);
  key(60);
  key(30);
  key(1);
  await settle();
  assert.ok(fs.existsSync(path.join(desk, "alpha.txt")), "Escape cancelled the rename");

  // Type-to-select picks by prefix, then Ctrl+C proves which item is selected.
  key(34); // g
  key(46, { ctrl: true });
  assert.deepEqual(readFileClipboard()?.paths, [path.join(desk, "gamma.txt")]);

  // Rubber band: everything whose tile meets the rectangle.
  desktop.onPointerButton({ button: 0x110, value: 1, x: 10, y: 10 });
  desktop.onPointerMotion({ x: 150, y: 150 });
  desktop.onPointerMotion({ x: 150, y: 150 });
  desktop.onPointerButton({ button: 0x110, value: 0, x: 150, y: 150 });
  key(46, { ctrl: true });
  const banded = readFileClipboard()?.paths ?? [];
  const firstCells = [...desktop.layout()].filter(([, cell]) => cell.col <= 0 && cell.row <= 1);
  assert.deepEqual(
    [...banded].sort(),
    firstCells.map(([name]) => path.join(desk, name)).sort(),
    "the rubber band selected exactly the icons it touched",
  );

  // Targeted drop feedback: a folder under the pointer, or the landing cell — never the whole desktop.
  const folder = center("Projects");
  desktop.dragHover(folder.x, folder.y, ["text/uri-list"]);
  assert.deepEqual(desktop.dropFeedback(), { target: "Projects", landing: [] });
  desktop.dragHover(900, 500, ["text/uri-list"]);
  assert.equal(desktop.dropFeedback().target, null);
  assert.deepEqual(desktop.dropFeedback().landing, [cellAt(desktopGrid(W, H - 48), 900, 500)]);
  const hovered = raster().pixels;
  const farAway = (40 * W + 1000) * 4;
  assert.equal(hovered[farAway + 3], 0, "no whole-area highlight while dragging over the desktop");
  desktop.dragHover(900, 500, ["text/plain"]);
  assert.deepEqual(
    desktop.dropFeedback(),
    { target: null, landing: [] },
    "incompatible drags show nothing",
  );
  desktop.clearDragHover();

  // A local drag dropped back on its own cell is a no-op with no feedback.
  click(1000, 700); // clear the rubber-band selection
  const own = center("alpha.txt");
  const before = new Map(desktop.layout());
  desktop.onPointerButton({ button: 0x110, value: 1, x: own.x, y: own.y });
  desktop.onPointerMotion({ x: own.x + 20, y: own.y });
  assert.deepEqual(
    desktop.dropFeedback(),
    { target: null, landing: [] },
    "no landing cell for a no-op drag",
  );
  desktop.onPointerMotion({ x: projects.x, y: projects.y });
  assert.equal(
    desktop.dropFeedback().target,
    "Projects",
    "the folder under a desktop drag is the target",
  );
  desktop.onPointerMotion({ x: own.x + 20, y: own.y });
  desktop.onPointerButton({ button: 0x110, value: 0, x: own.x + 20, y: own.y });
  await settle();
  assert.deepEqual(desktop.layout(), before, "dropping in place moved nothing");

  // Drops from Files: a file, a folder, and a name that is already taken — keep both.
  const outside = path.join(home, "Downloads");
  fs.mkdirSync(path.join(outside, "Album"), { recursive: true });
  fs.writeFileSync(path.join(outside, "Album", "track.ogg"), "x");
  fs.writeFileSync(path.join(outside, "report.pdf"), "x");
  fs.writeFileSync(path.join(outside, "alpha.txt"), "outside");
  const uris = ["report.pdf", "Album", "alpha.txt"].map(
    (name) => pathToFileURL(path.join(outside, name)).href,
  );
  assert.equal(desktop.acceptDrop(uris, 700, 160), true);
  await settle();
  assert.ok(fs.existsSync(path.join(desk, "report.pdf")));
  assert.ok(fs.existsSync(path.join(desk, "Album", "track.ogg")), "a dropped folder moves whole");
  assert.equal(
    fs.readFileSync(path.join(desk, "alpha.txt"), "utf8"),
    "alpha.txt",
    "a drop never overwrites",
  );
  assert.equal(
    fs.readFileSync(path.join(desk, "alpha (2).txt"), "utf8"),
    "outside",
    "a conflicting drop keeps both",
  );
  assert.deepEqual(
    desktop.layout().get("report.pdf"),
    cellAt(desktopGrid(W, H - 48), 700, 160),
    "dropped items land at the drop point",
  );
  // Into a folder icon.
  fs.writeFileSync(path.join(outside, "notes.md"), "x");
  assert.equal(
    desktop.acceptDrop(
      [pathToFileURL(path.join(outside, "notes.md")).href],
      projects.x,
      projects.y,
    ),
    true,
  );
  await settle();
  assert.ok(
    fs.existsSync(path.join(desk, "Projects", "notes.md")),
    "a drop on a folder icon goes into it",
  );
  assert.equal(
    desktop.acceptDrop(["https://example.com/x"], 700, 160),
    false,
    "non-file drops are refused",
  );

  // Sort By arranges by the chosen field; Arrange packs without gaps.
  click(1000, 600, 0x111);
  press("sort-size");
  await settle();
  const cells = [...desktop.layout().values()].map((cell) => `${cell.col}:${cell.row}`);
  assert.equal(new Set(cells).size, cells.length, "arranged icons never overlap");
  assert.deepEqual(
    desktop.layout().get("Album"),
    { col: 0, row: 0 },
    "folders lead an arrangement",
  );

  console.log(
    "[shell/desktop] grid layout, menus + actions, keyboard, rename, rubber band, targeted drops and Files drops passed",
  );
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(0);
