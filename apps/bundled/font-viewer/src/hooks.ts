/** Font Viewer's effects: whether the open font is already installed. */
import { useEffect, type Dispatch } from "react";
import { installedCopy } from "./install";
import type { FontAction, FontState } from "./model";

/** Finds out whether the open font is already installed, so Install can say "Installed". */
export function useInstalledCheck(state: FontState, dispatch: Dispatch<FontAction>): void {
  const file = state.kind === "open" ? state.file : "";
  const attempt = state.kind === "open" ? state.attempt : 0;
  useEffect(() => {
    if (!file) return;
    let alive = true;
    installedCopy(file).then((installed) => {
      if (alive)
        dispatch({
          type: "install-state",
          file,
          install: installed
            ? { kind: "installed", result: { path: installed } }
            : { kind: "not-installed" },
        });
    });
    return () => {
      alive = false;
    };
  }, [file, attempt, dispatch]);
}
