/** Music's browsing state and queue edits as pure functions; I/O lives in library.ts. */
import path from "node:path";
import type { Track } from "./library";
import type { QueueData, QueueEntry } from "./queue-store";

export type MusicView = "Albums" | "Artists" | "Songs" | "Recently added";
export const MUSIC_VIEWS: readonly MusicView[] = ["Albums", "Artists", "Songs", "Recently added"];

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: Track[];
  artwork?: string;
};
/** Albums group by performer and album tag; untagged files group by their folder. */
export function albumsFor(tracks: readonly Track[]): Album[] {
  const albums = new Map<string, Album>();
  for (const track of tracks) {
    const id = JSON.stringify([track.artist, track.album || path.dirname(track.path)]);
    let album = albums.get(id);
    if (!album) {
      album = {
        id,
        title: track.album || path.basename(path.dirname(track.path)),
        artist: track.artist,
        year: track.year,
        tracks: [],
        artwork: track.artwork,
      };
      albums.set(id, album);
    }
    album.tracks.push(track);
    if (!album.artwork && track.artwork) album.artwork = track.artwork;
  }
  return [...albums.values()]
    .map((album) => ({
      ...album,
      tracks: album.tracks.sort(
        (a, b) => (a.number || Infinity) - (b.number || Infinity) || a.title.localeCompare(b.title),
      ),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
export const filterTracks = (tracks: readonly Track[], query: string): Track[] => {
  const needle = query.trim().toLocaleLowerCase();
  return tracks.filter((track) =>
    `${track.title}\n${track.artist}\n${track.album}`.toLocaleLowerCase().includes(needle),
  );
};
/** Fisher–Yates; `random` is injectable so the order can be tested. */
export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.floor(random() * (index + 1));
    [result[index], result[next]] = [result[next]!, result[index]!];
  }
  return result;
}
export const artistName = (artist: string) => artist || "Artist not supplied";
/** List key for an artist; the empty (untagged) artist still needs a distinct key. */
export const artistKey = (artist: string) => artist || "artist:not-supplied";

/** An album or artist opened from its list, or the list itself with a keyboard-highlighted row. */
export type Detail =
  | { kind: "list"; highlight: string | null }
  | { kind: "album"; id: string }
  | { kind: "artist"; name: string };
export type Browse = { view: MusicView; query: string; detail: Detail; track: string | null };
const LIST: Detail = { kind: "list", highlight: null };
export const INITIAL_BROWSE: Browse = { view: "Albums", query: "", detail: LIST, track: null };

export const showView = (browse: Browse, view: MusicView): Browse => ({
  ...browse,
  view,
  detail: LIST,
  track: null,
});
export const openAlbum = (browse: Browse, album: Album): Browse => ({
  ...browse,
  detail: { kind: "album", id: album.id },
  track: album.tracks[0]?.id ?? null,
});
export const openArtist = (browse: Browse, name: string): Browse => ({
  ...browse,
  detail: { kind: "artist", name },
  track: null,
});
export const highlight = (browse: Browse, key: string): Browse => ({
  ...browse,
  detail: { kind: "list", highlight: key },
});
export const back = (browse: Browse): Browse => ({ ...browse, detail: LIST, track: null });
/** After an import, show the first imported album with its first track selected. */
export function showImported(imported: readonly Track[]): Browse {
  const album = albumsFor(imported)[0];
  return {
    view: "Albums",
    query: "",
    detail: album ? { kind: "album", id: album.id } : LIST,
    track: imported[0]?.id ?? null,
  };
}

/** What the content pane shows for the library and browsing state. */
export type Content =
  | { kind: "albums"; albums: Album[] }
  | { kind: "artists"; artists: { name: string; count: number }[] }
  | { kind: "album"; album: Album; tracks: Track[] }
  | { kind: "tracks"; tracks: Track[] };
export function browseContent(library: readonly Track[], browse: Browse): Content {
  const matching = filterTracks(library, browse.query);
  const { detail } = browse;
  if (detail.kind === "album") {
    // The album is looked up unfiltered so a search narrows its tracks, not whether it opens.
    const album = albumsFor(library).find((item) => item.id === detail.id);
    if (album) return { kind: "album", album, tracks: filterTracks(album.tracks, browse.query) };
  }
  if (detail.kind === "artist")
    return { kind: "tracks", tracks: matching.filter((track) => track.artist === detail.name) };
  if (browse.view === "Albums") return { kind: "albums", albums: albumsFor(matching) };
  if (browse.view === "Artists") {
    const counts = new Map<string, number>();
    for (const track of matching) counts.set(track.artist, (counts.get(track.artist) ?? 0) + 1);
    return {
      kind: "artists",
      artists: [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  if (browse.view === "Recently added")
    return { kind: "tracks", tracks: [...matching].sort((a, b) => b.addedAt - a.addedAt) };
  return { kind: "tracks", tracks: matching };
}
export const contentTracks = (content: Content): readonly Track[] =>
  content.kind === "album" || content.kind === "tracks" ? content.tracks : [];

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
export function importSummary(imported: number, warnings: readonly string[]): string {
  const skipped = warnings.length
    ? `; ${plural(warnings.length, "item")} skipped: ${warnings[0]}`
    : "";
  return `${plural(imported, "track")} imported${skipped}`;
}

// Queue edits. Entry ids are minted by the caller so these stay deterministic.
export const currentIndex = (queue: QueueData) =>
  Math.max(
    0,
    queue.entries.findIndex((entry) => entry.id === queue.currentEntryId),
  );
export function replaceQueue<Q extends QueueData>(
  queue: Q,
  entries: readonly QueueEntry[],
  start: number,
): Q {
  const current = entries[Math.max(0, Math.min(entries.length - 1, start))];
  return { ...queue, entries, currentEntryId: current?.id ?? null, position: 0 };
}
export const appendToQueue = <Q extends QueueData>(queue: Q, added: readonly QueueEntry[]): Q => ({
  ...queue,
  entries: [...queue.entries, ...added],
  currentEntryId: queue.currentEntryId ?? added[0]?.id ?? null,
});
/** Removing the current entry makes the following one (or the new last one) current. */
export function removeFromQueue<Q extends QueueData>(queue: Q, id: string): Q {
  const index = queue.entries.findIndex((entry) => entry.id === id);
  if (index < 0) return queue;
  const remaining = queue.entries.filter((entry) => entry.id !== id);
  if (queue.currentEntryId !== id) return { ...queue, entries: remaining };
  const replacement = remaining[Math.min(index, remaining.length - 1)];
  return { ...queue, entries: remaining, currentEntryId: replacement?.id ?? null, position: 0 };
}
export const clearUpcoming = <Q extends QueueData>(queue: Q): Q => ({
  ...queue,
  entries: queue.entries.slice(0, currentIndex(queue) + 1),
});
