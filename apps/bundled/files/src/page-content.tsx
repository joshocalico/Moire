/**
 * The page under the top bar, assembled from the workspace's state: search results, or a
 * place's title, chips, sections and items (list, grid or columns), and how each item behaves.
 */
import fs from "node:fs";
import path from "node:path";
import React, { type MutableRefObject, type ReactNode } from "react";
import {
  Button,
  EmptyState,
  Horizontal,
  getUiScaleFactor,
  type SelectionModel,
  type WindowSize,
} from "@moire/ui";
import { kindLabel, readFileClipboard, type RecentFile } from "@moire/file-operations";
import type { KindCounts } from "@moire/system-management/index-status";
import { completeLocation, expandLocation, type Entry, type FilesPreferences } from "./filesystem";
import { countLabel, formatBytes, formatModified, formatSpace } from "./format";
import type { FilesLayout } from "./layout";
import type { FolderTab } from "./navigation";
import { breadcrumbSegments, type PageKind } from "./model";
import { itemBehaviour } from "./item-behaviour";
import { kindIcon, kindTint, type KindPalette } from "./kind-style";
import { itemsOf, type useWorkspaceCommands } from "./use-commands";
import type { FilesOperations } from "./use-operations";
import type { usePlaces } from "./use-places";
import type { ColumnListing } from "./use-columns";
import type { VolumeSpace } from "./use-volume";
import { handleCollectionKey } from "./collection-keys";
import { sortMenu } from "./menus";
import type { KindChip, KindFilter } from "./search/kind-counts";
import { withToken } from "./search/query";
import type { PageSearch } from "./search/use-page-search";
import type { SearchFieldControl } from "./search/use-search-field";
import { PathLine } from "./views/path-line";
import { FolderPage } from "./views/folder-page";
import { collectionBlocks } from "./views/collection";
import { overviewBlocks } from "./views/overview";
import { recentBlocks } from "./views/recent-page";
import { SearchPage } from "./views/search-page";
import { ColumnsView } from "./views/columns";
import type { RubberBand } from "./views/page-scroller";
import type { InspectorActions } from "./inspector-actions";

/** The Browse-by-kind chips Home offers, in this order, then large files. */
const BROWSE_KINDS = ["image", "document", "audio", "video", "archive"] as const;

export type PageContext = {
  palette: KindPalette;
  windowWidth: number;
  width: number;
  height: number;
  pageTop: number;
  layout: FilesLayout;
  home: string;
  cwd: string;
  trashDirectory: string;
  kind: PageKind;
  inTrash: boolean;
  scrollY: number;
  updateTab(change: (tab: FolderTab) => FolderTab): void;
  preferences: FilesPreferences;
  changePreferences(change: Partial<FilesPreferences>): void;
  listing: { error: string | null; loading: boolean; count: number };
  entries: readonly Entry[];
  entryKeys: readonly string[];
  chips: readonly KindChip[];
  kindFilter: KindFilter;
  selection: SelectionModel<string>;
  /** Items may take keyboard focus: no text field is being edited. */
  focusEntries: boolean;
  showAllFolders: boolean;
  setShowAllFolders(show: boolean): void;
  space: VolumeSpace | null;
  recent: readonly RecentFile[];
  kindCounts: KindCounts | null;
  recentFocus: string | null;
  setRecentFocus(file: string | null): void;
  pathEditing: boolean;
  setPathEditing(editing: boolean): void;
  ops: FilesOperations;
  commands: ReturnType<typeof useWorkspaceCommands>;
  places: ReturnType<typeof usePlaces>;
  search: PageSearch;
  field: SearchFieldControl;
  preview(key: string): void;
  /** Pressing an item closes an in-window menu. */
  closeOverlay(): void;
  pendingSelection: MutableRefObject<{ path: string; properties: boolean } | null>;
  ancestorColumns: readonly ColumnListing[];
  revision: number;
  bottomReserve: number;
  band: RubberBand;
  inspector: InspectorActions;
};

