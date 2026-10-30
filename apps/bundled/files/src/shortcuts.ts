/** Files' keyboard shortcuts, matching the hints shown in its menus and tooltips. */
import type { HitKeyEvent, Shortcut } from "@moire/ui";
import { VIEW_MODES, type ViewMode } from "./filesystem";

/** Ctrl+Alt+1–9 go to the rail's first nine items. */
const RAIL_KEYS = 9;

export type ShortcutContext = {
  /** A text field has focus: plain-key shortcuts stand aside for typing. */
  editingText: boolean;
  busy: boolean;
  inTrash: boolean;
  hasEntries: boolean;
  selectionCount: number;
  canUndo: boolean;
};

export type ShortcutCommands = {
  newTab(): void;
  closeTab(): void;
  changeTab(offset: 1 | -1): void;
  focusLocation(): void;
  focusSearch(): void;
  contextMenu(event: HitKeyEvent): void;
  refresh(): void;
  selectAll(): void;
  toggleHidden(): void;
  newFolder(): void;
  copy(): void;
  cut(): void;
  paste(): void;
  undo(): void;
  properties(): void;
  pinFolder(): void;
  rename(): void;
  /** Delete: Trash, or permanent deletion inside Trash. */
  remove(): void;
  deletePermanently(): void;
  back(): void;
  forward(): void;
  up(): void;
  setView(view: ViewMode): void;
  toggleRail(): void;
  railItem(index: number): void;
  newWindow(): void;
  showShortcuts(): void;
};

export function filesShortcuts(context: ShortcutContext, run: ShortcutCommands): Shortcut[] {
  const { editingText, busy, inTrash, selectionCount } = context;
  const shortcut = (
    id: string,
    key: string,
    onInvoke: Shortcut["onInvoke"],
    options: Partial<Pick<Shortcut, "shift" | "alt" | "disabled">> & {
      ctrl?: boolean;
      /** Also active while a text field has focus. */
      always?: boolean;
    } = {},
  ): Shortcut => ({
    id,
    key,
    platformModifier: options.ctrl,
    shift: options.shift,
    alt: options.alt,
    disabled: options.disabled || (!options.always && editingText),
    onInvoke,
  });
  return [
    shortcut("new-tab", "t", run.newTab, { ctrl: true, always: true, disabled: busy }),
    shortcut("close-tab", "w", run.closeTab, { ctrl: true, always: true, disabled: busy }),
    { id: "next-tab", key: "Tab", ctrl: true, onInvoke: () => run.changeTab(1) },
    { id: "previous-tab", key: "Tab", ctrl: true, shift: true, onInvoke: () => run.changeTab(-1) },
    shortcut("location", "l", run.focusLocation, { ctrl: true, always: true }),
    shortcut("search", "f", run.focusSearch, { ctrl: true, always: true }),
    shortcut("context-menu", "F10", run.contextMenu, { shift: true }),
    { id: "context-menu-key", code: 139, disabled: editingText, onInvoke: run.contextMenu },
    shortcut("refresh", "F5", run.refresh, { always: true }),
    shortcut("select-all", "a", run.selectAll, { ctrl: true, disabled: !context.hasEntries }),
    shortcut("hidden", "h", run.toggleHidden, { ctrl: true }),
    shortcut("new-folder", "n", run.newFolder, {
      ctrl: true,
      shift: true,
      disabled: busy || inTrash,
    }),
    shortcut("copy", "c", run.copy, { ctrl: true, disabled: !selectionCount || inTrash }),
    shortcut("cut", "x", run.cut, { ctrl: true, disabled: !selectionCount || inTrash }),
    shortcut("paste", "v", run.paste, { ctrl: true, disabled: busy || inTrash }),
    shortcut("undo", "z", run.undo, { ctrl: true, disabled: !context.canUndo || busy }),
    shortcut("properties", "i", run.properties, { ctrl: true }),
    shortcut("properties-alt", "Enter", run.properties, { alt: true }),
    shortcut("new-window", "n", run.newWindow, { ctrl: true, always: true }),
    shortcut("toggle-rail", "b", run.toggleRail, { ctrl: true, always: true }),
    shortcut("keyboard-shortcuts", "?", run.showShortcuts, {
      ctrl: true,
      shift: true,
      always: true,
    }),
    ...VIEW_MODES.map((view, index) =>
      shortcut(`view-${view}`, String(index + 1), () => run.setView(view), { ctrl: true }),
    ),
    ...Array.from({ length: RAIL_KEYS }, (_, index) =>
      shortcut(`rail-${index + 1}`, String(index + 1), () => run.railItem(index), {
        ctrl: true,
        alt: true,
        always: true,
      }),
    ),
    shortcut("pin-folder", "d", run.pinFolder, { ctrl: true, disabled: inTrash }),
    shortcut("rename", "F2", run.rename, { disabled: selectionCount !== 1 || busy || inTrash }),
    shortcut("trash", "Delete", run.remove, { disabled: !selectionCount || busy }),
    shortcut("delete", "Delete", run.deletePermanently, {
      shift: true,
      disabled: !selectionCount || busy,
    }),
    shortcut("back", "ArrowLeft", run.back, { alt: true }),
    shortcut("forward", "ArrowRight", run.forward, { alt: true }),
    shortcut("up", "ArrowUp", run.up, { alt: true }),
  ];
}
