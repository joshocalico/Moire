/**
 * One Files tab's workspace: wires the location, listing, selection, search, menus and
 * operations to the rail, the top bar, the page and the sheets drawn over it.
 */
import fs from "node:fs";
import os from "node:os";
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Box,
  ContextMenuTrigger,
  DropTarget,
  ShortcutManager,
  Surface,
  getUiScaleFactor,
  hitTestDropData,
  selectionBarHeight,
  usePalette,
} from "@moire/ui";
import { operationError } from "@moire/file-operations";
import { expandLocation } from "./filesystem";
import { filesLayout } from "./layout";
import { tabDirectory, type FolderTab } from "./navigation";
import { useCatalog } from "./use-catalog";
import { usePageData } from "./use-page-data";
import { pathsFromUriList } from "./uris";
import { mountedRoots } from "./removable-drives";
import { activePlaceId, pageKind } from "./model";
import { useFilesOperations } from "./use-operations";
import { useFolderListing } from "./use-folder-listing";
import { usePreferences } from "./use-preferences";
import { usePlaces } from "./use-places";
import { useLauncher } from "./use-launcher";
import { useRubberBand } from "./use-rubber-band";
import { itemsOf, useWorkspaceCommands } from "./use-commands";
import { useWorkspaceSearch } from "./search/use-workspace-search";
import { WorkspaceOverlays, type Overlay } from "./overlays";
import { FilesRail, RECENT_ITEM_ID, TRASH_ITEM_ID, driveItemId } from "./views/rail";
import { WorkspaceTopBar } from "./views/workspace-top-bar";
import { useSheets } from "./use-sheets";
import { useReveal } from "./use-reveal";
import { useTransferFolder } from "./use-transfer-folder";
import { useWorkspaceKeyboard } from "./use-workspace-keyboard";
import { PIN_DROP } from "./views/overview";
import { PreviewSheet } from "./views/preview-sheet";
import { pageContent } from "./page-content";
import { PageFloats } from "./page-floats";
import { propertiesDock } from "./views/properties-sheet";
import { useInspectorActions } from "./inspector-actions";

import type { WorkspaceProps } from "./workspace-props";

export type { ContextMenuRequest, WorkspaceProps } from "./workspace-props";

