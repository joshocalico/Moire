/** Disk Usage's I/O: one scan at a time, cancellable, abandoned when the window goes away. */
import { useEffect, useReducer, useRef, useState } from "react";
import { errorText, localPath, showInFiles } from "@moire/app-tools";
import { quickPicks, realHome, scanUsage } from "./backend";
import { initialState, reduce, type Action, type State } from "./model";

export type DiskUsageControls = {
  dispatch: (action: Action) => void;
  scan: (folder: string) => void;
  cancel: () => void;
  /** Show a folder in Files, or the folder holding a file. */
  show: (target: string) => void;
};

export type QuickPick = ReturnType<typeof quickPicks>[number];

export type Places = { home: string; picks: readonly QuickPick[] };

export function useDiskUsage(initialPath?: string): [State, DiskUsageControls, Places] {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [places, setPlaces] = useState<Places>({ home: "", picks: [] });
  const active = useRef<AbortController | null>(null);
  const controls = useRef<DiskUsageControls | null>(null);
  controls.current ??= {
    dispatch,
    scan: (folder) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      let root: string;
      try {
        root = localPath(folder);
      } catch (error) {
        dispatch({ type: "scan-started", root: folder });
        dispatch({ type: "scan-failed", message: errorText(error) });
        return;
      }
      dispatch({ type: "scan-started", root });
      void scanUsage(root, {
        signal: controller.signal,
        onProgress: (entries, bytes) => {
          if (!controller.signal.aborted) dispatch({ type: "scan-progress", entries, bytes });
        },
      }).then(
        (result) => {
          if (!controller.signal.aborted) dispatch({ type: "scan-finished", result });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            dispatch({ type: "scan-failed", message: errorText(error) });
        },
      );
    },
    cancel: () => {
      active.current?.abort();
      dispatch({ type: "scan-cancelled" });
    },
    show: (target) =>
      void showInFiles(target).catch((error: unknown) =>
        dispatch({ type: "notice", notice: errorText(error) }),
      ),
  };
  useEffect(() => {
    setPlaces({ home: realHome(), picks: quickPicks() });
    if (initialPath) controls.current!.scan(initialPath);
    return () => active.current?.abort();
  }, []);
  return [state, controls.current, places];
}
