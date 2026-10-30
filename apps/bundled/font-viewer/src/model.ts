/** Font Viewer's state: the open font, which view shows it, the type tester and installing. */
import path from "node:path";
import { errorText, localPath, tidyPath } from "@moire/app-tools";
import type { InstallResult } from "./install";

/** Extensions the viewer reads (without dots). Collections show their first face. */
export const FONT_EXTENSIONS = ["ttf", "otf", "ttc"];

export function isFontFile(file: string): boolean {
  return FONT_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
}

export const DEFAULT_SAMPLE = "The quick brown fox jumps over the lazy dog. 0123456789";
export const MIN_TESTER_SIZE = 12;
export const MAX_TESTER_SIZE = 96;
const TESTER_SIZE_STEP = 4;

export type Face = { family: string; style: string };
export type Mode = "specimen" | "tester";

/** What the type tester shows: the sample being edited and the one last rendered. */
export type Tester = {
  draft: string;
  rendered: { sample: string; size: number; page: number };
  pageCount: number;
};

export type Install =
  | { kind: "unknown" }
  | { kind: "not-installed" }
  | { kind: "installing" }
  | { kind: "installed"; result: InstallResult | { path: string } }
  | { kind: "failed"; message: string };

export type FontState =
  | { kind: "empty"; error?: string }
  | {
      kind: "open";
      file: string;
      /** Bumped by Try again and by reopening the same file. */
      attempt: number;
      mode: Mode;
      face: Face | null;
      error: string;
      tester: Tester;
      install: Install;
    };

export type FontAction =
  | { type: "open"; file: string }
  | { type: "close"; error?: string }
  | { type: "mode"; mode: Mode }
  | { type: "face"; face: Face }
  | { type: "error"; message: string }
  | { type: "draft"; sample: string }
  | { type: "preview" }
  | { type: "resize"; by: 1 | -1 }
  | { type: "page"; page: number }
  | { type: "page-count"; count: number }
  /** For `file`: ignored when another font has been opened since. */
  | { type: "install-state"; file: string; install: Install };

const freshTester = (): Tester => ({
  draft: DEFAULT_SAMPLE,
  rendered: { sample: DEFAULT_SAMPLE, size: 36, page: 0 },
  pageCount: 0,
});

export function initialState(argument?: string): FontState {
  if (!argument) return { kind: "empty" };
  try {
    return reduce({ kind: "empty" }, { type: "open", file: localPath(argument) });
  } catch (error) {
    return { kind: "empty", error: errorText(error) };
  }
}

export function reduce(state: FontState, action: FontAction): FontState {
  if (action.type === "open")
    return {
      kind: "open",
      file: action.file,
      attempt: state.kind === "open" ? state.attempt + 1 : 0,
      mode: state.kind === "open" ? state.mode : "specimen",
      face: null,
      error: "",
      tester: state.kind === "open" ? { ...state.tester, pageCount: 0 } : freshTester(),
      install: { kind: "unknown" },
    };
  if (action.type === "close") return { kind: "empty", error: action.error };
  if (state.kind !== "open") return state;
  const tester = state.tester;
  switch (action.type) {
    case "mode":
      return { ...state, mode: action.mode };
    case "face":
      return { ...state, face: action.face, error: "" };
    case "error":
      return { ...state, error: action.message };
    case "draft":
      return { ...state, tester: { ...tester, draft: action.sample } };
    case "preview":
      return {
        ...state,
        tester: { ...tester, rendered: { ...tester.rendered, sample: tester.draft, page: 0 } },
      };
    case "resize": {
      const size = Math.min(
        MAX_TESTER_SIZE,
        Math.max(MIN_TESTER_SIZE, tester.rendered.size + action.by * TESTER_SIZE_STEP),
      );
      return { ...state, tester: { ...tester, rendered: { ...tester.rendered, size, page: 0 } } };
    }
    case "page":
      return {
        ...state,
        tester: { ...tester, rendered: { ...tester.rendered, page: action.page } },
      };
    case "page-count":
      return { ...state, tester: { ...tester, pageCount: action.count } };
    case "install-state":
      return action.file === state.file ? { ...state, install: action.install } : state;
  }
}

/** The status line's account of an install. */
export function installMessage(install: Install): string | null {
  switch (install.kind) {
    case "installing":
      return "Installing font…";
    case "failed":
      return `Couldn't install: ${install.message}`;
    case "installed": {
      if (!("cache" in install.result)) return `Installed in ${tidyPath(install.result.path)}`;
      const { result } = install;
      const where = `${result.copied ? "Installed" : "Already installed"} in ${tidyPath(result.path)}`;
      return result.cache.kind === "refreshed"
        ? `${where} · font cache refreshed`
        : result.cache.kind === "unavailable"
          ? `${where} · fc-cache isn't installed, so apps see it after their next font scan`
          : `${where} · refreshing the font cache failed: ${result.cache.message}`;
    }
    default:
      return null;
  }
}
