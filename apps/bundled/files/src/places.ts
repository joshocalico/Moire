import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { xdgUserDirectories } from "@moire/file-operations";

export type PlaceIcon =
  | "home"
  | "desktop"
  | "downloads"
  | "folder"
  | "document"
  | "image"
  | "music";

export type FilePlace = {
  id: string;
  label: string;
  path: string;
  icon: PlaceIcon;
  builtIn: boolean;
  /** Shown under Pinned on Home: the user's own places, and these built-ins until unpinned. */
  pinned: boolean;
};

type StoredFavorite = {
  label: string;
  path: string;
};

type StoredPlaces = {
  version: 1;
  favorites: StoredFavorite[];
  /** Built-in places the user took off Home's Pinned. */
  unpinned?: string[];
};

/** Built-in places pinned on Home until the user unpins them. */
const PINNED_BY_DEFAULT: ReadonlySet<string> = new Set([
  "documents",
  "pictures",
  "downloads",
  "music",
]);

function configHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function placesFile(): string {
  return path.join(configHome(), "moire", "files-places.json");
}

export function builtInPlaces(): FilePlace[] {
  const home = os.homedir();
  const userDirs = xdgUserDirectories();
  const places: Omit<FilePlace, "pinned">[] = [
    { id: "home", label: "Home", path: home, icon: "home", builtIn: true },
    {
      id: "desktop",
      label: "Desktop",
      path: userDirs.get("DESKTOP") ?? path.join(home, "Desktop"),
      icon: "desktop",
      builtIn: true,
    },
    {
      id: "downloads",
      label: "Downloads",
      path: userDirs.get("DOWNLOAD") ?? path.join(home, "Downloads"),
      icon: "downloads",
      builtIn: true,
    },
    {
      id: "documents",
      label: "Documents",
      path: userDirs.get("DOCUMENTS") ?? path.join(home, "Documents"),
      icon: "document",
      builtIn: true,
    },
    {
      id: "pictures",
      label: "Pictures",
      path: userDirs.get("PICTURES") ?? path.join(home, "Pictures"),
      icon: "image",
      builtIn: true,
    },
    {
      id: "music",
      label: "Music",
      path: userDirs.get("MUSIC") ?? path.join(home, "Music"),
      icon: "music",
      builtIn: true,
    },
  ];
  return places.map((place) => ({ ...place, pinned: PINNED_BY_DEFAULT.has(place.id) }));
}

function favoriteId(favoritePath: string): string {
  return `favorite:${favoritePath}`;
}

function favoriteLabel(label: string, favoritePath: string): string {
  return label.trim() || path.basename(favoritePath) || favoritePath;
}

export function loadPlaces(): FilePlace[] {
  let builtIns = builtInPlaces();
  const usedPaths = new Set(builtIns.map((place) => place.path));
  const favorites: FilePlace[] = [];
  try {
    const stored = JSON.parse(fs.readFileSync(placesFile(), "utf8")) as Partial<StoredPlaces>;
    if (stored.version !== 1 || !Array.isArray(stored.favorites)) {
      return builtIns;
    }
    const unpinned = Array.isArray(stored.unpinned) ? stored.unpinned : [];
    builtIns = builtIns.map((place) => ({
      ...place,
      pinned: place.pinned && !unpinned.includes(place.id),
    }));
    for (const candidate of stored.favorites) {
      if (!candidate || typeof candidate.path !== "string" || typeof candidate.label !== "string") {
        continue;
      }
      const favoritePath = path.resolve(candidate.path);
      if (usedPaths.has(favoritePath)) continue;
      usedPaths.add(favoritePath);
      favorites.push({
        id: favoriteId(favoritePath),
        label: favoriteLabel(candidate.label, favoritePath),
        path: favoritePath,
        icon: "folder",
        builtIn: false,
        pinned: true,
      });
    }
  } catch {
    // Missing and malformed configuration both fall back to built-ins.
  }
  return [...builtIns, ...favorites];
}

export function savePlaces(places: readonly FilePlace[]): void {
  const stored: StoredPlaces = {
    version: 1,
    favorites: places
      .filter((place) => !place.builtIn)
      .map((place) => ({
        label: favoriteLabel(place.label, place.path),
        path: place.path,
      })),
    unpinned: places
      .filter((place) => place.builtIn && PINNED_BY_DEFAULT.has(place.id) && !place.pinned)
      .map((place) => place.id),
  };
  const destination = placesFile();
  const temporary = `${destination}.tmp`;
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, destination);
  } catch (error) {
    console.warn("[files] unable to save places", error);
  }
}

export function addFavorite(places: readonly FilePlace[], favoritePath: string): FilePlace[] {
  const resolved = path.resolve(favoritePath);
  if (places.some((place) => place.path === resolved)) return [...places];
  return [
    ...places,
    {
      id: favoriteId(resolved),
      label: favoriteLabel("", resolved),
      path: resolved,
      icon: "folder",
      builtIn: false,
      pinned: true,
    },
  ];
}

export function normalizePlaceLabels(places: readonly FilePlace[]): FilePlace[] {
  return places.map((place) => ({
    ...place,
    label: favoriteLabel(place.label, place.path),
  }));
}