export function FilesWorkspace(props: WorkspaceProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const home = os.homedir();
  const updateTab = useCallback(
    (change: (tab: FolderTab) => FolderTab) => props.updateTab(props.tab.id, change),
    [props.updateTab, props.tab.id],
  );
  const cwd = tabDirectory(props.tab);
  const { navigation } = props.tab;

  // ── State ──────────────────────────────────────────────────────────────────
  const [pathEditing, setPathEditing] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const sheets = useSheets(props.tab.id);
  const [recentFocus, setRecentFocus] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    setPathEditing(false);
    setOverlay(null);
  }, [props.tab.id]);

  // The catalog reports load errors through the queue's notices, which need the catalog first.
  const notifyErrorRef = useRef<(message: string) => void>(() => {});
  const {
    catalog,
    ready: catalogReady,
    revision: catalogRevision,
    changed,
  } = useCatalog((message) => notifyErrorRef.current(message));
  const ops = useFilesOperations({
    catalog,
    catalogReady,
    blocked: props.driveBlocked,
    onSettled: () => {
      changed();
      refresh();
    },
  });
  const notifyError = useCallback(
    (message: string) => ops.setNotice({ message, tone: "error", undo: false }),
    [ops.setNotice],
  );
  notifyErrorRef.current = notifyError;
  const notifyInfo = (message: string) => ops.setNotice({ message, tone: "info", undo: false });
  const [preferences, changePreferences] = usePreferences(notifyError);
  const places = usePlaces();
  const launcher = useLauncher(notifyError);
  const trash = ops.operations.trashLocation;
  const inTrash = cwd === trash.files;
  // Report only real changes; the callback's identity changes with every parent render.
  const reportBusy = useRef(props.onBusyChange);
  reportBusy.current = props.onBusyChange;
  useEffect(() => reportBusy.current(ops.busy), [ops.busy]);

  // ── Listing and selection ─────────────────────────────────────────────────
  const {
    listing,
    sorted,
    chips,
    kindFilter,
    entries,
    entryKeys,
    selection,
    selectedEntries,
    selectedPaths,
    showAllFolders,
    setShowAllFolders,
  } = useFolderListing({
    tab: props.tab,
    cwd,
    preferences,
    trash,
    revision: revision + catalogRevision,
    blocked: props.driveBlocked,
    updateTab,
  });

  const layout = filesLayout(props.width, props.height, ui, preferences.railExpanded);
  const volumes = props.drives ? mountedRoots(props.drives.state) : [];
  const kind = pageKind({
    cwd,
    home,
    trashDirectory: trash.files,
    special: props.tab.page,
    driveRoots: volumes,
  });
  const pendingSelection = useReveal({
    initial: props.reveal ?? null,
    loading: listing.loading,
    keys: entryKeys,
    select: selection.select,
    showProperties: sheets.showProperties,
  });

  const pageTop = layout.topH + (props.tabStrip ? layout.stripH : 0);
  const commands = useWorkspaceCommands({
    props,
    cwd,
    home,
    inTrash,
    trash,
    entries,
    selectedEntries,
    selectedPaths,
    selection,
    ops,
    places,
    launcher,
    preferences,
    changePreferences,
    setOverlay,
    showProperties: sheets.showProperties,
    pendingSelection,
    menuOrigin: { x: layout.railW + layout.pad, y: pageTop },
    ui,
    notifyInfo,
    notifyError,
    refresh,
    updateTab,
  });
  const { navigateTo, travel, submitName, pinFolder, handlers, showMenu, showFolderMenu } =
    commands;

  // ── Search ────────────────────────────────────────────────────────────────
  const { search, field } = useWorkspaceSearch({
    tab: props.tab,
    cwd,
    home,
    includeHidden: preferences.hidden,
    entries: inTrash || props.tab.page ? undefined : sorted,
    entryKeys,
    selection,
    client: props.indexClient,
    catalog,
    catalogReady,
    places: places.places,
    commands,
    updateTab,
  });

  // ── Recent, Home and volumes ──────────────────────────────────────────────
  const pageData = usePageData({
    client: props.indexClient,
    home,
    cwd,
    kind,
    preferences,
    revision,
    listingRevision: revision + catalogRevision,
  });

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const keyboard = useWorkspaceKeyboard({
    props,
    cwd,
    inTrash,
    entryCount: entries.length,
    selectedPaths,
    selection,
    ops,
    sheets,
    commands,
    search,
    field,
    places: places.places,
    preferences,
    changePreferences,
    overlay,
    setOverlay,
    pathEditing,
    setPathEditing,
    refresh,
  });
  const transfer = ops.transferDisplay;
  const showTransferFolder = useTransferFolder(ops, navigateTo, notifyError);

  // ── Page ──────────────────────────────────────────────────────────────────
  const band = useRubberBand(selection);
  const pageWidth = layout.mainW;
  const pageHeight = Math.max(1, props.height - pageTop);
  const barShown = selectedEntries.length >= 2 && !search.active;
  const barHeight = selectionBarHeight();
  // Docked Properties takes the page's right edge; the page reflows into the rest.
  const dock = propertiesDock(pageWidth, sheets.propertiesOpen);
  const inspector = useInspectorActions({
    commands,
    ops,
    catalog,
    catalogReady,
    launcher,
    inTrash,
    home,
    menuOrigin: { x: layout.railW + dock.content + px(16), y: pageTop + px(64) },
    setOverlay,
    notifyInfo,
    notifyError,
    onTextFocus: sheets.setTagFocused,
  });
  const page = pageContent({
    palette: pal,
    windowWidth: props.width,
    width: dock.content,
    height: pageHeight,
    pageTop,
    layout: {
      ...layout,
      mainW: dock.content,
      contentW: Math.max(1, dock.content - layout.pad * 2),
    },
    home,
    cwd,
    trashDirectory: trash.files,
    kind,
    inTrash,
    scrollY: props.tab.scrollY,
    updateTab,
    preferences,
    changePreferences,
    listing: { error: listing.error, loading: listing.loading, count: listing.entries.length },
    entries,
    entryKeys,
    chips,
    kindFilter,
    selection,
    focusEntries: !keyboard.editingText,
    showAllFolders,
    setShowAllFolders,
    space: pageData.space,
    recent: pageData.recent,
    kindCounts: pageData.kindCounts,
    recentFocus,
    setRecentFocus,
    pathEditing,
    setPathEditing,
    ops,
    commands,
    places,
    search,
    field,
    preview: sheets.preview,
    closeOverlay: () => setOverlay(null),
    pendingSelection,
    ancestorColumns: pageData.ancestorColumns,
    revision,
    // While the selection bar shows, the page keeps room for it under its last row.
    bottomReserve: barShown ? barHeight + px(32) : px(16),
    band,
    inspector,
  });

  // ── Chrome ────────────────────────────────────────────────────────────────
  const railSelected =
    kind === "recent"
      ? RECENT_ITEM_ID
      : inTrash
        ? TRASH_ITEM_ID
        : commands.activeDrive
          ? driveItemId(commands.activeDrive)
          : activePlaceId(cwd, places.places);
  const previewIndex = sheets.previewKey
    ? entries.findIndex((entry) => entry.path === sheets.previewKey)
    : -1;

  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      enabled={
        (overlay === null || overlay.kind === "menu") && !transfer && sheets.previewKey === null
      }
      shortcuts={keyboard.shortcuts}
      onKeyDown={keyboard.pageKey}
    >
      <DropTarget
        width={props.width}
        height={props.height}
        mimeTypes={["text/uri-list"]}
        feedback="none"
        onDrop={(payload, _mimes, x, y) => {
          const hit = hitTestDropData(x, y);
          if (hit === PIN_DROP) {
            for (const file of pathsFromUriList(payload))
              if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) pinFolder(file);
            commands.setDragging([]);
          } else commands.dropInto(payload, typeof hit === "string" ? hit : cwd);
        }}
      >
        <Surface width={props.width} height={props.height} fill={pal.bg}>
          <FilesRail
            height={props.height}
            expanded={preferences.railExpanded}
            onToggleExpanded={() => changePreferences({ railExpanded: !preferences.railExpanded })}
            places={places.places}
            trashDirectory={trash.files}
            volumes={commands.volumes}
            driveState={commands.driveState}
            driveBusy={props.driveBusy}
            selectedId={railSelected}
            onSelect={commands.selectRailItem}
            onContextMenu={commands.showRailMenu}
            onEject={commands.ejectDrive}
          />
          <Box x={layout.railW} width={pageWidth} height={props.height}>
            <WorkspaceTopBar
              width={pageWidth}
              height={layout.topH}
              windowWidth={props.width}
              canGoBack={navigation.index > 0}
              canGoForward={navigation.index < navigation.paths.length - 1}
              onTravel={travel}
              query={props.tab.query}
              inTrashUnscoped={inTrash && !props.tab.scope}
              search={search}
              field={field}
              preferences={preferences}
              busy={ops.busy}
              window={props.windowActions}
              showMenu={showMenu}
              onNewTab={() => props.onNewTab()}
              onNewWindow={() => handlers.openInNewWindow?.(cwd)}
              onToggleHidden={() => changePreferences({ hidden: !preferences.hidden })}
              onShortcuts={() => setOverlay({ kind: "shortcuts" })}
            />
            {props.tabStrip ? (
              <Box
                x={layout.pad - px(4)}
                y={layout.topH}
                width={Math.max(1, layout.contentW + px(8))}
                height={layout.stripH}
              >
                {props.tabStrip({
                  width: Math.max(1, layout.contentW + px(8)),
                  height: layout.stripH,
                })}
              </Box>
            ) : null}
            <Box y={pageTop} width={pageWidth} height={pageHeight}>
              <ContextMenuTrigger
                width={dock.content}
                height={pageHeight}
                onContextMenu={(event) => {
                  if (search.active || kind === "recent") return;
                  selection.clear();
                  showFolderMenu({ x: event.x, y: event.y });
                }}
              >
                {page}
              </ContextMenuTrigger>
              <PageFloats
                width={pageWidth}
                height={pageHeight}
                dock={dock}
                windowWidth={props.width}
                windowHeight={props.height}
                selectionBar={barShown}
                properties={sheets.propertiesOpen}
                onCloseProperties={sheets.close}
                selected={selectedEntries}
                cwd={cwd}
                trashDirectory={trash.files}
                inTrash={inTrash}
                revision={revision + catalogRevision}
                renameRequest={sheets.renameRequest}
                ops={ops}
                commands={commands}
                inspector={inspector}
              />
            </Box>
          </Box>
          {previewIndex >= 0 ? (
            <PreviewSheet
              width={props.width}
              height={props.height}
              entries={entries}
              index={previewIndex}
              home={home}
              refresh={revision}
              onIndex={(index) => {
                const next = entries[index];
                if (!next) return;
                selection.select(next.path);
                sheets.preview(next.path);
              }}
              onOpen={(entry) => {
                sheets.close();
                commands.openItems(itemsOf([entry]));
              }}
              onClose={sheets.close}
            />
          ) : null}
          <WorkspaceOverlays
            width={props.width}
            height={props.height}
            ui={ui}
            overlay={overlay}
            busy={ops.busy}
            onChange={setOverlay}
            onSubmitName={(prompt, name) => void submitName(prompt, name)}
            onRenamePlace={(place, label) => places.rename(place.id, label)}
            onSubmitDestination={(transferKind, paths, destination) =>
              void ops.transfer(transferKind, paths, expandLocation(destination, cwd))
            }
            onBatchRename={async (items, names) => {
              const result = await ops.renameMany(
                items.map((item, index) => ({ from: item.path, name: names[index]! })),
              );
              return result.ok || result.cancelled ? null : operationError(result.error);
            }}
            transfer={transfer}
            conflict={ops.conflict}
            onCancelTransfer={ops.cancel}
            onDismissTransfer={() => ops.setTransferDisplay(null)}
            onShowTransferFolder={showTransferFolder}
          />
        </Surface>
      </DropTarget>
    </ShortcutManager>
  );
}
