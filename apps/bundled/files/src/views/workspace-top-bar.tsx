/** A tab's top bar: history arrows, the search field (with its scope and count), the window menu. */
import React, { type ReactNode } from "react";
import { getUiScaleFactor, type WindowActions } from "@moire/ui";
import type { FilesPreferences } from "#files/filesystem";
import { windowMenu } from "#files/menus";
import type { usePageSearch } from "#files/search/use-page-search";
import type { useSearchField } from "#files/search/use-search-field";
import type { ContextMenuRequest } from "#files/workspace-props";
import { SearchField } from "./search-field";
import { TopBar } from "./top-bar";

export function WorkspaceTopBar(props: {
  width: number;
  height: number;
  windowWidth: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onTravel(offset: -1 | 1): void;
  query: string;
  /** Searching Trash without a scope: its storage folder is never named, the place is. */
  inTrashUnscoped: boolean;
  search: ReturnType<typeof usePageSearch>;
  field: ReturnType<typeof useSearchField>;
  preferences: FilesPreferences;
  busy: boolean;
  window?: WindowActions;
  showMenu(request: ContextMenuRequest): void;
  onNewTab(): void;
  onNewWindow(): void;
  onToggleHidden(): void;
  onShortcuts(): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { search, field } = props;
  return (
    <TopBar
      width={props.width}
      height={props.height}
      canGoBack={props.canGoBack}
      canGoForward={props.canGoForward}
      onBack={() => props.onTravel(-1)}
      onForward={() => props.onTravel(1)}
      window={props.window}
      onWindowMenu={(event) =>
        props.showMenu({
          x: event?.x ?? props.windowWidth - Math.round(120 * ui),
          y: event?.y ?? props.height,
          title: "Files",
          actions: windowMenu(
            { hiddenShown: props.preferences.hidden, busy: props.busy },
            {
              newTab: props.onNewTab,
              newWindow: props.onNewWindow,
              toggleHidden: props.onToggleHidden,
              shortcuts: props.onShortcuts,
            },
          ),
        })
      }
      search={(width, height) => (
        <SearchField
          width={width}
          height={height}
          text={props.query}
          placeholder={props.inTrashUnscoped ? "Search Trash" : search.placeholder}
          focusRequest={field.focusRequest}
          completion={search.completion}
          trailingText={
            search.active && search.view
              ? `${search.total.toLocaleString()} result${search.total === 1 ? "" : "s"}`
              : undefined
          }
          onTextChange={field.setQuery}
          onFocusChange={field.setFocused}
          onKeyDown={field.onKeyDown}
          onSubmit={() => search.highlightedHit && field.open(search.highlightedHit)}
          onEscape={() =>
            search.active ? field.leave(search.highlightedHit) : field.setFocused(false)
          }
        />
      )}
    />
  );
}
