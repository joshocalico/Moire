/**
 * The search field's behaviour on a page: its focus, typing into it, leaving it (with the best
 * match selected, as type-to-select would have), and the keys that act on results from it.
 */
import { useEffect, useState } from "react";
import type { HitKeyEvent, SelectionModel } from "@moire/ui";
import type { FileMenuItem } from "@moire/file-operations";
import type { SearchHit } from "@moire/system-management/index-status";
import type { FolderTab } from "#files/navigation";
import type { PageSearch } from "./use-page-search";

export function useSearchField(options: {
  tabId: string;
  search: PageSearch;
  updateTab(change: (tab: FolderTab) => FolderTab): void;
  /** The folder's items, to select the result the search leaves on. */
  entryKeys: readonly string[];
  selection: SelectionModel<string>;
  open(items: readonly FileMenuItem[]): void;
  showInFolder(items: readonly FileMenuItem[]): void;
}) {
  const { search, selection } = options;
  /** Each request remounts the field: with focus to type into it, without to hand keys back. */
  const [request, setRequest] = useState({ count: 0, focus: false });
  const [focused, setFocused] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    setRequest((current) => ({ count: current.count + 1, focus: false }));
    setFocused(false);
  }, [options.tabId]);
  const setQuery = (query: string) => {
    options.updateTab((tab) => ({ ...tab, query }));
    setScrollY(0);
  };
  const focus = () => setRequest((current) => ({ count: current.count + 1, focus: true }));
  const blur = () => {
    setFocused(false);
    setRequest((current) => ({ count: current.count + 1, focus: false }));
  };
  /** Back to the folder, with `target` selected when it is listed here. */
  const leave = (target: SearchHit | null) => {
    setQuery("");
    blur();
    if (target && options.entryKeys.includes(target.path)) selection.select(target.path);
  };
  const open = (hit: SearchHit) => {
    if (hit.isDir) blur();
    options.open([{ path: hit.path, isDir: hit.isDir }]);
  };
  const show = (hit: SearchHit) => {
    blur();
    options.showInFolder([{ path: hit.path, isDir: hit.isDir }]);
  };
  /** ↑↓ move through results, Enter opens, Ctrl+Enter shows in its folder, Escape leaves. */
  const onKeyDown = (event: HitKeyEvent): boolean => {
    if (!search.active) return false;
    const down = event.key === "ArrowDown" || event.code === 108;
    const up = event.key === "ArrowUp" || event.code === 103;
    if (down || up) {
      search.move(down ? 1 : -1);
      return true;
    }
    if (event.key === "Enter" || event.code === 28) {
      const hit = search.highlightedHit;
      if (hit) (event.ctrlKey || event.metaKey ? show : open)(hit);
      return true;
    }
    if (event.key === "Escape" || event.code === 1) {
      leave(search.highlightedHit);
      return true;
    }
    return false;
  };
  return {
    focused,
    setFocused,
    focusRequest: request.focus ? request.count : 0,
    scrollY,
    setScrollY,
    setQuery,
    focus,
    leave,
    open,
    show,
    onKeyDown,
  };
}

export type SearchFieldControl = ReturnType<typeof useSearchField>;
