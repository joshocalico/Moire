import type { UiRenderingState, UiSurfaceVisibility } from "#ui/platform";
import type { BackdropMotion } from "./placement";

/** Only current per-window authority can enable motion; unknown pauses it. */
export function windowBackdropMotion(
  rendering: UiRenderingState,
  visibility: UiSurfaceVisibility,
): BackdropMotion {
  return rendering.kind === "hardware-retained"
    ? { kind: "ambient", rendering: "hardware-retained", active: visibility === "visible" }
    : { kind: "static" };
}

type ObservableWindow = {
  getRenderingState(): UiRenderingState;
  getVisibility(): UiSurfaceVisibility;
  onRenderingChange(callback: (state: UiRenderingState) => void): () => void;
  onVisibilityChange(callback: (state: UiSurfaceVisibility) => void): () => void;
};

/** Token changes alone do not reconcile an app or create a self-submission loop. */
export function observeWindowBackdropMotion(
  window: ObservableWindow,
  callback: (motion: BackdropMotion) => void,
): () => void {
  let current = windowBackdropMotion(window.getRenderingState(), window.getVisibility());
  let stopped = false;
  const update = () => {
    if (stopped) return;
    const next = windowBackdropMotion(window.getRenderingState(), window.getVisibility());
    if (
      next.kind === current.kind &&
      (next.kind === "static" || (current.kind === "ambient" && next.active === current.active))
    )
      return;
    current = next;
    callback(next);
  };
  const stopRendering = window.onRenderingChange(update);
  const stopVisibility = window.onVisibilityChange(update);
  return () => {
    if (stopped) return;
    stopped = true;
    stopRendering();
    stopVisibility();
  };
}
