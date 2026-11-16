/**
 * Keeps Screenshot's own window out of its pictures, as GNOME and macOS do: the window is
 * minimized for the capture and comes back to the front with the result.
 *
 * Sequencing: minimize, then a display roundtrip, so the compositor has handled the minimize
 * before the capture call goes out; the compositor's CaptureScreenshot then waits for a frame
 * composed after the call with window motion settled (CompositorServer.settledFrame), so the
 * window is neither there nor shrinking away in the pixels read. No timer guesses at either.
 *
 * Coming back needs an xdg-activation token, since a minimized Wayland window cannot unminimize
 * itself. It is asked for when the capture starts, while the click on Take Screenshot still has
 * the window focused; the compositor honours tokens only for the focused window, and by the end
 * of a delay the person may have clicked elsewhere.
 */
import type { Window } from "@moire/ui";

export type OwnWindow = Pick<Window, "requestActivationToken" | "minimize" | "sync" | "activate">;

/** Runs a capture with the window hidden around it. */
export type HiddenCapture = <T>(capture: () => Promise<T>) => Promise<T>;

/**
 * Prepare to hide `window` for a capture. Without a window or a token (no xdg-activation) the
 * capture runs with the window where it is: a window that could not come back would be worse.
 */
export async function prepareOwnWindow(window: OwnWindow | undefined): Promise<HiddenCapture> {
  const token = window ? await window.requestActivationToken() : null;
  return async (capture) => {
    if (!window || !token) return capture();
    window.minimize();
    try {
      await window.sync();
      return await capture();
    } finally {
      window.activate(token);
    }
  };
}
