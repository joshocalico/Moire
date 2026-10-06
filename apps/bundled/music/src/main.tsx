import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AdaptivePanes,
  Button,
  CollectionList,
  CollectionRow,
  Column,
  ContentCard,
  ImageWidget,
  Icon,
  WindowFrame,
  type WindowActions,
  Label,
  PlaybackBar,
  Row,
  ScrollColumn,
  Surface,
  TextField,
  formatPlaybackTime,
  getUiScaleFactor,
  playbackBarHeight,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { errorText, runApp, startMain, type PlaybackState } from "@moire/app-tools";
import {
  albumsFor,
  filterTracks,
  importMusic,
  MusicLibraryStore,
  type Album,
  type Library,
  type Track,
} from "./library";
import { useMusicPlayback, type MusicPlaybackOptions, type QueueEntry } from "./controller";
import { MusicQueueStore } from "./queue-store";
export const MUSIC_WINDOW_OPTIONS = { decorated: false, width: 1020, height: 700 };
export type MusicAppProps = WindowSize & {
  windowActions?: WindowActions;
  initialPath?: string;
  initialPaths?: string[];
  store?: MusicLibraryStore;
  queueStore?: MusicQueueStore;
  playbackOptions?: MusicPlaybackOptions;
  onPlaybackStateChange?: (
    state: PlaybackState,
    queue: readonly QueueEntry[],
    index: number,
  ) => void;
};
import { MusicNavigation, type MusicView } from "./navigation";
function shuffle(tracks: readonly Track[]): Track[] {
  const result = [...tracks];
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.floor(Math.random() * (index + 1));
    [result[index], result[next]] = [result[next]!, result[index]!];
  }
  return result;
}
export function MusicApp(props: MusicAppProps): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  return (
    <WindowFrame
      width={props.width}
      height={props.height}
      title="Music"
      actions={props.windowActions}
      icon={<Icon name="music" symbolic size={20 * ui} color={pal.accent} />}
    >
      {(size) => <MusicContent {...props} {...size} />}
    </WindowFrame>
  );
}
function MusicContent(props: MusicAppProps): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  const [store] = useState(() => props.store ?? new MusicLibraryStore());
  const [library, setLibrary] = useState<Library>(() => {
    try {
      return store.load();
    } catch {
      return { tracks: [], revision: null };
    }
  });
  const [error, setError] = useState(() => {
    try {
      store.load();
      return "";
    } catch (error) {
      return errorText(error);
    }
  });
  const [message, setMessage] = useState("");
  const [view, setView] = useState<MusicView>("Albums"),
    [query, setQuery] = useState("");
  const [albumId, setAlbumId] = useState<string | null>(null),
    [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(true),
    [queueSelection, setQueueSelection] = useState<string | null>(null);
  const [activePane, setActivePane] = useState("content"),
    [importOpen, setImportOpen] = useState(false),
    [importPath, setImportPath] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null),
    alive = useRef(true);
  const [queueStore] = useState(() => props.queueStore ?? new MusicQueueStore(store.directory));
  const player = useMusicPlayback(props.playbackOptions, queueStore);
  const [reloadQueueConfirmation, setReloadQueueConfirmation] = useState(false);
  useEffect(() => {
    props.onPlaybackStateChange?.(player.state, player.queue, player.index);
  }, [player.state, player.queue, player.index, props.onPlaybackStateChange]);
  const tracks = filterTracks(library.tracks, query),
    albums = albumsFor(tracks);
  const album = albumId
    ? albumsFor(library.tracks).find((album) => album.id === albumId)
    : undefined;
  const artists = [...new Set(tracks.map((track) => track.artist))].sort((a, b) =>
    a.localeCompare(b),
  );
  const visibleTracks = album
    ? filterTracks(album.tracks, query)
    : view === "Artists" && selectedArtist !== null
      ? tracks.filter((track) => track.artist === selectedArtist)
      : view === "Recently added"
        ? [...tracks].sort((a, b) => b.addedAt - a.addedAt)
        : tracks;
  const chosen = visibleTracks.find((track) => track.id === selectedTrack);
  const importPaths = async (values: readonly string[], initial = false) => {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setMessage("Reading local music…");
    try {
      const result = await importMusic(values, store, controller.signal, (done, total) => {
        if (alive.current) setMessage(`Reading music ${done} of ${total}…`);
      });
      if (!alive.current) return;
      setLibrary(result.library);
      setImportOpen(false);
      setQuery("");
      setView("Albums");
      setAlbumId(albumsFor(result.imported)[0]?.id ?? null);
      setSelectedTrack(result.imported[0]?.id ?? null);
      setMessage(
        `${result.imported.length} track${result.imported.length === 1 ? "" : "s"} imported${result.warnings.length ? `; ${result.warnings.length} item${result.warnings.length === 1 ? "" : "s"} skipped: ${result.warnings[0]}` : ""}`,
      );
      if (initial) player.play(result.imported, 0, true); // File association opens paused; no unsolicited audio.
      setActivePane("content");
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setError(errorText(error));
    } finally {
      if (abort.current === controller) abort.current = null;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    const values = props.initialPaths ?? (props.initialPath ? [props.initialPath] : []);
    if (values.length) void importPaths(values, true);
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  const reload = () => {
    try {
      setLibrary(store.load());
      setError("");
      setMessage("Library reloaded");
    } catch (error) {
      setError(errorText(error));
    }
  };
  const removeLibraryTrack = () => {
    if (!chosen) return;
    try {
      setLibrary(
        store.save({
          ...library,
          tracks: library.tracks.filter((track) => track.id !== chosen.id),
        }),
      );
      setSelectedTrack(null);
      setMessage("Removed from the library. The original audio file remains in place.");
    } catch (error) {
      setError(errorText(error));
    }
  };
  const ready = player.state.kind === "ready" ? player.state : null;
  const footerHeight = playbackBarHeight(props.width);
  const statusHeight = 32 * ui,
    bodyHeight = Math.max(1, props.height - footerHeight - statusHeight);
  const showAlbum = (album: Album) => {
    setAlbumId(album.id);
    setSelectedTrack(album.tracks[0]?.id ?? null);
    setActivePane("content");
  };
  const trackRows = (size: WindowSize, items: readonly Track[], height: number) => (
    <CollectionList
      width={size.width}
      height={Math.max(1, height)}
      items={items}
      getKey={(track) => track.id}
      rowHeight={44 * ui}
      selectedKey={selectedTrack}
      onSelect={(track) => setSelectedTrack(track.id)}
      onActivate={(track) =>
        player.play(
          items,
          items.findIndex((item) => item.id === track.id),
        )
      }
      focusId="music:tracks"
      emptyMessage={query ? "No tracks match your search" : "No tracks in this view"}
      renderItem={(track, state) => (
        <CollectionRow
          {...state}
          title={`${track.number || items.indexOf(track) + 1}   ${track.title}`}
          metadata={track.duration ? formatPlaybackTime(track.duration) : "—"}
        />
      )}
    />
  );
  const renderNavigation = (size: WindowSize) => (
    <MusicNavigation
      {...size}
      view={view}
      busy={busy}
      albumCount={albumsFor(library.tracks).length}
      trackCount={library.tracks.length}
      onView={(view) => {
        setView(view);
        setAlbumId(null);
        setSelectedArtist(null);
        setSelectedTrack(null);
        setActivePane("content");
      }}
      onImport={() => {
        setImportOpen(true);
        setActivePane("content");
      }}
      onReload={reload}
    />
  );
  const renderContent = (size: WindowSize) => {
    const compact = size.width < 650 * ui;
    const heroHeight = (compact ? 204 : 320) * ui;
    const trackHeight = Math.max(180 * ui, size.height - 54 * ui - heroHeight - 68 * ui);
    return (
      <Surface {...size} fill={pal.bg} clip>
        <Row width={size.width} height={54 * ui} padding={12 * ui} gap={10 * ui} align="center">
          {album || selectedArtist !== null ? (
            <Button
              label={album ? "Albums" : "Artists"}
              variant="ghost"
              size="small"
              leadingIcon={<Icon name="back" symbolic size={16} />}
              focusId="music:back"
              onPress={() => {
                setAlbumId(null);
                setSelectedArtist(null);
                setSelectedTrack(null);
              }}
            />
          ) : (
            <Label
              width={Math.max(72 * ui, size.width * 0.3)}
              text={view}
              fontSize={12}
              color={pal.muted}
              maxLines={1}
              overflow="ellipsis"
            />
          )}
          <TextField
            width={Math.max(80 * ui, size.width * 0.7 - 40 * ui)}
            height={32 * ui}
            value={query}
            onChange={setQuery}
            placeholder="Search your library"
          />
        </Row>
        {importOpen ? (
          <ScrollColumn
            y={54 * ui}
            width={size.width}
            height={size.height - 54 * ui}
            padding={20 * ui}
            gap={14 * ui}
          >
            <Label text="Import local music" fontSize={24} fontWeight="medium" />
            <Label
              text="Enter a local audio file, file URL or folder. Folders are scanned recursively; your original files remain in place. Metadata and artwork come from those files."
              wrap
              fontSize={13}
            />
            <TextField
              width={Math.max(1, size.width - 40 * ui)}
              value={importPath}
              onChange={setImportPath}
              placeholder="Local audio file or folder"
              autoFocus
              onSubmit={() => {
                if (!busy) void importPaths([importPath]);
              }}
            />
            <Row height={40 * ui} gap={8 * ui}>
              <Button
                label={busy ? "Importing…" : "Import"}
                variant="primary"
                disabled={busy || !importPath.trim()}
                focusId="music:confirm-import"
                onPress={() => void importPaths([importPath])}
              />
              <Button
                label={busy ? "Cancel import" : "Cancel"}
                onPress={() => {
                  abort.current?.abort();
                  setImportOpen(false);
                }}
              />
            </Row>
          </ScrollColumn>
        ) : !library.tracks.length ? (
          <ScrollColumn
            y={54 * ui}
            width={size.width}
            height={size.height - 54 * ui}
            padding={24 * ui}
            gap={16 * ui}
          >
            <Label text="Import your music" fontSize={28} fontWeight="medium" wrap />
            <Label
              text="Import an album or your music folder to browse artists and tracks. Music reads local tags and duration, and keeps a library between sessions."
              fontSize={14}
              wrap
            />
            <Button
              label="Import music…"
              focusId="music:empty-import"
              disabled={busy}
              variant="primary"
              onPress={() => setImportOpen(true)}
            />
          </ScrollColumn>
        ) : album ? (
          <ScrollColumn
            key={`album:${album.id}`}
            y={54 * ui}
            width={size.width}
            height={Math.max(1, size.height - 54 * ui)}
            gap={0}
          >
            <ContentCard width={size.width} fill={pal.bg} padding={16 * ui} gap={12 * ui}>
              <Row width={size.width - 32 * ui} height={(compact ? 120 : 236) * ui} gap={20 * ui}>
                {album.artwork ? (
                  <ImageWidget
                    width={(compact ? 96 : 220) * ui}
                    height={(compact ? 96 : 220) * ui}
                    src={album.artwork}
                    fit="cover"
                  />
                ) : (
                  <Surface
                    width={(compact ? 96 : 220) * ui}
                    height={(compact ? 96 : 220) * ui}
                    fill={pal.surface}
                  >
                    <Label
                      width={(compact ? 96 : 220) * ui}
                      height={(compact ? 96 : 220) * ui}
                      text="ALBUM"
                      color={pal.muted}
                      fontSize={11}
                      horizontalAlign="center"
                      verticalAlign="center"
                    />
                  </Surface>
                )}
                <Column
                  width={Math.max(1, size.width - (compact ? 148 : 272) * ui)}
                  gap={(compact ? 6 : 8) * ui}
                >
                  <Label text="ALBUM" fontSize={10} color={pal.muted} />
                  <Label
                    text={album.title}
                    fontSize={compact ? 22 : 40}
                    fontWeight="medium"
                    wrap
                    maxLines={2}
                    overflow="ellipsis"
                  />
                  <Label
                    text={album.artist || "Artist not supplied"}
                    fontSize={15}
                    maxLines={1}
                    overflow="ellipsis"
                  />
                  <Label
                    text={`${album.year ? `${album.year.slice(0, 4)} · ` : ""}${album.tracks.length} tracks · ${formatPlaybackTime(album.tracks.reduce((sum, track) => sum + track.duration, 0))}`}
                    fontSize={11}
                    color={pal.muted}
                    wrap
                  />
                </Column>
              </Row>
              <Row width={size.width - 32 * ui} height={40 * ui} gap={8 * ui}>
                <Button
                  label="Play album"
                  variant="primary"
                  focusId="music:play-album"
                  disabled={!visibleTracks.length}
                  onPress={() => player.play(visibleTracks)}
                />
                <Button
                  label="Shuffle"
                  disabled={!visibleTracks.length}
                  onPress={() => player.play(shuffle(visibleTracks))}
                />
                <Button
                  label="Add to queue"
                  focusId="music:add-album-to-queue"
                  disabled={!visibleTracks.length}
                  onPress={() => {
                    player.enqueue(visibleTracks);
                    setQueueOpen(true);
                  }}
                />
              </Row>
            </ContentCard>
            <Label
              x={14 * ui}
              width={size.width - 28 * ui}
              height={26 * ui}
              text="TRACKS"
              fontSize={10}
              color={pal.muted}
              maxLines={1}
              overflow="ellipsis"
            />
            <Surface width={size.width} height={trackHeight} fill={pal.bg}>
              {trackRows(size, visibleTracks, trackHeight)}
            </Surface>
            <Row width={size.width} height={42 * ui} padding={8 * ui} gap={8 * ui}>
              <Button
                label="Play selected"
                size="small"
                disabled={!chosen}
                onPress={() => {
                  if (chosen) player.play(visibleTracks, visibleTracks.indexOf(chosen));
                }}
              />
              <Button
                label="Remove from library"
                size="small"
                disabled={!chosen || busy}
                onPress={removeLibraryTrack}
              />
            </Row>
          </ScrollColumn>
        ) : view === "Albums" ? (
          <CollectionList
            x={8 * ui}
            y={54 * ui}
            width={size.width - 16 * ui}
            height={size.height - 54 * ui}
            items={albums}
            getKey={(album) => album.id}
            selectedKey={albumId}
            rowHeight={76 * ui}
            onSelect={showAlbum}
            onActivate={showAlbum}
            focusId="music:albums"
            emptyMessage="No albums match your search"
            renderItem={(album, state) => (
              <CollectionRow
                {...state}
                title={album.title}
                subtitle={`${album.artist || "Artist not supplied"} · ${album.tracks.length} tracks`}
                leading={
                  album.artwork ? (
                    <ImageWidget width={40 * ui} height={40 * ui} src={album.artwork} fit="cover" />
                  ) : undefined
                }
              />
            )}
          />
        ) : view === "Artists" && selectedArtist === null ? (
          <CollectionList
            y={54 * ui}
            width={size.width}
            height={size.height - 54 * ui}
            items={artists}
            getKey={(artist) => artist || "artist:not-supplied"}
            selectedKey={selectedArtist}
            onSelect={(artist) => {
              setSelectedArtist(artist);
              setSelectedTrack(null);
            }}
            focusId="music:artists"
            renderItem={(artist, state) => (
              <CollectionRow
                {...state}
                title={artist || "Artist not supplied"}
                subtitle={`${tracks.filter((track) => track.artist === artist).length} tracks`}
              />
            )}
          />
        ) : (
          <Surface y={54 * ui} width={size.width} height={size.height - 54 * ui} fill={pal.bg}>
            <Row width={size.width} height={46 * ui} padding={8 * ui} gap={8 * ui}>
              <Button
                label="Play all"
                size="small"
                disabled={!visibleTracks.length}
                onPress={() => player.play(visibleTracks)}
              />
              <Button
                label="Add to queue"
                focusId="music:add-view-to-queue"
                size="small"
                disabled={!visibleTracks.length}
                onPress={() => player.enqueue(visibleTracks)}
              />
              <Button
                label="Remove selected"
                size="small"
                disabled={!chosen || busy}
                focusId="music:remove-selected"
                onPress={removeLibraryTrack}
              />
            </Row>
            <Surface
              y={46 * ui}
              width={size.width}
              height={Math.max(1, size.height - 100 * ui)}
              fill={pal.bg}
            >
              {trackRows(size, visibleTracks, size.height - 100 * ui)}
            </Surface>
          </Surface>
        )}
      </Surface>
    );
  };
  const renderQueue = (size: WindowSize) => (
    <Surface {...size} fill={pal.panel} clip>
      <Row width={size.width} height={52 * ui} padding={12 * ui} gap={8 * ui}>
        <Label
          width={Math.max(20 * ui, size.width - 84 * ui)}
          text="Queue"
          fontSize={18}
          fontWeight="medium"
        />
        <Button
          label="Close"
          size="small"
          onPress={() => {
            setQueueOpen(false);
            setActivePane("content");
          }}
        />
      </Row>
      <Label
        x={14 * ui}
        y={54 * ui}
        width={size.width - 28 * ui}
        height={24 * ui}
        fontSize={11}
        color={pal.muted}
        text={`${Math.max(0, player.queue.length - player.index - 1)} tracks remaining`}
      />
      <ScrollColumn
        y={86 * ui}
        width={size.width}
        height={Math.max(1, size.height - 86 * ui)}
        gap={8 * ui}
      >
        {player.state.kind === "error" && player.entry && (
          <Column width={size.width} padding={12 * ui} gap={8 * ui}>
            <Label text={`Cannot play this entry: ${player.state.message}`} fontSize={12} wrap />
            <Button
              label="Remove current entry"
              focusId="music:remove-unavailable"
              onPress={() => {
                if (player.entry) player.remove(player.entry.id);
              }}
            />
            {player.next && (
              <Button label="Next entry" focusId="music:skip-unavailable" onPress={player.next} />
            )}
          </Column>
        )}
        {player.stopped && player.entry && (
          <Column width={size.width} padding={12 * ui} gap={8 * ui}>
            <Label
              text={player.restored ? "Saved queue · Playback is stopped" : "Playback is stopped"}
              fontSize={11}
              color={pal.muted}
              wrap
            />
            <Button
              label={`Resume at ${formatPlaybackTime(player.position)}`}
              focusId="music:resume-queue"
              variant="primary"
              onPress={player.togglePause}
            />
          </Column>
        )}
        {(player.queueSaveError || player.queueSaveWarning) && (
          <Column width={size.width} padding={12 * ui} gap={8 * ui}>
            <Label
              text={
                player.queueSaveError
                  ? `Queue not saved: ${player.queueSaveError}`
                  : `Queue saved; cleanup pending: ${player.queueSaveWarning}`
              }
              fontSize={12}
              wrap
            />
            <Button
              label="Retry save"
              focusId="music:retry-queue-save"
              onPress={player.retrySave}
            />
            <Button
              label="Reload saved queue…"
              focusId="music:reload-queue"
              onPress={() => setReloadQueueConfirmation(true)}
            />
            {reloadQueueConfirmation && (
              <>
                <Label
                  text="Discard this window's queue draft and stop playback?"
                  fontSize={12}
                  wrap
                />
                <Button
                  label="Discard draft and reload"
                  focusId="music:confirm-reload-queue"
                  onPress={() => {
                    player.reloadSavedQueue();
                    setReloadQueueConfirmation(false);
                    setQueueSelection(null);
                  }}
                />
                <Button
                  label="Keep draft"
                  focusId="music:cancel-reload-queue"
                  onPress={() => setReloadQueueConfirmation(false)}
                />
              </>
            )}
          </Column>
        )}
        <CollectionList
          width={size.width}
          height={Math.max(1, size.height - 186 * ui)}
          items={player.queue}
          getKey={(entry) => entry.id}
          selectedKey={queueSelection ?? player.entry?.id}
          onSelect={(entry) => setQueueSelection(entry.id)}
          onActivate={(entry) => player.jump(player.queue.indexOf(entry))}
          focusId="music:queue"
          emptyMessage="Queue is empty. Play an album or add tracks."
          rowHeight={72 * ui}
          renderItem={(entry, state) => (
            <CollectionRow
              {...state}
              title={entry.track.title}
              subtitle={`${entry === player.entry ? "Current · " : ""}${entry.track.artist || "Artist not supplied"}`}
              metadata={entry.track.duration ? formatPlaybackTime(entry.track.duration) : "—"}
              leading={
                entry.track.artwork ? (
                  <ImageWidget
                    width={40 * ui}
                    height={40 * ui}
                    src={entry.track.artwork}
                    fit="cover"
                  />
                ) : undefined
              }
            />
          )}
        />
        <Column x={12 * ui} width={size.width - 24 * ui} height={86 * ui} gap={6 * ui}>
          <Button
            label="Remove selected"
            focusId="music:remove-queue-selected"
            size="small"
            disabled={!queueSelection || !player.queue.some((entry) => entry.id === queueSelection)}
            onPress={() => {
              if (queueSelection) player.remove(queueSelection);
              setQueueSelection(null);
            }}
          />
          <Button
            label="Clear upcoming"
            size="small"
            disabled={player.queue.length <= player.index + 1}
            onPress={player.clearUpcoming}
          />
        </Column>
      </ScrollColumn>
    </Surface>
  );
  return (
    <Surface {...props} fill={pal.bg}>
      <AdaptivePanes
        width={props.width}
        height={bodyHeight}
        navigation={{
          id: "navigation",
          title: "Library",
          preferredWidth: 208 * ui,
          minWidth: 170 * ui,
          render: renderNavigation,
        }}
        content={{ id: "content", title: "Music", minWidth: 400 * ui, render: renderContent }}
        accessory={{
          id: "queue",
          title: "Queue",
          preferredWidth: 280 * ui,
          minWidth: 240 * ui,
          render: renderQueue,
          open: queueOpen,
          onClose: () => setQueueOpen(false),
        }}
        activePaneId={activePane}
        onActivePaneChange={setActivePane}
      />
      <Label
        x={12 * ui}
        y={bodyHeight + 4 * ui}
        width={props.width - 24 * ui}
        height={24 * ui}
        fontSize={11}
        color={
          error || player.error || player.queueSaveError || player.state.kind === "error"
            ? pal.accent
            : pal.muted
        }
        text={
          error ||
          (player.queueSaveError ? `Queue not saved: ${player.queueSaveError}` : "") ||
          player.error ||
          (player.state.kind === "error"
            ? player.state.message
            : message || "Local library · Double-click a track or press Enter to play")
        }
        maxLines={1}
        overflow="ellipsis"
      />
      <PlaybackBar
        y={props.height - footerHeight}
        width={props.width}
        title={player.entry?.track.title}
        subtitle={player.entry?.track.artist}
        artwork={player.entry?.track.artwork}
        canPlay={!!player.entry && player.state.kind !== "opening"}
        status={
          player.state.kind === "opening"
            ? "Opening audio…"
            : player.stopped && player.entry
              ? `Stopped · Resume at ${formatPlaybackTime(player.position)}`
              : undefined
        }
        ready={!!ready}
        paused={ready?.paused ?? true}
        position={ready?.position ?? player.position}
        duration={ready?.duration ?? player.entry?.track.duration ?? 0}
        volume={ready?.volume ?? 100}
        onTogglePause={player.togglePause}
        onPrevious={player.previous}
        onNext={player.next}
        onStop={player.stop}
        onSeek={player.seek}
        onVolume={player.volume}
        onQueue={() => {
          setQueueOpen(true);
          setActivePane("queue");
        }}
        queueOpen={queueOpen}
      />
    </Surface>
  );
}
startMain(import.meta.url, () =>
  runApp(
    "Music",
    "org.moire.Music",
    (size, window) => (
      <MusicApp
        {...size}
        windowActions={window}
        initialPaths={process.argv.slice(2).filter((value) => !value.startsWith("-"))}
      />
    ),
    MUSIC_WINDOW_OPTIONS,
  ),
);
