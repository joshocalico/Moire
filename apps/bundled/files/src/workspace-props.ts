/** What a Files tab's workspace is given by the window, and the context menus it asks for. */
import type { ReactNode } from "react";
import type { ContextMenuAction, WindowActions, WindowSize } from "@moire/ui";
import type { IndexClient } from "@moire/system-management/index-status";
import type { FolderTab } from "./navigation";
import type { RemovableDriveController } from "./removable-drives";

export type ContextMenuRequest = {
  x: number;
  y: number;
  title: string;
  actions: ContextMenuAction[];
};

export type WorkspaceProps = WindowSize & {
  tab: FolderTab;
  updateTab: (id: string, change: (tab: FolderTab) => FolderTab) => void;
  onBusyChange: (busy: boolean) => void;
  onNewTab: (directory?: string) => void;
  onCloseTab: () => void;
  onChangeTab: (offset: number) => void;
  onOpenWindow?: (directory: string) => void;
  onShowContextMenu?: (request: ContextMenuRequest) => boolean;
  /** Item to select once listed, and whether to show its properties (launch arguments). */
  reveal?: { path: string; properties: boolean } | null;
  drives: RemovableDriveController | null;
  driveRevision: number;
  driveBlocked: string | null;
  driveBusy: boolean;
  /** The strip of folder tabs, when there are two or more. */
  tabStrip: ((size: WindowSize) => ReactNode) | null;
  indexClient: IndexClient | null;
  windowActions?: WindowActions;
};
