import path from "node:path";
import { useEffect } from "react";
import {
  createSelectionState,
  reconcileSelection,
  reduceSelection,
  type SelectionAction,
  type SelectionModel,
  type SelectionState,
} from "@moire/ui";
import type { KindFilter } from "./search/kind-counts";
import type { SearchScope } from "./search/scope";

/** A page that is not a folder listing: Recent shows files from everywhere. */
type SpecialPage = "recent";

export type FolderTab = {
  id: string;
  navigation: { paths: string[]; index: number };
  /** The search field's text; non-empty turns the page into results. */
  query: string;
  /** Where the search looks; null means the default for the folder. */
  scope: SearchScope | null;
  page: SpecialPage | null;
  /** The folder page's kind chip. */
  kindFilter: KindFilter;
  selection: SelectionState<string>;
  entryKeys: readonly string[];
  scrollY: number;
};

/** What a tab forgets when it moves to another place. */
const FRESH_PLACE: Pick<
  FolderTab,
  "query" | "scope" | "page" | "kindFilter" | "entryKeys" | "scrollY"
> = { query: "", scope: null, page: null, kindFilter: "all", entryKeys: [], scrollY: 0 };

/** Recent sits at Home in the history, as a page over it. */
export function openSpecialPage(tab: FolderTab, page: SpecialPage, home: string): FolderTab {
  return { ...navigateFolderTab(tab, home), page };
}

export function createFolderTab(id: string, directory: string): FolderTab {
  return {
    id,
    navigation: { paths: [path.resolve(directory)], index: 0 },
    ...FRESH_PLACE,
    selection: createSelectionState<string>([]),
  };
}

export function tabDirectory(tab: FolderTab): string {
  return (
    tab.navigation.paths[tab.navigation.index] ??
    tab.navigation.paths[0] ??
    path.parse(process.cwd()).root
  );
}

export function navigateFolderTab(tab: FolderTab, directory: string): FolderTab {
  const destination = path.resolve(directory);
  const paths = tab.navigation.paths.slice(0, tab.navigation.index + 1);
  if (tabDirectory(tab) !== destination) paths.push(destination);
  return {
    ...tab,
    navigation: { paths, index: paths.length - 1 },
    ...FRESH_PLACE,
    selection: createSelectionState<string>([]),
  };
}

export function travelFolderTab(tab: FolderTab, offset: -1 | 1): FolderTab {
  const index = Math.max(
    0,
    Math.min(tab.navigation.paths.length - 1, tab.navigation.index + offset),
  );
  if (index === tab.navigation.index) return tab;
  return {
    ...tab,
    navigation: { ...tab.navigation, index },
    ...FRESH_PLACE,
    selection: createSelectionState<string>([]),
  };
}

export function useFolderTabSelection(
  tab: FolderTab,
  keys: readonly string[],
  ready: boolean,
  update: (change: (current: FolderTab) => FolderTab) => void,
): SelectionModel<string> {
  const available = ready ? keys : tab.entryKeys;
  const state = reconcileSelection(tab.selection, available);
  useEffect(() => {
    if (ready && (state !== tab.selection || available !== tab.entryKeys)) {
      update((current) => ({ ...current, selection: state, entryKeys: available }));
    }
  }, [ready, state, available, tab.selection, tab.entryKeys, update]);
  const dispatch = (action: SelectionAction<string>) =>
    update((current) => ({
      ...current,
      selection: reduceSelection(current.selection, available, action),
      entryKeys: available,
    }));
  const selectedKeysInOrder = available.filter((key) => state.selectedKeys.has(key));
  const primaryKey =
    state.focusKey && state.selectedKeys.has(state.focusKey)
      ? state.focusKey
      : (selectedKeysInOrder.at(-1) ?? null);
  return {
    ...state,
    selectedKeysInOrder,
    primaryKey,
    isSelected: (key) => state.selectedKeys.has(key),
    select: (key, gesture) => dispatch({ type: "select", key, gesture }),
    focus: (key, select = true) => dispatch({ type: "focus", key, select }),
    move: (delta, options) => dispatch({ type: "move", delta, options }),
    first: (options) => dispatch({ type: "first", options }),
    last: (options) => dispatch({ type: "last", options }),
    selectAll: () => dispatch({ type: "all" }),
    clear: () => dispatch({ type: "clear" }),
    selectKeys: (keys, focusKey) => dispatch({ type: "set", keys, focusKey }),
  };
}
