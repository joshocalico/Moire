import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addFavorite, loadPlaces, normalizePlaceLabels, savePlaces } from "./places";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "moire-files-places-"));
const originalConfigHome = process.env.XDG_CONFIG_HOME;

try {
  process.env.XDG_CONFIG_HOME = temporary;
  fs.writeFileSync(
    path.join(temporary, "user-dirs.dirs"),
    'XDG_DESKTOP_DIR="$HOME/Desk"\nXDG_DOWNLOAD_DIR="$HOME/Incoming"\n',
  );
  const initial = loadPlaces();
  assert.deepEqual(
    initial.map((place) => place.id),
    ["home", "desktop", "downloads", "documents", "pictures", "music"],
  );
  assert.equal(initial[1]?.path, path.join(os.homedir(), "Desk"));
  assert.equal(initial[2]?.path, path.join(os.homedir(), "Incoming"));

  const projectPath = path.join(os.homedir(), "Projects", "Moire");
  const withFavorite = addFavorite(initial, projectPath);
  assert.equal(withFavorite.length, 7);
  assert.equal(withFavorite[6]?.label, "Moire");
  savePlaces(withFavorite);

  const reloaded = loadPlaces();
  assert.equal(reloaded[6]?.path, projectPath);
  assert.equal(reloaded[6]?.builtIn, false);

  const renamed = normalizePlaceLabels(
    reloaded.map((place) =>
      place.path === projectPath ? { ...place, label: "Workspace" } : place,
    ),
  );
  savePlaces(renamed);
  assert.equal(loadPlaces()[6]?.label, "Workspace");

  const deduplicated = addFavorite(renamed, projectPath);
  assert.equal(deduplicated.length, renamed.length);

  // Home's Pinned: four built-ins and the user's places, until a built-in is unpinned.
  assert.deepEqual(
    loadPlaces()
      .filter((place) => place.pinned)
      .map((place) => place.id),
    ["downloads", "documents", "pictures", "music", `favorite:${projectPath}`],
  );
  savePlaces(
    loadPlaces().map((place) => (place.id === "pictures" ? { ...place, pinned: false } : place)),
  );
  assert.equal(loadPlaces().find((place) => place.id === "pictures")?.pinned, false);
  assert.equal(loadPlaces().length, 7, "an unpinned place stays on the rail");
  console.log("[files/places-smoke] ok");
} finally {
  if (originalConfigHome == null) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  fs.rmSync(temporary, { recursive: true, force: true });
}
