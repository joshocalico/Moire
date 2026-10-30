/**
 * One portal dialog at a time, each a top-level Wayland window of this process. A dialog belongs
 * to the compositor's window stack like any other client's, so an X11 app (every X client shares
 * one rootless Xwayland and can inspect its siblings there) can neither read nor drive it.
 */
import type { ReactNode } from "react";
import { Application, Window, type WindowSize } from "@moire/ui";

export type DialogWindow = { beginMove(): void; requestRedraw(): void };

export type DialogSpec<Result> = {
  title: string;
  width: number;
  height: number;
  /** Render the dialog; `finish` settles it once, later calls are ignored. */
  render(size: WindowSize, finish: (result: Result) => void, window: DialogWindow): ReactNode;
  /** The result when the window is closed without an answer. */
  dismissed: Result;
};

export type ActiveDialog = {
  /** The Request handle the dialog answers. */
  handle: string;
  /** End the dialog from outside (Request.Close). */
  cancel(): void;
  /** AppChooser's UpdateChoices; absent for other dialogs. */
  replaceChoices?(ids: string[]): void;
};

/** The dialog on screen, if any. A second request while one is open is refused, not queued. */
export class DialogSlot {
  private current: ActiveDialog | null = null;

  get active(): ActiveDialog | null {
    return this.current;
  }

  get busy(): boolean {
    return this.current !== null;
  }

  /**
   * Show a dialog and wait for its answer. `cancelled` is the result of an outside cancel;
   * `extend` adds dialog-specific controls (the chooser's UpdateChoices) to the active entry.
   */
  async present<Result>(
    handle: string,
    spec: DialogSpec<Result>,
    cancelled: Result,
    extend?: (window: DialogWindow) => Pick<ActiveDialog, "replaceChoices">,
  ): Promise<Result> {
    if (this.current) throw new Error("Another portal dialog is open");
    const app = new Application();
    const win = new Window({
      title: spec.title,
      appId: "org.moire.Portal",
      width: spec.width,
      height: spec.height,
      resizable: true,
      decorated: false,
    });
    let settled = false;
    let resolveResult: (result: Result) => void = () => {};
    const result = new Promise<Result>((resolve) => {
      resolveResult = resolve;
    });
    const finish = (value: Result) => {
      if (settled) return;
      settled = true;
      resolveResult(value);
      win.destroy();
      app.quit();
    };
    const entry: ActiveDialog = { handle, cancel: () => finish(cancelled), ...extend?.(win) };
    this.current = entry;
    try {
      win.setContent((size) => spec.render(size, finish, win));
      win.onClose(() => finish(spec.dismissed));
      app.addWindow(win);
      await app.run();
      return await result;
    } finally {
      if (this.current === entry) this.current = null;
    }
  }
}
