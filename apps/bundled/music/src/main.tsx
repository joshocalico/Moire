import React, { useEffect, useState, type ReactNode } from "react";
import {
  APP_STATUS_HEIGHT,
  AdaptivePanes,
  AppStatusLine,
  Icon,
  PlaybackBar,
  Surface,
  WindowFrame,
  formatPlaybackTime,
  getUiScaleFactor,
  playbackBarHeight,
  usePalette,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { FileChooser, runApp, startMain, type PlaybackState } from "@moire/app-tools";
import { AUDIO_EXTENSIONS, MusicLibraryStore } from "./library";
import { useMusicPlayback, type MusicPlaybackOptions, type QueueEntry } from "./controller";
import { MusicQueueStore } from "./queue-store";
import {
  INITIAL_BROWSE,
  albumsFor,
  back,
  browseContent,
  contentTracks,
  highlight,
  openAlbum,
  openArtist,
  showImported,
  showView,
  shuffle,
} from "./model";
import { useLibrary } from "./use-library";
import { MusicNavigation } from "./views/navigation";
import { LibraryPane } from "./views/library-pane";
import { ImportPanel } from "./views/import-panel";
import { QueuePane } from "./views/queue-pane";

const APP_ID = "org.moire.Music";
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

/** Adding music: the import panel, or the file chooser opened from it. */
type ImportSheet =
  | { kind: "closed" }
  | { kind: "panel" }
  | { kind: "chooser"; mode: "folder" | "open" };

function MusicContent(props: MusicAppProps): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  const [store] = useState(() => props.store ?? new MusicLibraryStore());
  const [queueStore] = useState(() => props.queueStore ?? new MusicQueueStore(store.directory));
  const library = useLibrary(store);
  const player = useMusicPlayback(props.playbackOptions, queueStore);
  const [browse, setBrowse] = useState(INITIAL_BROWSE);
  const [activePane, setActivePane] = useState("content");
  const [queueOpen, setQueueOpen] = useState(true);
  const [queueSelection, setQueueSelection] = useState<string | null>(null);
  const [confirmingQueueReload, setConfirmingQueueReload] = useState(false);
  const [sheet, setSheet] = useState<ImportSheet>({ kind: "closed" });
  const [importPath, setImportPath] = useState("");

  const tracks = library.library.tracks;
  const content = browseContent(tracks, browse);
  const selected = contentTracks(content).find((track) => track.id === browse.track);

  /** `opening` is a file association: it queues the files paused, never playing unasked. */
  const importPaths = async (values: readonly string[], opening = false) => {
    const imported = await library.importPaths(values);
    if (!imported) return;
    setSheet({ kind: "closed" });
    setBrowse(showImported(imported));
    if (opening) player.play(imported, 0, true);
    setActivePane("content");
  };
  useEffect(() => {
    props.onPlaybackStateChange?.(player.state, player.queue, player.index);
  }, [player.state, player.queue, player.index, props.onPlaybackStateChange]);
  useEffect(() => {
    const values = props.initialPaths ?? (props.initialPath ? [props.initialPath] : []);
    if (values.length) void importPaths(values, true);
  }, []);

  const openImport = () => {
    setSheet({ kind: "panel" });
    setActivePane("content");
  };
  const removeSelected = () => {
    if (selected && library.remove(selected)) setBrowse({ ...browse, track: null });
  };
  const statusHeight = Math.round(APP_STATUS_HEIGHT * ui);
  const footerHeight = playbackBarHeight(props.width);
  const bodyHeight = Math.max(1, props.height - footerHeight - statusHeight);
  const failure =
    library.error ||
    (player.queueSaveError ? `Queue not saved: ${player.queueSaveError}` : "") ||
    player.error ||
    (player.state.kind === "error" ? player.state.message : "");
  const ready = player.state.kind === "ready" ? player.state : null;
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
          render: (size) => (
            <MusicNavigation
              {...size}
              view={browse.view}
              busy={library.busy}
              albumCount={albumsFor(tracks).length}
              trackCount={tracks.length}
              onView={(view) => {
                setBrowse(showView(browse, view));
                setActivePane("content");
              }}
              onImport={openImport}
              onReload={library.reload}
            />
          ),
        }}
        content={{
          id: "content",
          title: "Music",
          minWidth: 400 * ui,
          render: (size) => (
            <LibraryPane
              {...size}
              browse={browse}
              content={content}
              hasLibrary={tracks.length > 0}
              busy={library.busy}
              selected={selected}
              sheet={
                sheet.kind === "closed"
                  ? undefined
                  : (area) => (
                      <ImportPanel
                        {...area}
                        path={importPath}
                        busy={library.busy}
                        onPath={setImportPath}
                        onChoose={(mode) => setSheet({ kind: "chooser", mode })}
                        onImport={() => void importPaths([importPath])}
                        onCancel={() => {
                          library.cancelImport();
                          setSheet({ kind: "closed" });
                        }}
                      />
                    )
              }
              onQuery={(query) => setBrowse({ ...browse, query })}
              onBack={() => setBrowse(back(browse))}
              onImport={openImport}
              onOpenAlbum={(album) => {
                setBrowse(openAlbum(browse, album));
                setActivePane("content");
              }}
              onHighlight={(key) => setBrowse(highlight(browse, key))}
              onOpenArtist={(artist) => setBrowse(openArtist(browse, artist))}
              onSelectTrack={(track) => setBrowse({ ...browse, track: track.id })}
              onPlay={(list, start) => player.play(list, start)}
              onShuffle={(list) => player.play(shuffle(list))}
              onEnqueue={(list, showQueue) => {
                player.enqueue(list);
                if (showQueue) setQueueOpen(true);
              }}
              onRemove={removeSelected}
            />
          ),
        }}
        accessory={{
          id: "queue",
          title: "Queue",
          preferredWidth: 280 * ui,
          minWidth: 240 * ui,
          render: (size) => (
            <QueuePane
              {...size}
              player={player}
              selection={queueSelection}
              confirmingReload={confirmingQueueReload}
              onSelection={setQueueSelection}
              onConfirmReload={setConfirmingQueueReload}
              onClose={() => {
                setQueueOpen(false);
                setActivePane("content");
              }}
            />
          ),
          open: queueOpen,
          onClose: () => setQueueOpen(false),
        }}
        activePaneId={activePane}
        onActivePaneChange={setActivePane}
      />
      <AppStatusLine
        y={bodyHeight}
        width={props.width}
        status={
          failure ||
          library.message ||
          "Local library · Double-click a track or press Enter to play"
        }
        tone={failure ? "error" : undefined}
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
      {sheet.kind === "chooser" ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode={sheet.mode}
          appId={APP_ID}
          title={sheet.mode === "folder" ? "Choose a music folder" : "Choose an audio file"}
          // In folder mode this only steers the chooser to start in ~/Music.
          accept={AUDIO_EXTENSIONS}
          onChoose={(chosen) => {
            setSheet({ kind: "panel" });
            void importPaths([chosen]);
          }}
          onCancel={() => setSheet({ kind: "panel" })}
        />
      ) : null}
    </Surface>
  );
}

startMain(import.meta.url, () =>
  runApp(
    "Music",
    APP_ID,
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
