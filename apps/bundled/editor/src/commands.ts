/** The editor's keyboard shortcuts and More menu, as data over the session's actions. */
import os from "node:os";
import path from "node:path";
import type { ContextMenuAction, Shortcut } from "@moire/ui";
import type { EditorSession } from "./session";

const RECENT_IN_MENU = 8;
// Linux evdev key codes, as delivered by every Moire platform backend.
const KEY = { escape: 1, o: 24, s: 31, f: 33, g: 34, h: 35, n: 49, f3: 61 } as const;

const goToLine = (editor: EditorSession) =>
  editor.setPrompt({ kind: "go-to-line", input: "", error: "" });

export function editorShortcuts(editor: EditorSession, menuOpen: boolean): Shortcut[] {
  // Dialogs and choosers own the keyboard while they are open.
  const disabled = editor.prompt.kind !== "none";
  const shortcut = (
    id: string,
    code: number,
    onInvoke: () => void,
    shift = false,
    ctrl = true,
  ) => ({
    id,
    code,
    ctrl,
    shift,
    disabled,
    onInvoke,
  });
  return [
    shortcut("save", KEY.s, () => editor.save()),
    shortcut("save-as", KEY.s, () => editor.saveAs(), true),
    shortcut("open", KEY.o, editor.open),
    shortcut("new", KEY.n, () => editor.request({ kind: "new" })),
    shortcut("find", KEY.f, () => editor.openFind("find")),
    shortcut("replace", KEY.h, () => editor.openFind("replace")),
    shortcut("go-to-line", KEY.g, () => goToLine(editor)),
    // Escape closes the find row from any of its controls, not only the search field.
    {
      ...shortcut("close-find", KEY.escape, editor.closeFind, false, false),
      disabled: disabled || menuOpen || editor.find.mode === "closed",
    },
    shortcut("find-next", KEY.f3, () => editor.step(1), false, false),
    shortcut("find-previous", KEY.f3, () => editor.step(-1), true, false),
  ];
}

/** The More menu; narrow windows also carry New and Open here instead of in the header. */
export function editorMenu(editor: EditorSession, compact: boolean): ContextMenuAction[] {
  const recent = editor.recentFiles().slice(0, RECENT_IN_MENU);
  const home = os.homedir();
  return [
    ...(compact
      ? [
          {
            id: "new",
            label: "New Document",
            shortcut: "Ctrl+N",
            onPress: () => editor.request({ kind: "new" }),
          },
          { id: "open", label: "Open…", shortcut: "Ctrl+O", onPress: editor.open },
        ]
      : []),
    {
      id: "recent",
      label: "Open Recent",
      disabled: !recent.length,
      disabledReason: "No recent files yet",
      submenu: recent.map((file) => ({
        id: file,
        label: path.basename(file),
        description: path.dirname(file).replace(home, "~"),
        onPress: () => editor.request({ kind: "open", path: file }),
      })),
    },
    { id: "save-as", label: "Save As…", shortcut: "Ctrl+Shift+S", onPress: () => editor.saveAs() },
    {
      id: "find",
      label: "Find…",
      shortcut: "Ctrl+F",
      separatorBefore: true,
      onPress: () => editor.openFind("find"),
    },
    {
      id: "replace",
      label: "Replace…",
      shortcut: "Ctrl+H",
      onPress: () => editor.openFind("replace"),
    },
    { id: "go-to-line", label: "Go to Line…", shortcut: "Ctrl+G", onPress: () => goToLine(editor) },
    { id: "wrap", label: "Wrap Lines", checked: editor.wrap, onPress: editor.toggleWrap },
    {
      id: "close",
      label: "Close",
      separatorBefore: true,
      onPress: () => editor.request({ kind: "close" }),
    },
  ];
}
