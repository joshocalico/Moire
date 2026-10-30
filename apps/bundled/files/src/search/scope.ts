/** Where a search looks: the scope chips beside the results and the field's placeholder. */
import path from "node:path";
import { EVERYWHERE } from "@moire/system-management/index-status";

export type SearchScope =
  | { kind: "folder"; path: string }
  | { kind: "home" }
  | { kind: "everywhere" }
  | { kind: "drive"; path: string; label: string };

export type ScopeChoice = { scope: SearchScope; label: string };
export type MountedDrive = { path: string; label: string };

/** Inside a folder the search starts there; at Home, "This folder" and "Home" are one chip. */
export function defaultScope(cwd: string, home: string): SearchScope {
  return path.resolve(cwd) === path.resolve(home)
    ? { kind: "home" }
    : { kind: "folder", path: cwd };
}

/** The chips, narrowest first: This folder, Home, Everywhere, then each mounted drive. */
export function scopeChoices(
  cwd: string,
  home: string,
  drives: readonly MountedDrive[],
): ScopeChoice[] {
  const choices: ScopeChoice[] = [];
  const here = defaultScope(cwd, home);
  if (here.kind === "folder") choices.push({ scope: here, label: "This folder" });
  choices.push({ scope: { kind: "home" }, label: "Home" });
  choices.push({ scope: { kind: "everywhere" }, label: "Everywhere" });
  for (const drive of drives)
    choices.push({
      scope: { kind: "drive", path: drive.path, label: drive.label },
      label: drive.label,
    });
  return choices;
}

/** The index's scope argument: an absolute folder, or `EVERYWHERE`. */
export function scopePath(scope: SearchScope, home: string): string {
  switch (scope.kind) {
    case "folder":
    case "drive":
      return scope.path;
    case "home":
      return home;
    case "everywhere":
      return EVERYWHERE;
  }
}

/** Where the name-only fallback walks; without an index "Everywhere" means Home. */
export function scanRoot(scope: SearchScope, home: string): string {
  return scopePath(scope, home) || home;
}

export function searchPlaceholder(scope: SearchScope): string {
  switch (scope.kind) {
    case "folder":
      return `Search ${path.basename(scope.path) || scope.path}`;
    case "home":
      return "Search Home";
    case "everywhere":
      return "Search everywhere";
    case "drive":
      return `Search ${scope.label}`;
  }
}

/** The "Search everywhere" offer when a narrower scope found nothing; null when already widest. */
export function widerScope(scope: SearchScope): SearchScope | null {
  return scope.kind === "everywhere" ? null : { kind: "everywhere" };
}

export function sameScope(a: SearchScope, b: SearchScope): boolean {
  return a.kind === b.kind && ("path" in a ? a.path : "") === ("path" in b ? b.path : "");
}
