/** Removable drives for a Files window: one controller, shared by its tabs. */
import os from "node:os";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { navigateFolderTab, type FolderTab } from "./navigation";
import {
  RemovableDriveController,
  mountedRoots,
  retireDrivePaths,
  type FilesStorageClient,
} from "./removable-drives";

/** Removable drives: the controller, and folders that went away with a drive. */
export function useDrives(
  client: FilesStorageClient | undefined,
  setTabs: Dispatch<SetStateAction<FolderTab[]>>,
  busy: () => boolean,
  onChange: () => void,
) {
  const [drives, setDrives] = useState<RemovableDriveController | null>(null);
  const [revision, setRevision] = useState(0);
  const [unavailableRoots, setUnavailableRoots] = useState<readonly string[]>([]);
  const changed = useRef(onChange);
  changed.current = onChange;
  const isBusy = useRef(busy);
  isBusy.current = busy;
  useEffect(() => {
    if (!client) return;
    const next = new RemovableDriveController(
      client,
      (intent, destination) =>
        setTabs((current) =>
          current.map((tab) =>
            tab.id === intent.tabId && tab.navigation === intent.navigation
              ? navigateFolderTab(tab, destination)
              : tab,
          ),
        ),
      (roots) => {
        setUnavailableRoots((current) => [...new Set([...current, ...roots])]);
        setTabs((current) => current.map((tab) => retireDrivePaths(tab, roots, os.homedir())));
      },
      () => isBusy.current(),
    );
    const update = () => {
      setRevision((value) => value + 1);
      const mounted = mountedRoots(next.state);
      setUnavailableRoots((current) => current.filter((root) => !mounted.includes(root)));
      changed.current();
    };
    const unsubscribe = next.subscribe(update);
    setDrives(next);
    update();
    return () => {
      unsubscribe();
      next.dispose();
    };
  }, [client, setTabs]);
  return { drives, revision, unavailableRoots };
}
