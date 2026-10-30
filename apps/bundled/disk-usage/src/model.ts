/**
 * Disk Usage's state: the scan (idle, running, done, failed, cancelled), the folder being looked
 * at, and how its contents are shown. Pure functions; use-disk-usage.ts does the scanning.
 */
import path from "node:path";
import type { UsageNode, UsageScan } from "./backend";

export type Sort = "size" | "name";
export type View = "contents" | "largest";

export type Scan =
  | { kind: "idle" }
  | { kind: "scanning"; root: string; entries: number; bytes: number }
  | { kind: "ready"; result: UsageScan; trail: UsageNode[] }
  | { kind: "failed"; root: string; message: string }
  | { kind: "cancelled"; root: string };

export type State = {
  scan: Scan;
  sort: Sort;
  view: View;
  query: string;
  selected: string | null;
  choosing: boolean;
  /** A problem with the last action (Files couldn't open), shown on the status line. */
  notice: string;
};

export const initialState: State = {
  scan: { kind: "idle" },
  sort: "size",
  view: "contents",
  query: "",
  selected: null,
  choosing: false,
  notice: "",
};

export const LARGEST_LIMIT = 100;

export type Action =
  | { type: "scan-started"; root: string }
  | { type: "scan-progress"; entries: number; bytes: number }
  | { type: "scan-finished"; result: UsageScan }
  | { type: "scan-failed"; message: string }
  | { type: "scan-cancelled" }
  | { type: "enter"; node: UsageNode }
  | { type: "go-to"; depth: number }
  | { type: "sort"; sort: Sort }
  | { type: "view"; view: View }
  | { type: "query"; query: string }
  | { type: "select"; path: string | null }
  | { type: "choosing"; open: boolean }
  | { type: "notice"; notice: string };

export function reduce(state: State, action: Action): State {
  const scan = state.scan;
  switch (action.type) {
    case "scan-started":
      return {
        ...state,
        scan: { kind: "scanning", root: action.root, entries: 0, bytes: 0 },
        query: "",
        selected: null,
        choosing: false,
        notice: "",
      };
    case "scan-progress":
      return scan.kind === "scanning"
        ? { ...state, scan: { ...scan, entries: action.entries, bytes: action.bytes } }
        : state;
    case "scan-finished":
      return scan.kind === "scanning"
        ? { ...state, scan: { kind: "ready", result: action.result, trail: [action.result.root] } }
        : state;
    case "scan-failed":
      return scan.kind === "scanning"
        ? { ...state, scan: { kind: "failed", root: scan.root, message: action.message } }
        : state;
    case "scan-cancelled":
      return scan.kind === "scanning"
        ? { ...state, scan: { kind: "cancelled", root: scan.root } }
        : state;
    case "enter":
      return scan.kind === "ready" && action.node.kind === "directory"
        ? {
            ...state,
            scan: { ...scan, trail: [...scan.trail, ...pathTo(scan.trail.at(-1)!, action.node)] },
            view: "contents",
            query: "",
            selected: null,
          }
        : state;
    case "go-to":
      return scan.kind === "ready"
        ? {
            ...state,
            scan: { ...scan, trail: scan.trail.slice(0, Math.max(1, action.depth + 1)) },
            view: "contents",
            query: "",
            selected: scan.trail[action.depth + 1]?.path ?? null,
          }
        : state;
    case "sort":
      return { ...state, sort: action.sort };
    case "view":
      return { ...state, view: action.view, selected: null };
    case "query":
      return { ...state, query: action.query };
    case "select":
      return { ...state, selected: action.path };
    case "choosing":
      return { ...state, choosing: action.open };
    case "notice":
      return { ...state, notice: action.notice };
  }
}

/** The nodes from `from` (exclusive) down to `to`, so entering a deep folder keeps breadcrumbs. */
function pathTo(from: UsageNode, to: UsageNode): UsageNode[] {
  if (from.children.includes(to)) return [to];
  for (const child of from.children) {
    if (child.kind !== "directory" || !to.path.startsWith(child.path + path.sep)) continue;
    return [child, ...pathTo(child, to)];
  }
  return [to];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The rows to show for the current folder: its children or its largest files, filtered and sorted. */
export function visibleItems(state: State): UsageNode[] {
  if (state.scan.kind !== "ready") return [];
  const current = state.scan.trail.at(-1)!;
  const items = state.view === "largest" ? largestFiles(current) : current.children;
  const query = state.query.trim().toLocaleLowerCase();
  const matching = query
    ? items.filter((item) => item.name.toLocaleLowerCase().includes(query))
    : items;
  return sortItems(matching, state.sort);
}

export function sortItems(items: readonly UsageNode[], sort: Sort): UsageNode[] {
  return [...items].sort((a, b) =>
    sort === "name"
      ? collator.compare(a.name, b.name)
      : b.allocated - a.allocated || collator.compare(a.name, b.name),
  );
}

/** The biggest files anywhere under a folder. */
export function largestFiles(node: UsageNode, limit = LARGEST_LIMIT): UsageNode[] {
  const files: UsageNode[] = [];
  const walk = (current: UsageNode) => {
    for (const child of current.children)
      if (child.kind === "directory") walk(child);
      else if (child.kind === "file") files.push(child);
  };
  walk(node);
  return files.sort((a, b) => b.allocated - a.allocated).slice(0, limit);
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

/** A path shortened with ~ for the home folder. */
export function tidyPath(directory: string, home: string): string {
  return directory === home
    ? "~"
    : directory.startsWith(`${home}/`)
      ? `~${directory.slice(home.length)}`
      : directory;
}

/** The status line: a problem first, then the scan's state. */
export function statusText(state: State): string {
  if (state.notice) return state.notice;
  const scan = state.scan;
  switch (scan.kind) {
    case "idle":
      return "Choose a folder to see what uses its space";
    case "scanning":
      return `Scanning · ${scan.entries.toLocaleString()} entries`;
    case "ready": {
      const { entries, skipped, truncated } = scan.result;
      return `${entries.toLocaleString()} entries · ${skipped.length} skipped${truncated ? " · Partial scan: limit reached" : ""} · links and other drives are not followed`;
    }
    case "failed":
      return `Scan failed: ${scan.message}`;
    case "cancelled":
      return "Scan cancelled";
  }
}