export function pageContent(context: PageContext): ReactNode {
  const {
    windowWidth,
    pageTop,
    layout,
    home,
    cwd,
    kind,
    inTrash,
    scrollY,
    updateTab,
    preferences,
    changePreferences,
    listing,
    entries,
    entryKeys,
    chips,
    kindFilter,
    selection,
    focusEntries,
    showAllFolders,
    setShowAllFolders,
    space,
    recentFocus,
    setRecentFocus,
    pathEditing,
    setPathEditing,
    ops,
    commands,
    places,
    search,
    field,
    preview,
    pendingSelection,
    ancestorColumns,
    revision,
    bottomReserve,
    band,
  } = context;
  const {
    navigateTo,
    paste,
    beginName,
    handlers,
    showMenu,
    menuFor,
    showItemMenu,
    activeDrive,
    showPinnedMenu,
    openRecent,
    openItems,
  } = commands;
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const pageWidth = context.width;
  const pageHeight = context.height;
  const recentData = { recent: context.recent, kinds: context.kindCounts };

  const { interaction, rowActions, caption, trailing } = itemBehaviour({
    home,
    inTrash,
    entryKeys,
    selection,
    focusEntries,
    ops,
    commands,
    preview,
    closeOverlay: context.closeOverlay,
  });

  // ── Page ──────────────────────────────────────────────────────────────────
  const segments = breadcrumbSegments(cwd, home, context.trashDirectory);
  const ancestors = segments.slice(0, -1);
  const files = entries.filter((entry) => !entry.isDir);
  const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
  const title =
    kind === "recent" ? "Recent" : kind === "trash" ? "Trash" : (segments.at(-1)?.label ?? cwd);
  const now = Date.now();
  const subtitle =
    kind === "recent"
      ? countLabel(recentData.recent.length, "file")
      : (kind === "overview" || kind === "drive") && space
        ? `${formatSpace(space.free)} free of ${formatSpace(space.total)}`
        : [
            countLabel(entries.length),
            totalBytes ? formatBytes(totalBytes) : "",
            // A folder changes when its contents do: the newest item dates it.
            entries.length && !inTrash
              ? formatModified(
                  entries.reduce((latest, entry) => Math.max(latest, entry.modified), 0),
                  now,
                )
              : "",
          ]
            .filter(Boolean)
            .join(" · ");
  const heading = {
    title,
    subtitle,
    detail: ancestors.length
      ? `in ${ancestors.map((segment) => segment.label).join(" / ")}`
      : subtitle,
    capacity:
      space && (kind === "overview" || kind === "drive")
        ? 1 - space.free / Math.max(1, space.total)
        : null,
    pathEditing,
    pathLine: (lineWidth: number, lineHeight: number) => (
      <PathLine
        width={lineWidth}
        height={lineHeight}
        segments={kind === "recent" ? [] : ancestors}
        value={cwd.replace(home, "~")}
        editing={pathEditing}
        onEditingChange={setPathEditing}
        onNavigate={navigateTo}
        onCommit={(value) => {
          const target = expandLocation(value, cwd);
          try {
            if (!fs.statSync(target).isDirectory()) return "Not a folder";
          } catch {
            return "Folder not found";
          }
          navigateTo(target);
          return undefined;
        }}
        complete={(draft) => completeLocation(draft, cwd, preferences.hidden)}
      />
    ),
    controls: {
      sort:
        kind === "recent"
          ? undefined
          : {
              field: preferences.sort,
              descending: preferences.descending,
              onMenu: (event?: { x: number; y: number }) =>
                showMenu({
                  x: event?.x ?? windowWidth - px(200),
                  y: event?.y ?? pageTop + px(40),
                  title: "Sort By",
                  actions: sortMenu(
                    { field: preferences.sort, descending: preferences.descending },
                    (field, descending) => changePreferences({ sort: field, descending }),
                  ),
                }),
            },
      view:
        kind === "recent" || kind === "trash"
          ? undefined
          : {
              value: preferences.view,
              onChange: (view: typeof preferences.view) => changePreferences({ view }),
            },
      action:
        kind === "trash"
          ? {
              label: "Empty Trash",
              danger: true,
              disabled: ops.busy || listing.count === 0,
              onPress: () => handlers.emptyTrash(),
            }
          : kind === "drive" && activeDrive
            ? {
                label: "Eject",
                disabled: ops.busy,
                onPress: () => commands.ejectDrive(activeDrive),
              }
            : undefined,
    },
  };
  // Home browses by kind through search instead.
  const chipGroup =
    kind === "recent" || kind === "overview" || chips.length <= 2
      ? null
      : {
          items: chips.map((chip) => ({ id: chip.filter, label: chip.label, count: chip.count })),
          selectedId: kindFilter,
          onSelect: (chip: { id: string }) =>
            updateTab((tab) => ({ ...tab, kindFilter: chip.id as FolderTab["kindFilter"] })),
        };
  const kindCounts = recentData.kinds;
  const browseKinds = kindCounts
    ? [
        ...BROWSE_KINDS.flatMap((fileKind) => {
          const count = kindCounts.kinds[fileKind];
          return count
            ? [
                {
                  id: fileKind,
                  label: kindLabel(fileKind),
                  icon: kindIcon(fileKind),
                  tint: kindTint(fileKind, context.palette),
                  count: count.toLocaleString(),
                },
              ]
            : [];
        }),
        ...(kindCounts.large
          ? [
              {
                id: "large",
                label: "Large files",
                icon: "disk-usage" as const,
                count: kindCounts.large,
              },
            ]
          : []),
      ]
    : [];
  const pinned = places.places.filter((place) => place.pinned);
  const before =
    kind === "overview"
      ? overviewBlocks({
          width: layout.contentW,
          pinned,
          onOpenPlace: (place) => navigateTo(place.path),
          onPlaceMenu: showPinnedMenu,
          recent: recentData.recent,
          now,
          onOpenRecent: (file) => openItems([{ path: file.path, isDir: false }]),
          onRecentMenu: (file, event) =>
            showMenu({
              x: event.x,
              y: event.y,
              title: file.name,
              actions: menuFor({ kind: "items", items: [{ path: file.path, isDir: false }] }),
            }),
          onSeeAllRecent: openRecent,
          kinds: browseKinds,
          onKind: (chip) => {
            // A trailing space makes the token a finished chip in the field.
            field.setQuery(
              `${chip.id === "large" ? withToken("", "size", "large") : withToken("", "kind", chip.id)} `,
            );
            updateTab((tab) => ({ ...tab, scope: { kind: "home" } }));
            field.focus();
          },
          contentsHeading: "In Home",
        })
      : [];
  const blocks =
    kind === "recent"
      ? recentBlocks({
          files: recentData.recent,
          home,
          now,
          focusKey: recentFocus,
          onFocus: (file) => setRecentFocus(file.path),
          onOpen: (file) => openItems([{ path: file.path, isDir: false }]),
          onShow: (file) => handlers.showInFiles?.([{ path: file.path, isDir: false }]),
          onContextMenu: (file, event) =>
            showMenu({
              x: event.x,
              y: event.y,
              title: file.name,
              actions: menuFor({ kind: "items", items: [{ path: file.path, isDir: false }] }),
            }),
        })
      : listing.error || entries.length === 0
        ? before
        : [
            ...before,
            ...collectionBlocks({
              view: preferences.view === "grid" ? "grid" : "list",
              width: layout.contentW,
              entries,
              rowsOnly: inTrash,
              showAllFolders,
              onShowAllFolders: () => setShowAllFolders(true),
              selection,
              interaction,
              caption: (entry) => caption(entry, now),
              trailing: (entry) => trailing(entry, now),
              actions: rowActions,
              onCardMenu: (entry, at) => showItemMenu(entry, at),
            }),
          ];
  const emptyState = (size: WindowSize) => {
    const [icon, emptyTitle, message] = listing.error
      ? (["folder", "Cannot open this folder", listing.error] as const)
      : listing.loading
        ? (["folder", "Loading folder…", "Reading files and their details."] as const)
        : kind === "recent"
          ? (["history", "Nothing recent yet", "Files you open or change appear here."] as const)
          : inTrash
            ? ([
                "trash",
                "Trash is empty",
                "Items you move to Trash appear here until you empty it.",
              ] as const)
            : (["folder", "This folder is empty", "Drop files here, or create a folder."] as const);
    const actions = !listing.error && !listing.loading && kind !== "recent" && !inTrash;
    // An unreadable folder may still be workable from a shell (sudo, chmod, ls -l).
    const openInTerminal = listing.error ? commands.handlers.openInTerminal : undefined;
    return (
      <EmptyState
        width={size.width}
        height={size.height}
        icon={icon}
        title={emptyTitle}
        message={message}
        actionWidth={px(240)}
        action={
          actions ? (
            <Horizontal width={px(240)} height={px(36)} gap={px(8)} justify="center">
              <Button
                width={px(116)}
                height={px(32)}
                size="small"
                label="New Folder"
                variant="secondary"
                focusId="empty:new-folder"
                onPress={() => beginName("folder")}
              />
              <Button
                width={px(96)}
                height={px(32)}
                size="small"
                label="Paste"
                variant="ghost"
                focusId="empty:paste"
                disabled={!readFileClipboard()}
                onPress={() => paste()}
              />
            </Horizontal>
          ) : openInTerminal ? (
            <Button
              width={px(160)}
              height={px(32)}
              size="small"
              label="Open in Terminal"
              variant="secondary"
              focusId="empty:open-in-terminal"
              onPress={() => openInTerminal(cwd)}
            />
          ) : undefined
        }
      />
    );
  };
  const columnsShown =
    preferences.view === "columns" &&
    (kind === "folder" || kind === "overview" || kind === "drive");
  return search.active ? (
    <SearchPage
      width={pageWidth}
      height={pageHeight}
      pad={layout.pad}
      home={home}
      scopes={search.scopes}
      scope={search.scope}
      onScope={(scope) => updateTab((tab) => ({ ...tab, scope }))}
      view={search.view}
      searching={search.searching}
      notice={search.notice}
      active={search.highlighted}
      onActive={search.setHighlight}
      onOpen={field.open}
      onShow={field.show}
      onShowAll={(section) =>
        section.showAll &&
        field.setQuery(`${withToken(search.text, section.showAll.key, section.showAll.value)} `)
      }
      onSearchEverywhere={
        search.wider ? () => updateTab((tab) => ({ ...tab, scope: search.wider })) : null
      }
      onContextMenu={(hit, event) =>
        showMenu({
          x: event.x,
          y: event.y,
          title: hit.name,
          actions: menuFor({ kind: "items", items: [{ path: hit.path, isDir: hit.isDir }] }),
        })
      }
      onKeyDown={field.onKeyDown}
      scrollY={field.scrollY}
      onScroll={field.setScrollY}
    />
  ) : (
    <FolderPage
      width={pageWidth}
      height={pageHeight}
      pad={layout.pad}
      compact={layout.compact}
      heading={heading}
      chips={chipGroup}
      blocks={blocks}
      empty={blocks.length ? null : emptyState}
      fill={
        columnsShown
          ? (size) => (
              <ColumnsView
                inspector={context.inspector}
                width={size.width}
                height={size.height}
                columns={[...ancestorColumns, { directory: cwd, entries, error: listing.error }]}
                current={entries}
                selectedKey={selection.focusKey}
                focusEntries={focusEntries}
                refresh={revision}
                isSelected={selection.isSelected}
                onOpenFolder={navigateTo}
                onSelect={(entry, event) =>
                  selection.select(entry.path, {
                    toggle: event?.ctrlKey || event?.metaKey,
                    range: event?.shiftKey,
                  })
                }
                onReveal={(entry) => handlers.showInFiles?.([{ path: entry.path, isDir: false }])}
                onOpen={(entry) => openItems(itemsOf([entry]))}
                onContextMenu={(entry, event) =>
                  entryKeys.includes(entry.path)
                    ? showItemMenu(entry, { x: event.x, y: event.y })
                    : showMenu({
                        x: event.x,
                        y: event.y,
                        title: entry.name,
                        actions: menuFor({ kind: "items", items: itemsOf([entry]) }),
                      })
                }
                onFocusEntry={(entry) => selection.focus(entry.path, false)}
                onKey={(entry, event) => {
                  const right = event.key === "ArrowRight" || event.code === 106;
                  const left = event.key === "ArrowLeft" || event.code === 105;
                  if (right && entry.isDir) navigateTo(entry.path);
                  else if (left && path.dirname(cwd) !== cwd && cwd !== home) {
                    pendingSelection.current = { path: cwd, properties: false };
                    navigateTo(path.dirname(cwd));
                  } else
                    return handleCollectionKey(event, entry.path, {
                      selection,
                      shape: { kind: "list", card: false },
                      onPreview: preview,
                    });
                  return true;
                }}
              />
            )
          : null
      }
      scrollY={scrollY}
      onScroll={(next) => updateTab((tab) => ({ ...tab, scrollY: next }))}
      focusKey={kind === "recent" ? recentFocus : selection.focusKey}
      bottomReserve={bottomReserve}
      band={kind === "recent" ? null : band}
    />
  );
}
