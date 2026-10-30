/** Screenshot's keyboard shortcuts and compact save menu, as data over the session's actions. */
import type { ContextMenuAction, Shortcut } from "@moire/ui";
import type { ScreenshotSession } from "./session";

// Linux evdev key codes, as delivered by every Moire platform backend.
const KEY = { c: 46, n: 49, o: 24, s: 31 } as const;

export const openImage = (session: ScreenshotSession) => session.setPrompt({ kind: "choose-open" });
export const saveImageAs = (session: ScreenshotSession) =>
  session.setPrompt({ kind: "choose-save", after: null });
export const newScreenshot = (session: ScreenshotSession) =>
  session.setPrompt({ kind: "new-capture" });

export function screenshotShortcuts(session: ScreenshotSession): Shortcut[] {
  // Dialogs and running captures or saves own the keyboard.
  const disabled = session.busy || !!session.prompt;
  const shortcut = (id: string, code: number, onInvoke: () => void, shift = false) => ({
    id,
    code,
    ctrl: true,
    shift,
    disabled,
    onInvoke,
  });
  return [
    shortcut("save-png", KEY.s, () => session.saveCurrent()),
    shortcut("save-as", KEY.s, () => session.image && saveImageAs(session), true),
    shortcut("open-png", KEY.o, () => openImage(session)),
    shortcut("new-screenshot", KEY.n, () => newScreenshot(session)),
    shortcut("copy-path", KEY.c, session.copyPath, true),
  ];
}

/** What narrow windows keep behind the footer's More button. */
export function saveMenu(session: ScreenshotSession): ContextMenuAction[] {
  return [
    {
      id: "save-as",
      label: "Save As…",
      shortcut: "Ctrl+Shift+S",
      onPress: () => saveImageAs(session),
    },
    {
      id: "copy-path",
      label: "Copy Path",
      shortcut: "Ctrl+Shift+C",
      description: "Images can't be copied yet",
      onPress: session.copyPath,
    },
    { id: "show-in-files", label: "Show in Files", onPress: session.showInFiles },
  ];
}
