/**
 * Moire Files — entry point and window composition: folder tabs around one workspace per
 * tab. Domain logic lives in the model, backend and hooks; the page views in `views/`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { useCallback, useRef, useState, type ReactNode } from "react";
import {
  Application,
  ContextMenu,
  OverlayHost,
  Window,
  setUiScaleFactor,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { homeTrash, userDirectory } from "@moire/file-operations";
import { connectStorageStatus } from "@moire/system-management/storage-status";
import { connectIndexStatus, type IndexClient } from "@moire/system-management/index-status";
import { tabDirectory, type FolderTab } from "./navigation";
import { useFolderTabs } from "./use-tabs";
import { isWithinMount, type FilesStorageClient } from "./removable-drives";
import { useDrives } from "./use-drives";
import { launchTarget, type LaunchTarget } from "./filesystem";
import { folderLabel } from "./model";
import { loadPlaces } from "./places";
import { tabMenu } from "./menus";
import { FilesWorkspace, type ContextMenuRequest } from "./workspace";
import { TabStrip } from "./views/tab-strip";
import { popupMenus } from "./popup-menus";

export type { ContextMenuRequest } from "./workspace";

export type FilesAppProps = WindowSize & {
  onQuit: () => void;
  onBusyChange?: (busy: boolean) => void;
  initialPath: string;
  /** An item to select in the initial folder, optionally with its properties shown. */
  reveal?: { path: string; properties: boolean } | null;
  windowActions?: WindowActions;
  onShowContextMenu?: (request: ContextMenuRequest) => boolean;
  /** Open a folder in a new Files window. */
  onOpenWindow?: (directory: string) => void;
  /** Caller owns the connection; fixtures inject a private typed client. */
  storageClient?: FilesStorageClient;
  onStorageChange?: () => void;
  /** The indexing service; search scans names without it. */
  indexClient?: IndexClient | null;
};

export function FilesApp(props: FilesAppProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [menu, setMenu] = useState<ContextMenuRequest | null>(null);
  const [places] = useState(loadPlaces);
  // Drives can retire tabs (their folders went away) before tabs exist to receive it.
  const drivesRef = useRef<{ cancelNavigation(): void } | null>(null);
  const tabs = useFolderTabs(props.initialPath, {
    busy,
    onLastClosed: props.onQuit,
    onActivate: () => drivesRef.current?.cancelNavigation(),
  });
  const { drives, revision, unavailableRoots } = useDrives(
    props.storageClient,
    tabs.setTabs,
    () => busyRef.current,
    () => props.onStorageChange?.(),
  );
  drivesRef.current = drives;
  const onBusyChange = useRef(props.onBusyChange);
  onBusyChange.current = props.onBusyChange;
  const reportBusy = useCallback((value: boolean) => {
    setBusy(value);
    onBusyChange.current?.(value);
  }, []);
  const { active, activeIndex } = tabs;
  const trashDirectory = homeTrash().files;
  const tabLabel = (tab: FolderTab) =>
    tab.page === "recent" ? "Recent" : folderLabel(tabDirectory(tab), places, trashDirectory);
  const showTabMenu = (index: number, at: { x: number; y: number }) => {
    const request: ContextMenuRequest = {
      ...at,
      title: tabLabel(tabs.tabs[index]!),
      actions: tabMenu(index, tabs.tabs.length, {
        newTab: () => tabs.add(),
        duplicate: (from) => tabs.add(tabDirectory(tabs.tabs[from]!), from + 1),
        move: tabs.move,
        close: tabs.close,
        closeOthers: tabs.closeOthers,
      }),
    };
    if (!props.onShowContextMenu?.(request)) setMenu(request);
  };
  const driveBlocked = unavailableRoots.some((root) => isWithinMount(tabDirectory(active), root))
    ? "This drive is no longer available. Choose another folder or reconnect it."
    : null;
  return (
    <OverlayHost width={props.width} height={props.height}>
      <FilesWorkspace
        width={props.width}
        height={props.height}
        tab={active}
        updateTab={tabs.updateTab}
        onBusyChange={reportBusy}
        onNewTab={(directory) => tabs.add(directory)}
        onCloseTab={() => tabs.close(activeIndex)}
        onChangeTab={tabs.change}
        onOpenWindow={props.onOpenWindow}
        onShowContextMenu={props.onShowContextMenu}
        reveal={active.id === "folder-1" ? props.reveal : null}
        drives={drives}
        driveRevision={revision}
        driveBlocked={driveBlocked}
        driveBusy={busy}
        indexClient={props.indexClient ?? null}
        windowActions={props.windowActions}
        tabStrip={
          tabs.tabs.length > 1
            ? (size) => (
                <TabStrip
                  {...size}
                  disabled={busy}
                  tabs={tabs.tabs.map((tab) => ({
                    id: tab.id,
                    label: tabLabel(tab),
                    trash: tabDirectory(tab) === trashDirectory,
                    dropData: tab.page ? undefined : tabDirectory(tab),
                  }))}
                  active={activeIndex}
                  onChange={(index) => {
                    const next = tabs.tabs[index];
                    if (next) tabs.activate(next.id);
                  }}
                  onClose={tabs.close}
                  onAdd={() => tabs.add()}
                  onContextMenu={(index, event) => showTabMenu(index, { x: event.x, y: event.y })}
                />
              )
            : null
        }
      />
      {menu ? (
        <ContextMenu
          viewportWidth={props.width}
          viewportHeight={props.height}
          x={menu.x}
          y={menu.y}
          title={menu.title}
          actions={menu.actions}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
    </OverlayHost>
  );
}

/** Open a folder in another Files process, detached from this window's lifetime. */
function openFilesWindow(directory: string): void {
  const script = process.argv[1];
  if (!script) return;
  const child = spawn(process.execPath, [...process.execArgv, script, directory], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/** Optional session services: Files works, more plainly, without either. */
async function connectOptional<T>(connect: () => Promise<T>): Promise<T | undefined> {
  try {
    return await connect();
  } catch {
    return undefined;
  }
}

async function main() {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const desktop = userDirectory("DESKTOP");
  fs.mkdirSync(desktop, { recursive: true });
  const target: LaunchTarget = launchTarget(process.argv.slice(2), desktop);

  const app = new Application();
  const win = new Window({
    title: "Files",
    appId: "org.moire.Files",
    width: Math.round(1020 * settings.uiScale),
    height: Math.round(640 * settings.uiScale),
    resizable: true,
    decorated: false,
  });
  const [storageClient, indexClient] = await Promise.all([
    connectOptional(connectStorageStatus),
    connectOptional(connectIndexStatus),
  ]);
  const menus = popupMenus(win);
  win.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={target.directory}
      reveal={target.select ? { path: target.select, properties: target.properties } : null}
      storageClient={storageClient}
      indexClient={indexClient}
      onStorageChange={menus.retire}
      windowActions={win}
      onBusyChange={(busy) => win.setCloseGuard(busy ? () => false : null)}
      onShowContextMenu={menus.show}
      onOpenWindow={openFilesWindow}
      onQuit={() => {
        win.destroy();
        app.quit();
      }}
    />
  ));
  win.onClose(() => app.quit());
  app.addWindow(win);
  try {
    await app.run();
  } finally {
    menus.retire();
    await Promise.all([storageClient?.dispose(), indexClient?.dispose()]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error("[files]", error);
    process.exit(1);
  });
