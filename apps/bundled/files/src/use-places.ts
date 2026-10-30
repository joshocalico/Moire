/** The rail's places: built-in XDG folders plus the user's own, editable and persisted. */
import fs from "node:fs";
import { useEffect, useState } from "react";
import {
  addFavorite,
  loadPlaces,
  normalizePlaceLabels,
  savePlaces,
  type FilePlace,
} from "./places";

export function usePlaces() {
  const [places, setPlaces] = useState<FilePlace[]>(loadPlaces);
  // Built-in places always exist, so choosing one never lands on an error.
  useEffect(() => {
    for (const place of places)
      if (place.builtIn) fs.mkdir(place.path, { recursive: true }, () => {});
  }, [places]);
  const store = (next: FilePlace[]) => {
    const normalized = normalizePlaceLabels(next);
    setPlaces(normalized);
    savePlaces(normalized);
  };
  /** Built-in places keep their order; only custom places move, among themselves. */
  const target = (id: string, direction: -1 | 1) => {
    const index = places.findIndex((place) => place.id === id);
    const next = places[index + direction];
    return index < 0 || places[index]?.builtIn || !next || next.builtIn ? -1 : index + direction;
  };
  return {
    places,
    isPinned: (directory: string) => places.some((place) => place.path === directory),
    pin: (directory: string) => store(addFavorite(places, directory)),
    remove: (id: string) => store(places.filter((place) => place.builtIn || place.id !== id)),
    /** Off Home's Pinned: a built-in place stays on the rail, the user's own goes. */
    unpin: (id: string) =>
      store(
        places.flatMap((place) =>
          place.id !== id ? [place] : place.builtIn ? [{ ...place, pinned: false }] : [],
        ),
      ),
    rename: (id: string, label: string) =>
      store(places.map((place) => (place.id === id ? { ...place, label } : place))),
    moves: (id: string) => ({ up: target(id, -1) >= 0, down: target(id, 1) >= 0 }),
    move: (id: string, direction: -1 | 1) => {
      const to = target(id, direction);
      if (to < 0) return;
      const next = [...places];
      const [moving] = next.splice(to - direction, 1);
      next.splice(to, 0, moving!);
      store(next);
    },
  };
}
