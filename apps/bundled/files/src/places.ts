import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PlaceIcon = "home" | "desktop" | "downloads" | "folder";

export type FilePlace = {
  id: string;
  label: string;
  path: string;
  icon: PlaceIcon;
  builtIn: boolean;
};

type StoredFavorite = {
  label: string;
  path: string;
};

type StoredPlaces = {
  version: 1;
  favorites: StoredFavorite[];
};

function configHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function placesFile(): string {
  return path.join(configHome(), "moire", "files-places.json");
}

function xdgUserDirectories(): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const source = fs.readFileSync(
      path.join(configHome(), "user-dirs.dirs"),
      "utf8",
    );
    for (const line of source.split(/\r?\n/)) {
      const match = /^XDG_([A-Z]+)_DIR="(.*)"$/.exec(line.trim());
      if (!match) continue;
      const expanded = match[2]!.replace(/^\$HOME(?=\/|$)/, os.homedir());
      result.set(match[1]!, path.resolve(expanded));
    }
  } catch {
    // user-dirs.dirs is optional; conventional locations remain useful.
  }
  return result;
}

export function builtInPlaces(): FilePlace[] {
  const home = os.homedir();
  const userDirs = xdgUserDirectories();
  return [
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
  ];
}

function favoriteId(favoritePath: string): string {
  return `favorite:${favoritePath}`;
}

function favoriteLabel(label: string, favoritePath: string): string {
  return label.trim() || path.basename(favoritePath) || favoritePath;
}

export function loadPlaces(): FilePlace[] {
  const builtIns = builtInPlaces();
  const usedPaths = new Set(builtIns.map((place) => place.path));
  const favorites: FilePlace[] = [];
  try {
    const stored = JSON.parse(
      fs.readFileSync(placesFile(), "utf8"),
    ) as Partial<StoredPlaces>;
    if (stored.version !== 1 || !Array.isArray(stored.favorites)) {
      return builtIns;
    }
    for (const candidate of stored.favorites) {
      if (
        !candidate ||
        typeof candidate.path !== "string" ||
        typeof candidate.label !== "string"
      ) {
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
  };
  const destination = placesFile();
  const temporary = `${destination}.tmp`;
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, destination);
  } catch (error) {
    console.warn("[files] unable to save sidebar places", error);
  }
}

export function addFavorite(
  places: readonly FilePlace[],
  favoritePath: string,
): FilePlace[] {
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
    },
  ];
}

export function normalizePlaceLabels(
  places: readonly FilePlace[],
): FilePlace[] {
  return places.map((place) => ({
    ...place,
    label: favoriteLabel(place.label, place.path),
  }));
}
