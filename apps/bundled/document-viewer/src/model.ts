/** Document Viewer's state: the open document, the page shown, and the thumbnail sidebar. */
import { errorText, localPath } from "@moire/app-tools";

export type ViewerState =
  | { kind: "empty"; error?: string }
  | {
      kind: "open";
      file: string;
      /** Bumped by Try again, to read the same file afresh. */
      attempt: number;
      /** 1-based. */
      page: number;
      sidebar: boolean;
    };

export type ViewerAction =
  | { type: "open"; file: string; sidebar: boolean }
  | { type: "close"; error?: string }
  | { type: "retry" }
  /** `pages` is the open document's page count; the page is clamped to it. */
  | { type: "go"; page: number; pages: number }
  | { type: "toggle-sidebar" };

export function initialState(argument: string | undefined, sidebar: boolean): ViewerState {
  if (!argument) return { kind: "empty" };
  try {
    return {
      kind: "open",
      file: localPath(argument),
      attempt: 0,
      page: 1,
      sidebar,
    };
  } catch (error) {
    return { kind: "empty", error: errorText(error) };
  }
}

export function reduce(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "open":
      return {
        kind: "open",
        file: action.file,
        attempt: 0,
        page: 1,
        sidebar: action.sidebar,
      };
    case "close":
      return { kind: "empty", error: action.error };
    case "retry":
      return state.kind === "open" ? { ...state, attempt: state.attempt + 1, page: 1 } : state;
    case "go":
      return state.kind === "open"
        ? {
            ...state,
            page: Math.min(Math.max(1, Math.round(action.page)), action.pages),
          }
        : state;
    case "toggle-sidebar":
      return state.kind === "open" ? { ...state, sidebar: !state.sidebar } : state;
  }
}

/** The page a paging key leads to, or null for keys that don't page. */
export function pageForKey(key: string, page: number, pages: number): number | null {
  switch (key) {
    case "PageDown":
      return Math.min(pages, page + 1);
    case "PageUp":
      return Math.max(1, page - 1);
    case "Home":
      return 1;
    case "End":
      return pages;
    default:
      return null;
  }
}

/** A typed page number, or the reason it can't be shown. */
export function parsePage(draft: string, pages: number): { page: number } | { error: string } {
  const page = Number(draft.trim());
  return Number.isInteger(page) && page >= 1 && page <= pages
    ? { page }
    : { error: `Enter a page from 1 to ${pages}.` };
}
