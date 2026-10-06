/**
 * Moire Files — Places + grid/list browser composed from @moire/ui only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Application,
  Window,
  WindowFrame,
  Tabs,
  AdaptivePanes,
  NavigationSidebar,
  Table,
  Horizontal,
  Box,
  Measure,
  Inset,
  TextBlock,
  type WindowActions,
  Column,
  Row,
  Label,
  Button,
  IconButton,
  ImageWidget,
  EmptyState,
  SearchField,
  StatusBar,
  ShortcutManager,
  Surface,
  Dialog,
  FocusScope,
  ModalBarrier,
  Separator,
  TextField,
  Grid,
  GridItem,
  Icon,
  DropTarget,
  CollectionItem,
  ContextMenuTrigger,
  ContextMenu,
  contextMenuSurfaceSize,
  PathBar,
  usePalette,
  getUiScaleFactor,
  setUiScaleFactor,
  hitTestDropData,
  SPACE,
  type WindowSize,
  type IconName,
  type ContextMenuAction,
  type PopupHandle,
  type BreadcrumbSegment,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import {
  ContextActionRegistry,
  FileActivationPortalClient,
  FileActivationService,
  type FileActionContext,
} from "@moire/app-discovery";
import {
  addFavorite,
  builtInPlaces,
  loadPlaces,
  normalizePlaceLabels,
  savePlaces,
  type FilePlace,
} from "./places";
import { formatBytes } from "./format";
import { pathsFromUriList, pathsToUriList } from "./uris";
import { FileLauncher, launchFailureNotice } from "./activation";
import { filesLayout } from "./layout";
import {
  createFolderTab,
  tabDirectory,
  navigateFolderTab,
  travelFolderTab,
  useFolderTabSelection,
  type FolderTab,
} from "./navigation";
import { FileCatalog, parseTags } from "./catalog";
import { FileInspector } from "./inspector";
import { TransferDialog, type TransferDisplay, type TransferConflict } from "./transfer-dialog";
import { remainingCutPaths } from "./cut-clipboard";
import { executeTransfer, transferOutcomeNotice, transferRequest } from "./transfer-outcome";
import { transferDestinationFolder } from "./transfer-metadata";
import { RemovableDriveRow } from "./removable-drive-row";
import {
  RemovableDriveController,
  DRIVES_UNAVAILABLE,
  mountedRoots,
  storageVolumes,
  storageCaption,
  canDriveAction,
  driveOperationBlocked,
  isWithinMount,
  retireDrivePaths,
  type FilesStorageClient,
} from "./removable-drives";
import { connectStorageStatus, type StorageVolume } from "@moire/system-management/storage-status";

import {
  FileOperations,
  readDirectory,
  sortEntries,
  fileType,
  operationError,
  defaultPreferences,
  loadViewPreferences,
  saveViewPreferences,
  type Entry,
  type FilesPreferences,
  type Progress,
  type TransferKind,
} from "./filesystem";

type ContextMenuRequest = {
  x: number;
  y: number;
  title: string;
  actions: ContextMenuAction[];
};

function home(): string {
  return os.homedir();
}

/** Longest matching place wins (Home must not stay selected under Desktop). */
function activePlaceId(cwd: string, list: FilePlace[]): string | null {
  let best: FilePlace | null = null;
  for (const p of list) {
    if (cwd === p.path || cwd.startsWith(p.path + path.sep)) {
      if (!best || p.path.length > best.path.length) best = p;
    }
  }
  return best?.id ?? null;
}

function iconFor(e: Entry): IconName {
  if (e.isDir) return "folder";
  const ext = path.extname(e.name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
  if ([".txt", ".md", ".pdf", ".odt", ".doc", ".docx"].includes(ext)) return "document";
  if ([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html", ".sh"].includes(ext))
    return "editor";
  if ([".mp3", ".flac", ".ogg", ".opus", ".wav", ".m4a"].includes(ext)) return "music";
  if ([".mp4", ".mkv", ".webm", ".mov", ".avi"].includes(ext)) return "video";
  if ([".zip", ".tar", ".gz", ".xz", ".7z"].includes(ext)) return "archive";
  if ([".ttf", ".otf", ".woff", ".woff2"].includes(ext)) return "font";
  return "file";
}

function breadcrumbSegments(cwd: string): BreadcrumbSegment[] {
  const resolved = path.resolve(cwd);
  const h = home();
  const insideHome = resolved === h || resolved.startsWith(h + path.sep);
  const root = insideHome ? h : path.parse(resolved).root;
  const segments: BreadcrumbSegment[] = [{ id: root, label: insideHome ? "Home" : root }];
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    segments.push({ id: current, label: part });
  }
  return segments;
}

function ensureDir(p: string): void {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    /* ok */
  }
}

function initialDirectory(argv: string[]): string {
  const fallback =
    builtInPlaces().find((place) => place.id === "desktop")?.path ?? path.join(home(), "Desktop");
  const raw = argv.find((arg) => arg.length > 0 && !arg.startsWith("-"));
  if (!raw) return fallback;

  let requested: string;
  try {
    requested = raw.startsWith("file:") ? fileURLToPath(raw) : path.resolve(raw);
  } catch {
    return fallback;
  }

  try {
    const stat = fs.statSync(requested);
    return stat.isDirectory() ? requested : path.dirname(requested);
  } catch {
    return fallback;
  }
}

function actionIcon(icon?: string): IconName | undefined {
  const known: IconName[] = ["app", "desktop", "file", "folder", "grid", "list", "trash", "up"];
  return known.includes(icon as IconName) ? (icon as IconName) : undefined;
}

export type FilesAppProps = WindowSize & {
  onQuit: () => void;
  onBusyChange?: (busy: boolean) => void;
  initialPath: string;
  windowActions?: WindowActions;
  onShowContextMenu?: (request: ContextMenuRequest) => boolean;
  /** Caller owns the connection; fixtures inject a private typed client. */
  storageClient?: FilesStorageClient;
  onStorageChange?: () => void;
};

export function FilesApp(props: FilesAppProps): ReactNode {
  const [tabs, setTabs] = useState(() => [createFolderTab("folder-1", props.initialPath)]);
  const [activeId, setActiveId] = useState("folder-1");
  const nextId = useRef(2);
  const palette = usePalette();
  const [busy, setBusy] = useState(false);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [drives, setDrives] = useState<RemovableDriveController | null>(null);
  const [driveRevision, setDriveRevision] = useState(0);
  const [unavailableRoots, setUnavailableRoots] = useState<readonly string[]>([]);
  const storageChange = useRef(props.onStorageChange);
  storageChange.current = props.onStorageChange;
  useEffect(() => {
    const client = props.storageClient;
    if (!client) return;
    const next = new RemovableDriveController(
      client,
      (intent, destination) => {
        setTabs((current) =>
          current.map((tab) =>
            tab.id === intent.tabId && tab.navigation === intent.navigation
              ? navigateFolderTab(tab, destination)
              : tab,
          ),
        );
      },
      (roots) => {
        setUnavailableRoots((current) => [...new Set([...current, ...roots])]);
        setTabs((current) => current.map((tab) => retireDrivePaths(tab, roots, home())));
      },
      () => busyRef.current,
    );
    const changed = () => {
      setDriveRevision((revision) => revision + 1);
      const mounted = mountedRoots(next.state);
      setUnavailableRoots((current) => current.filter((root) => !mounted.includes(root)));
      storageChange.current?.();
    };
    const unsubscribe = next.subscribe(changed);
    setDrives(next);
    changed();
    return () => {
      unsubscribe();
      next.dispose();
    };
  }, [props.storageClient]);
  const driveBlocked =
    active && unavailableRoots.some((root) => isWithinMount(tabDirectory(active), root))
      ? "This drive is no longer available. Choose another folder or reconnect it."
      : null;
  const updateTab = useCallback((id: string, change: (tab: FolderTab) => FolderTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? change(tab) : tab)));
  }, []);
  const busyCallback = useRef(props.onBusyChange);
  busyCallback.current = props.onBusyChange;
  const reportBusy = useCallback((busy: boolean) => {
    setBusy(busy);
    busyCallback.current?.(busy);
  }, []);
  if (!active) return null;
  const addTab = (directory = tabDirectory(active)) => {
    if (busy) return;
    const tab = createFolderTab(`folder-${nextId.current++}`, directory);
    setTabs((current) => [...current, tab]);
    drives?.cancelNavigation();
    setActiveId(tab.id);
  };
  const closeTab = (index: number) => {
    if (busy) return;
    if (tabs.length === 1) {
      props.onQuit();
      return;
    }
    const closing = tabs[index];
    if (!closing) return;
    const remaining = tabs.filter((tab) => tab.id !== closing.id);
    setTabs(remaining);
    if (closing.id === activeId) {
      drives?.cancelNavigation();
      setActiveId(
        remaining[Math.min(index, remaining.length - 1)]?.id ?? remaining[0]?.id ?? activeId,
      );
    }
  };
  const changeTab = (offset: number) => {
    if (busy) return;
    const index = tabs.findIndex((tab) => tab.id === active.id);
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    if (next) {
      drives?.cancelNavigation();
      setActiveId(next.id);
    }
  };
  return (
    <WindowFrame
      width={props.width}
      height={props.height}
      title="Files"
      icon={<Icon symbolic name="folder" size={20} color={palette.accent} />}
      actions={props.windowActions}
      tabs={(size) => (
        <Tabs
          {...size}
          variant="titlebar"
          disabled={busy}
          tabs={tabs.map((tab) => ({
            id: tab.id,
            label: tab.tagFilter
              ? `Tag: ${tab.tagFilter}`
              : path.basename(tabDirectory(tab)) || "Filesystem",
            leading: <Icon symbolic name="folder" size={18} />,
            closable: true,
          }))}
          active={tabs.findIndex((tab) => tab.id === active.id)}
          onChange={(index) => {
            const next = tabs[index];
            if (!busy && next) {
              drives?.cancelNavigation();
              setActiveId(next.id);
            }
          }}
          onClose={closeTab}
          onAdd={() => addTab()}
        />
      )}
    >
      {(size) => (
        <FilesWorkspace
          {...props}
          {...size}
          tab={active}
          updateTab={updateTab}
          onBusyChange={reportBusy}
          onNewTab={addTab}
          onCloseTab={() => closeTab(tabs.findIndex((tab) => tab.id === active.id))}
          onChangeTab={changeTab}
          drives={drives}
          driveRevision={driveRevision}
          driveBlocked={driveBlocked}
          driveBusy={busy}
        />
      )}
    </WindowFrame>
  );
}

function FilesWorkspace(
  props: FilesAppProps & {
    tab: FolderTab;
    updateTab: (id: string, change: (tab: FolderTab) => FolderTab) => void;
    onBusyChange: (busy: boolean) => void;
    onNewTab: (directory?: string) => void;
    onCloseTab: () => void;
    onChangeTab: (offset: number) => void;
    drives: RemovableDriveController | null;
    driveRevision: number;
    driveBlocked: string | null;
    driveBusy: boolean;
  },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const metrics = filesLayout(props.width, props.height, ui);
  const updateTab = useCallback(
    (change: (tab: FolderTab) => FolderTab) => props.updateTab(props.tab.id, change),
    [props.updateTab, props.tab.id],
  );
  const query = props.tab.query;
  const setQuery = (query: string) => updateTab((tab) => ({ ...tab, query }));
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const navigation = props.tab.navigation;
  const cwd = tabDirectory(props.tab);
  const [preferences, setPreferences] = useState<FilesPreferences>(defaultPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const view = preferences.view;
  const setView = (next: "grid" | "list") =>
    setPreferences((current) => ({ ...current, view: next }));
  const [pathFocusRequest, setPathFocusRequest] = useState(0);
  const [pathEditing, setPathEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [transferDisplay, setTransferDisplay] = useState<TransferDisplay | null>(null);
  const transferDisplayRef = useRef(transferDisplay);
  transferDisplayRef.current = transferDisplay;
  useEffect(
    () => () => {
      transferDisplayRef.current = null;
    },
    [],
  );
  const [conflict, setConflict] = useState<TransferConflict | null>(null);
  const tagFilter = props.tab.tagFilter;
  const setTagFilter = (tagFilter: string | null) =>
    updateTab((tab) => ({
      ...tab,
      tagFilter,
      selection: createFolderTab(tab.id, cwd).selection,
      scrollY: 0,
    }));
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [tagFocused, setTagFocused] = useState(false);
  const inspectorRequested = preferences.inspectorOpen;
  const setInspectorRequested = (inspectorOpen: boolean) =>
    setPreferences((current) => ({ ...current, inspectorOpen }));
  const [activePane, setActivePane] = useState("files");
  useEffect(() => {
    setSearchFocusRequest(0);
    setPathFocusRequest(0);
    setSearchFocused(false);
    setPathEditing(false);
    setTagFocused(false);
    setActivePane("files");
    setMenu(null);
  }, [props.tab.id]);
  const [destinationPrompt, setDestinationPrompt] = useState<{
    kind: TransferKind;
    paths: string[];
  } | null>(null);
  const [destinationDraft, setDestinationDraft] = useState("");
  const catalog = useMemo(() => new FileCatalog(), []);
  const [controller, setController] = useState<AbortController | null>(null);
  useEffect(() => {
    props.onBusyChange(controller !== null);
  }, [controller, props.onBusyChange]);
  const [clipboard, setClipboard] = useState<{ kind: TransferKind; paths: string[] } | null>(null);
  const [prompt, setPrompt] = useState<{
    kind: "folder" | "file" | "rename";
    source?: string;
    directory: string;
  } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const operations = useMemo(
    () => new FileOperations(undefined, catalogReady ? catalog : undefined),
    [catalog, catalogReady],
  );
  useEffect(() => {
    let alive = true;
    void catalog.load().then(
      () => {
        if (alive) setCatalogReady(true);
      },
      (error) => {
        if (alive) setNotice(operationError(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  useEffect(() => {
    void loadViewPreferences().then((value) => {
      setPreferences(value);
      setPreferencesReady(true);
    });
  }, []);
  useEffect(() => {
    if (preferencesReady)
      void saveViewPreferences(preferences).catch((error) => setNotice(operationError(error)));
  }, [preferences, preferencesReady]);
  const runOperation = async (
    work: (signal: AbortSignal, report: (value: Progress) => void) => Promise<void>,
    success: string,
  ) => {
    if (props.driveBlocked) {
      setNotice(props.driveBlocked);
      return false;
    }
    if (controller) return false;
    const nextController = new AbortController();
    setController(nextController);
    setNotice(null);
    const initial = { done: 0, total: 1, name: success };
    setProgress(initial);
    try {
      await work(nextController.signal, (value) => {
        setProgress(value);
      });
      setNotice(success);
      return true;
    } catch (error) {
      setNotice(operationError(error));
      return false;
    } finally {
      setController(null);
      setProgress(null);
      setConflict(null);
      setCatalogRevision((value) => value + 1);
      setTick((value) => value + 1);
    }
  };
  const beginName = (kind: "folder" | "file" | "rename", directory = cwd, source?: string) => {
    if (controller) return;
    setPrompt({ kind, directory, source });
    setNameDraft(
      source ? path.basename(source) : kind === "folder" ? "New Folder" : "Untitled.txt",
    );
    setPromptError(null);
    setMenu(null);
  };
  const submitName = async () => {
    if (!prompt || controller) return;
    const current = prompt;
    const ok = await runOperation(
      async () => {
        try {
          if (current.kind === "rename" && current.source)
            await operations.rename(current.source, nameDraft);
          else
            await operations.create(
              current.directory,
              nameDraft,
              current.kind === "folder" ? "folder" : "file",
            );
        } catch (error) {
          setPromptError(operationError(error));
          throw error;
        }
      },
      current.kind === "rename" ? "Item renamed. Undo is available." : "Item created.",
    );
    if (ok) setPrompt(null);
  };
  const resolveConflict = (signal: AbortSignal) => (source: string, destination: string) =>
    new Promise<"skip" | "keep-both" | "cancel">((resolve) => {
      const choose = (choice: "skip" | "keep-both" | "cancel") => {
        signal.removeEventListener("abort", abort);
        setConflict(null);
        resolve(choice);
      };
      const abort = () => choose("cancel");
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) choose("cancel");
      else setConflict({ source, destination, choose });
    });
  const transferFiles = async (kind: TransferKind, paths: string[], directory: string) => {
    if (props.driveBlocked) {
      setNotice(props.driveBlocked);
      return false;
    }
    if (controller) return false;
    const nextController = new AbortController();
    setController(nextController);
    setNotice(null);
    const request = transferRequest(paths, directory);
    const initial: Progress = {
      done: 0,
      total: paths.length,
      name: "Preparing transfer…",
      phase: "preparing",
    };
    setProgress(initial);
    setTransferDisplay({ kind, request, progress: initial, outcome: "running" });
    try {
      const outcome = await executeTransfer({
        operations,
        kind,
        sources: paths,
        directory,
        signal: nextController.signal,
        report: (value) => {
          setProgress(value);
          setTransferDisplay({ kind, request, progress: value, outcome: "running" });
        },
        resolveConflict: resolveConflict(nextController.signal),
      });
      const message = transferOutcomeNotice(outcome);
      setNotice(message);
      setTransferDisplay({
        kind,
        request: outcome.request,
        progress: outcome.progress,
        outcome: outcome.state === "complete" ? "complete" : "stopped",
        message,
        result: outcome,
      });
      return outcome.state === "complete";
    } finally {
      setController(null);
      setProgress(null);
      setConflict(null);
      setCatalogRevision((value) => value + 1);
      setTick((value) => value + 1);
    }
  };
  const pasteFiles = (directory = cwd) => {
    if (!clipboard) return;
    const pending = clipboard;
    void transferFiles(pending.kind, pending.paths, directory).then(async () => {
      if (pending.kind !== "move") return;
      try {
        const remaining = await remainingCutPaths(pending.paths);
        // A newer copy/cut owns its own payload. A completed older operation
        // must not overwrite it, even while checking the remaining sources.
        setClipboard((current) =>
          current !== pending
            ? current
            : remaining.length
              ? { ...pending, paths: remaining }
              : null,
        );
      } catch (error) {
        setNotice(
          (current) =>
            `${current ? `${current} ` : ""}Could not refresh the remaining cut items. ${operationError(error)}`,
        );
      }
    });
  };
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState<
    | { kind: "entry"; entry: Entry; x: number; y: number }
    | { kind: "background"; x: number; y: number }
    | { kind: "actions"; x: number; y: number; title: string; actions: ContextMenuAction[] }
    | null
  >(null);
  const [placeList, setPlaceList] = useState<FilePlace[]>(loadPlaces);
  const [editingPlaces, setEditingPlaces] = useState(false);
  const [renamingPlaceId, setRenamingPlaceId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const activePlace = tagFilter ? null : activePlaceId(cwd, placeList);
  const launcher = useMemo(() => new FileLauncher(), []);
  useEffect(
    () =>
      launcher.observeFailures((failure) => {
        console.error("[files] File activation failed", failure);
        setNotice(launchFailureNotice(failure));
      }),
    [launcher],
  );
  const openPath = useCallback(
    (filePath: string) => {
      launcher.launchFallback(filePath);
    },
    [launcher],
  );
  const activation = useMemo(
    () =>
      new FileActivationService((activation) => {
        launcher.launchDesktop(activation);
      }),
    [launcher],
  );
  const activationPortal = useMemo(() => new FileActivationPortalClient(), []);
  const mimeDb = activation.mimeDatabase;

  const navigateTo = useCallback(
    (destination: string) => {
      updateTab((tab) => navigateFolderTab(tab, destination));
      setMenu(null);
    },
    [updateTab],
  );
  const travelHistory = (offset: -1 | 1) => {
    updateTab((tab) => travelFolderTab(tab, offset));
    setMenu(null);
  };

  useEffect(() => {
    for (const place of placeList) {
      if (place.builtIn) ensureDir(place.path);
    }
  }, [placeList]);

  useEffect(() => {
    if (props.driveBlocked) return;
    let w: fs.FSWatcher | null = null;
    try {
      w = fs.watch(cwd, () => setTick((t) => t + 1));
    } catch {
      /* ok */
    }
    return () => w?.close();
  }, [cwd, props.driveBlocked]);

  const [directory, setDirectory] = useState<{
    path: string;
    tag: string | null;
    entries: Entry[];
    error: string | null;
    loading: boolean;
  }>({ path: cwd, tag: null, entries: [], error: null, loading: true });
  useEffect(() => {
    let alive = true;
    if (props.driveBlocked) {
      setDirectory({
        path: cwd,
        tag: tagFilter,
        entries: [],
        error: props.driveBlocked,
        loading: false,
      });
      return;
    }
    setDirectory((current) => ({
      path: cwd,
      tag: tagFilter,
      entries: current.path === cwd && current.tag === tagFilter ? current.entries : [],
      error: null,
      loading: true,
    }));
    void (tagFilter ? catalog.entries(tagFilter) : readDirectory(cwd, preferences.hidden)).then(
      (entries) => {
        if (alive)
          setDirectory({ path: cwd, tag: tagFilter, entries, error: null, loading: false });
      },
      (error) => {
        if (alive)
          setDirectory({
            path: cwd,
            tag: tagFilter,
            entries: [],
            error: operationError(error),
            loading: false,
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [cwd, tick, preferences.hidden, tagFilter, catalog, catalogRevision, props.driveBlocked]);
  const directoryCurrent = directory.path === cwd && directory.tag === tagFilter;
  const directoryError = directoryCurrent ? directory.error : null;
  const directoryLoading = !directoryCurrent || directory.loading;
  const allEntries = useMemo(
    () =>
      sortEntries(
        directoryCurrent ? directory.entries : [],
        preferences.sort,
        preferences.descending,
      ),
    [directoryCurrent, directory.entries, preferences.sort, preferences.descending],
  );
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? allEntries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
      : allEntries;
  }, [allEntries, query]);
  const entryKeys = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const selection = useFolderTabSelection(
    props.tab,
    entryKeys,
    directoryCurrent && !directoryLoading,
    updateTab,
  );
  const clearSelection = selection.clear;
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selection.selectedKeys.has(entry.path)),
    [entries, selection.selectedKeys],
  );
  const selectedEntry = entries.find((entry) => entry.path === selection.primaryKey) ?? null;

  const openDefault = useCallback(
    (filePath: string) => {
      try {
        if (!activation.openDefault(filePath)) openPath(filePath);
      } catch (error) {
        setNotice(`Could not open ${path.basename(filePath)}. ${operationError(error)}`);
      }
    },
    [activation, openPath],
  );

  const openEntry = useCallback(
    (e: Entry) => {
      if (e.isDir) {
        navigateTo(e.path);
      } else {
        openDefault(e.path);
      }
    },
    [navigateTo, openDefault],
  );

  const showOpenWith = useCallback(
    (e: Entry) => {
      setMenu(null);
      void activationPortal
        .openWith(e.path)
        .then((response) => {
          if (response === 1) return;
          if (response === 2) {
            setNotice(`Could not open the application chooser for ${e.name}. Try Open With again.`);
            return;
          }
          activation.refreshAssociations();
          setTick((current) => current + 1);
        })
        .catch((error) => {
          console.error("[files] Open With failed", error);
          setNotice(
            `Could not open the application chooser for ${e.name}. ${operationError(error)}`,
          );
        });
    },
    [activation, activationPortal],
  );

  const actionRegistry = (() => {
    const registry = new ContextActionRegistry();
    registry.register({
      id: "moire.open",
      actions(context) {
        if (context.paths.length === 0) return [];
        const openActions = [
          {
            id: "open",
            label: context.paths.length === 1 ? "Open" : `Open ${context.paths.length} Items`,
            description:
              context.paths.length === 1
                ? context.directories[0]
                  ? "Browse this folder"
                  : "Use the default application"
                : "Open every selected item",
            icon: context.directories.every(Boolean) ? "folder" : "file",
            run: () => {
              if (context.paths.length > 1) {
                context.paths.forEach(openPath);
                return;
              }
              context.paths.forEach((filePath, index) => {
                openEntry({
                  name: path.basename(filePath),
                  path: filePath,
                  isDir: context.directories[index] ?? false,
                  size: 0,
                  modified: 0,
                });
              });
            },
          },
        ];
        if (context.paths.length !== 1 || context.directories[0]) {
          return openActions;
        }
        const filePath = context.paths[0]!;
        return [
          ...openActions,
          {
            id: "open-with",
            label: "Open With…",
            description: "Choose a compatible application",
            icon: "app",
            run: () =>
              showOpenWith({
                name: path.basename(filePath),
                path: filePath,
                isDir: false,
                size: 0,
                modified: 0,
              }),
          },
        ];
      },
    });
    registry.register({
      id: "moire.location",
      actions(context) {
        if (context.paths.length !== 1) return [];
        const filePath = context.paths[0];
        if (!filePath) return [];
        const directory = context.directories[0] ?? false;
        return [
          {
            id: directory ? "new-window" : "parent",
            label: directory ? "Open in New Window" : "Show Parent Folder",
            icon: directory ? "app" : "folder",
            separatorBefore: true,
            run: () => {
              if (directory) openPath(filePath);
              else navigateTo(path.dirname(filePath));
            },
          },
        ];
      },
    });
    registry.register({
      id: "moire.background",
      actions(context) {
        if (context.scope !== "background") return [];
        const directory = context.currentDirectory;
        if (!directory) return [];
        return [
          {
            id: "new-folder",
            label: "New Folder",
            icon: "folder",
            run: () => beginName("folder", directory),
          },
          {
            id: "select-all",
            label: "Select All",
            icon: "grid",
            enabled: entries.length > 0,
            run: selection.selectAll,
          },
          {
            id: "refresh",
            label: "Refresh",
            icon: "folder",
            separatorBefore: true,
            run: () => setTick((current) => current + 1),
          },
          {
            id: "toggle-view",
            label: view === "grid" ? "Use List View" : "Use Grid View",
            icon: view === "grid" ? "list" : "grid",
            run: () => setView(view === "grid" ? "list" : "grid"),
          },
        ];
      },
    });
    return registry;
  })();

  const contextActions = (entry: Entry): ContextMenuAction[] => {
    const targets = selection.isSelected(entry.path) ? selectedEntries : [entry];
    const context: FileActionContext = {
      source: "files",
      scope: "items",
      currentDirectory: cwd,
      paths: targets.map((target) => target.path),
      mimeTypes: targets.map((target) => mimeDb.mimeTypeForPath(target.path)),
      directories: targets.map((target) => target.isDir),
    };
    return [
      ...actionRegistry.actionsFor(context).map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        icon: actionIcon(action.icon),
        danger: action.danger,
        disabled: action.enabled === false,
        separatorBefore: action.separatorBefore,
        onPress: action.run,
      })),
      ...itemActions(targets),
    ];
  };

  const backgroundContextActions = (): ContextMenuAction[] => [
    ...folderActions(),
    ...actionRegistry
      .actionsFor({
        source: "files",
        scope: "background",
        currentDirectory: cwd,
        paths: [],
        mimeTypes: [],
        directories: [],
      })
      .map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        icon: actionIcon(action.icon),
        danger: action.danger,
        disabled: action.enabled === false,
        separatorBefore: action.separatorBefore,
        onPress: action.run,
      }))
      .filter(
        (action) =>
          action.id !== "moire.background:new-folder" && action.id !== "moire.background:refresh",
      ),
  ];

  const goUp = () => {
    const parent = path.dirname(cwd);
    if (parent !== cwd) navigateTo(parent);
  };

  const onDropPayload = (payload: unknown, x: number, y: number) => {
    const paths = pathsFromUriList(payload);
    if (!paths.length) return;
    const hitPath = hitTestDropData(x, y);
    const targetDir = typeof hitPath === "string" ? hitPath : cwd;
    void transferFiles("move", paths, targetDir);
  };

  const { statusH } = metrics;
  const messageH = notice || progress ? Math.round(44 * ui) : 0;
  const toolbarH = metrics.toolbarH;
  const bodyH = Math.max(1, metrics.bodyH - messageH);
  const editingText =
    searchFocused ||
    pathEditing ||
    tagFocused ||
    prompt !== null ||
    destinationPrompt !== null ||
    renamingPlaceId !== null;
  const selectedPaths = selectedEntries.map((entry) => entry.path);
  const stash = (kind: TransferKind, paths = selectedPaths) => {
    setClipboard({ kind, paths });
    setNotice(
      `${paths.length} ${paths.length === 1 ? "item" : "items"} ready to ${kind === "copy" ? "copy" : "move"}. Choose a destination and Paste.`,
    );
  };
  const trash = (paths = selectedPaths) => {
    void runOperation(
      (signal, report) => operations.trash(paths, signal, report),
      "Moved to Trash. Undo is available.",
    );
  };
  const undo = () => {
    void runOperation(() => operations.undo(), "Operation undone.");
  };
  const beginDestination = (kind: TransferKind, targets: Entry[]) => {
    setDestinationPrompt({ kind, paths: targets.map((entry) => entry.path) });
    setDestinationDraft(cwd);
    setMenu(null);
  };
  const showActions = (actions: ContextMenuAction[], title = "Organise files") => {
    const request = { x: metrics.pad, y: toolbarH, title, actions };
    if (!props.onShowContextMenu?.(request)) setMenu({ kind: "actions", ...request });
  };
  const showKeyboardContext = () => {
    const entry = selectedEntry ?? selectedEntries[0];
    if (entry) showActions(contextActions(entry), contextTitleFor(entry));
    else showActions(backgroundContextActions(), path.basename(cwd) || cwd);
  };
  const updateTags = (value: string, mode: "add" | "remove") => {
    const tags = parseTags(value);
    if (!tags.length || !catalogReady) return;
    void runOperation(
      () => catalog.update(selectedPaths, tags, mode),
      mode === "add" ? "Tags added." : "Tags removed.",
    );
  };
  const itemActions = (targets: Entry[]): ContextMenuAction[] => [
    ...(targets.length === 1 && targets[0]?.isDir
      ? [
          {
            id: "open-new-tab",
            label: "Open in new tab",
            onPress: () => {
              props.onNewTab(targets[0]?.path);
              setMenu(null);
            },
          },
        ]
      : []),
    {
      id: "inspect",
      label: "Inspect selection",
      onPress: () => {
        setInspectorRequested(true);
        setActivePane("preview");
        setMenu(null);
      },
    },
    {
      id: "copy-to",
      label: "Copy to folder…",
      disabled: !!controller,
      onPress: () => beginDestination("copy", targets),
    },
    {
      id: "move-to",
      label: "Move to folder…",
      disabled: !!controller,
      onPress: () => beginDestination("move", targets),
    },
    {
      id: "copy",
      label: "Copy · Ctrl+C",
      disabled: !!controller,
      onPress: () =>
        stash(
          "copy",
          targets.map((item) => item.path),
        ),
    },
    {
      id: "cut",
      label: "Cut · Ctrl+X",
      disabled: !!controller,
      onPress: () =>
        stash(
          "move",
          targets.map((item) => item.path),
        ),
    },
    {
      id: "rename",
      label: "Rename… · F2",
      disabled: !!controller || targets.length !== 1,
      onPress: () => beginName("rename", cwd, targets[0]?.path),
    },
    ...(cwd === operations.trashDirectory
      ? [
          {
            id: "restore",
            label: "Restore to original location",
            disabled: !!controller,
            onPress: () => {
              void runOperation(async () => {
                for (const target of targets) await operations.restore(target.path);
              }, "Items restored.");
            },
          },
        ]
      : [
          {
            id: "trash",
            label: "Move to Trash · Delete",
            danger: true,
            disabled: !!controller,
            onPress: () => trash(targets.map((item) => item.path)),
          },
        ]),
  ];
  const folderActions = (): ContextMenuAction[] => [
    {
      id: "preview-toggle",
      label: inspectorRequested ? "Hide preview" : "Show preview",
      onPress: () => {
        setInspectorRequested(!inspectorRequested);
        setActivePane(inspectorRequested ? "files" : "preview");
      },
    },
    { id: "pin-folder", label: "Pin current folder", onPress: addCurrentFavorite },
    {
      id: "edit-places",
      label: editingPlaces ? "Finish editing places" : "Edit places",
      onPress: () => {
        if (editingPlaces) finishEditingPlaces();
        else setEditingPlaces(true);
      },
    },
    {
      id: "new-folder",
      label: "New folder… · Ctrl+Shift+N",
      disabled: !!controller,
      onPress: () => beginName("folder"),
    },
    {
      id: "new-file",
      label: "New text file…",
      disabled: !!controller,
      onPress: () => beginName("file"),
    },
    {
      id: "paste",
      label: "Paste · Ctrl+V",
      disabled: !clipboard || !!controller,
      onPress: () => pasteFiles(),
    },
    {
      id: "undo",
      label: "Undo move / rename / Trash · Ctrl+Z",
      disabled: !operations.canUndo || !!controller,
      onPress: undo,
    },
    {
      id: "hidden",
      label: preferences.hidden ? "Hide hidden files · Ctrl+H" : "Show hidden files · Ctrl+H",
      onPress: () => setPreferences((current) => ({ ...current, hidden: !current.hidden })),
    },
    ...(["name", "type", "size", "modified"] as const).map((sort) => ({
      id: `sort-${sort}`,
      label: `Sort by ${sort}${preferences.sort === sort ? (preferences.descending ? " ↓" : " ↑") : ""}`,
      onPress: () =>
        setPreferences((current) => ({
          ...current,
          sort,
          descending: current.sort === sort ? !current.descending : false,
        })),
    })),
    { id: "refresh", label: "Refresh · F5", onPress: () => setTick((current) => current + 1) },
  ];
  const cellW = Math.round(124 * ui);
  const cellH = Math.round(132 * ui);
  const iconSz = Math.round(52 * ui);
  const { btn } = metrics;
  const renderPath = (width: number) => (
    <Surface
      width={width}
      height={btn}
      fill={pal.bg}
      stroke={pal.borderSubtle}
      strokeWidth={1}
      radius={pal.radiusMd}
      clip
    >
      <PathBar
        width={width}
        height={btn}
        value={cwd.replace(home(), "~")}
        focusRequest={pathFocusRequest}
        onEditingChange={setPathEditing}
        segments={tagFilter ? [{ id: cwd, label: `Tag: ${tagFilter}` }] : breadcrumbSegments(cwd)}
        onNavigate={navigateTo}
        onCommit={commitLocation}
      />
    </Surface>
  );
  const renderSearch = (width: number) => (
    <SearchField
      key={`search-${searchFocusRequest}`}
      width={width}
      height={btn}
      value={query}
      placeholder={`Search ${path.basename(cwd) || "folder"}`}
      autoFocus={searchFocusRequest > 0}
      onFocusChange={setSearchFocused}
      onChange={setQuery}
      onCancel={() => {
        setQuery("");
        setSearchFocused(false);
      }}
    />
  );

  const catalogTags = catalogReady ? catalog.allTags() : [];
  const selectedTags = [...new Set(selectedPaths.flatMap((file) => [...catalog.tags(file)]))];
  const gridGap = Math.round(SPACE.md * ui);
  const gridPadding = Math.round(SPACE.lg * ui);

  const selectEntry = (entry: Entry, event?: HitPointerEvent) => {
    selection.select(entry.path, {
      toggle: event?.ctrlKey || event?.metaKey,
      range: event?.shiftKey,
    });
    setMenu(null);
  };

  const handleEntryKey = (entry: Entry, event: HitKeyEvent, gridColumns = 1): boolean => {
    const additive = event.ctrlKey || event.metaKey;
    if (additive && (event.key?.toLowerCase() === "a" || event.code === 30)) {
      selection.selectAll();
      return true;
    }
    if (event.key === " " || event.code === 57) {
      selection.select(entry.path, {
        toggle: additive,
        range: event.shiftKey,
      });
      return true;
    }

    const moveOptions = {
      extend: event.shiftKey,
      preserveSelection: additive && !event.shiftKey,
    };
    if (event.key === "Home" || event.code === 102) {
      selection.first(moveOptions);
      return true;
    }
    if (event.key === "End" || event.code === 107) {
      selection.last(moveOptions);
      return true;
    }

    const delta =
      event.key === "ArrowLeft" || event.code === 105
        ? view === "grid"
          ? -1
          : 0
        : event.key === "ArrowRight" || event.code === 106
          ? view === "grid"
            ? 1
            : 0
          : event.key === "ArrowUp" || event.code === 103
            ? view === "grid"
              ? -gridColumns
              : -1
            : event.key === "ArrowDown" || event.code === 108
              ? view === "grid"
                ? gridColumns
                : 1
              : null;
    if (delta === null) return false;
    if (delta !== 0) selection.move(delta, moveOptions);
    return true;
  };

  const dragEntriesFor = (entry: Entry): Entry[] =>
    selection.isSelected(entry.path) ? selectedEntries : [entry];

  const contextTitleFor = (entry: Entry): string =>
    selection.isSelected(entry.path) && selectedEntries.length > 1
      ? `${selectedEntries.length} Items`
      : entry.name;

  const finishEditingPlaces = () => {
    setPlaceList((current) => {
      const renamed = renamingPlaceId
        ? current.map((place) =>
            place.id === renamingPlaceId ? { ...place, label: renameDraft } : place,
          )
        : current;
      const normalized = normalizePlaceLabels(renamed);
      savePlaces(normalized);
      return normalized;
    });
    setRenamingPlaceId(null);
    setRenameDraft("");
    setEditingPlaces(false);
  };

  const addCurrentFavorite = () => {
    const next = addFavorite(placeList, cwd);
    setPlaceList(next);
    savePlaces(next);
  };

  const startRenamingFavorite = (place: FilePlace) => {
    setRenamingPlaceId(place.id);
    setRenameDraft(place.label);
  };

  const commitFavoriteLabel = () => {
    if (!renamingPlaceId) return;
    setPlaceList((current) => {
      const next = normalizePlaceLabels(
        current.map((place) =>
          place.id === renamingPlaceId ? { ...place, label: renameDraft } : place,
        ),
      );
      savePlaces(next);
      return next;
    });
    setRenamingPlaceId(null);
    setRenameDraft("");
  };

  const cancelFavoriteLabel = () => {
    setRenamingPlaceId(null);
    setRenameDraft("");
  };

  const removeFavorite = (id: string) => {
    setPlaceList((current) => {
      const next = current.filter((place) => place.builtIn || place.id !== id);
      savePlaces(next);
      return next;
    });
    if (renamingPlaceId === id) cancelFavoriteLabel();
  };

  const commitLocation = (value: string): string | undefined => {
    const expanded =
      value === "~"
        ? home()
        : value.startsWith(`~${path.sep}`)
          ? path.join(home(), value.slice(2))
          : value;
    const destination = path.resolve(cwd, expanded);
    try {
      if (!fs.statSync(destination).isDirectory()) return "Not a folder";
      navigateTo(destination);
      return undefined;
    } catch {
      return "Folder not found";
    }
  };

  const showEntryContext = (entry: Entry, event: HitPointerEvent) => {
    if (!selection.isSelected(entry.path)) selection.select(entry.path);
    const request = {
      x: event.x,
      y: event.y,
      title: contextTitleFor(entry),
      actions: contextActions(entry),
    };
    if (!props.onShowContextMenu?.(request))
      setMenu({ kind: "entry", entry, x: event.x, y: event.y });
  };
  const driveState = props.drives?.state ?? DRIVES_UNAVAILABLE;
  const volumes = storageVolumes(driveState);
  const activeDrive = volumes.find(
    (volume) =>
      volume.mount.kind === "mounted" &&
      volume.mount.paths.some((root) => isWithinMount(cwd, root)),
  );
  const driveActions = (volume: StorageVolume) => {
    const expected =
      driveState.kind === "ready"
        ? { owner: driveState.owner, revision: driveState.snapshot.revision, id: volume.id }
        : null;
    showActions(
      [
        {
          id: "drive-open",
          label: volume.mount.kind === "mounted" ? "Open drive" : "Mount and open",
          disabled:
            props.driveBusy ||
            driveOperationBlocked(driveState, volume.id) ||
            volume.mount.kind === "unsupported" ||
            (volume.mount.kind !== "mounted" && !canDriveAction(driveState, volume.id, "mount")),
          onPress: () => {
            if (!props.driveBusy)
              void props.drives?.activate(
                volume.id,
                { tabId: props.tab.id, navigation: props.tab.navigation },
                expected ?? undefined,
              );
          },
        },
        {
          id: "drive-unmount",
          label: "Unmount",
          disabled: props.driveBusy || !canDriveAction(driveState, volume.id, "unmount"),
          onPress: () => {
            if (expected) void props.drives?.action(volume.id, "unmount", false, expected);
          },
        },
        {
          id: "drive-eject",
          label: "Eject",
          disabled: props.driveBusy || !canDriveAction(driveState, volume.id, "eject"),
          onPress: () => {
            if (expected) void props.drives?.action(volume.id, "eject", false, expected);
          },
        },
        {
          id: "drive-refresh",
          label: "Refresh drive status",
          onPress: () => void props.drives?.refresh(),
        },
      ],
      volume.label,
    );
  };
  useEffect(() => {
    setMenu(null);
    if (props.drives?.error) setNotice(props.drives.error);
  }, [props.driveRevision, props.drives]);
  const renderSidebar = (size: WindowSize) => (
    <NavigationSidebar
      {...size}
      labelCase="preserve"
      selectedId={
        tagFilter
          ? `tag:${tagFilter}`
          : activeDrive
            ? `drive:${activeDrive.id}`
            : cwd === operations.trashDirectory
              ? "trash"
              : activePlace
      }
      editing={editingPlaces}
      sections={[
        {
          id: "places",
          label: "Places",
          items: [
            ...placeList.map((place, index) => ({
              id: place.id,
              label: place.label,
              icon: place.icon,
              removable: !place.builtIn,
              movable: !place.builtIn,
              moveDirections: ([-1, 1] as const).filter(
                (direction) =>
                  !!placeList[index + direction] && !placeList[index + direction]?.builtIn,
              ),
            })),
            { id: "trash", label: "Trash", icon: "trash", movable: false },
          ],
        },
        {
          id: "drives",
          label: "Drives",
          items: volumes.map((volume) => ({
            id: `drive:${volume.id}`,
            label: volume.label,
            movable: false,
          })),
        },
        {
          id: "tags",
          label: "Tags",
          items: catalogTags.map((tag) => ({
            id: `tag:${tag}`,
            label: `${tag} · ${catalog.count(tag)}`,
            movable: false,
            leading: <Surface width={14} height={14} fill={pal.accent} radius={7} />,
          })),
        },
      ]}
      footer={
        <Horizontal height={36} gap={6} align="center">
          <Measure flexGrow={1} height={36}>
            {({ width, height }) => (
              <TextBlock
                width={width}
                height={height}
                text={
                  props.drives?.error ||
                  storageCaption(driveState) ||
                  (volumes.length ? "" : "No removable drives observed")
                }
                fontSize={10}
                wrap
                maxLines={2}
                overflow="ellipsis"
              />
            )}
          </Measure>
          <IconButton
            width={24}
            height={24}
            focusId="drives:refresh"
            tooltip="Refresh drive status"
            icon={<Icon name="restart" size={16} symbolic />}
            variant="ghost"
            disabled={!props.drives || props.drives.refreshing}
            onPress={() => void props.drives?.refresh()}
          />
        </Horizontal>
      }
      onSelect={(item) => {
        if (item.id === "trash")
          void fs.promises
            .mkdir(operations.trashDirectory, { recursive: true })
            .then(() => navigateTo(operations.trashDirectory))
            .catch((error) => setNotice(operationError(error)));
        else if (item.id.startsWith("tag:")) {
          setTagFilter(item.id.slice(4));
          setQuery("");
        } else {
          const place = placeList.find((place) => place.id === item.id);
          if (place) navigateTo(place.path);
        }
      }}
      onRemove={(item) => removeFavorite(item.id)}
      onMove={(item, direction) => {
        const index = placeList.findIndex((place) => place.id === item.id);
        const target = index + direction;
        if (
          index < 0 ||
          target < 0 ||
          target >= placeList.length ||
          placeList[index]?.builtIn ||
          placeList[target]?.builtIn
        )
          return;
        const next = [...placeList];
        const moving = next.splice(index, 1)[0];
        if (moving) next.splice(target, 0, moving);
        setPlaceList(next);
        savePlaces(next);
      }}
      getItemProps={(item) => ({
        onContextMenu: () => {
          const place = placeList.find((place) => place.id === item.id);
          showActions(
            [
              { id: "pin-folder", label: "Pin current folder", onPress: addCurrentFavorite },
              {
                id: "edit-places",
                label: editingPlaces ? "Finish editing places" : "Edit places",
                onPress: () => {
                  if (editingPlaces) finishEditingPlaces();
                  else setEditingPlaces(true);
                },
              },
              ...(place && !place.builtIn
                ? [
                    {
                      id: "rename-place",
                      label: "Rename favorite…",
                      onPress: () => {
                        setEditingPlaces(true);
                        startRenamingFavorite(place);
                      },
                    },
                    {
                      id: "remove-place",
                      label: "Remove favorite",
                      onPress: () => removeFavorite(place.id),
                    },
                  ]
                : []),
            ],
            "Places",
          );
        },
      })}
      renderItem={(item, row) => {
        const volume = volumes.find((volume) => item.id === `drive:${volume.id}`);
        if (volume)
          return (
            <RemovableDriveRow
              {...row}
              volume={volume}
              state={driveState}
              busy={props.driveBusy}
              onActivate={() =>
                void props.drives?.activate(
                  volume.id,
                  { tabId: props.tab.id, navigation: props.tab.navigation },
                  driveState.kind === "ready"
                    ? {
                        owner: driveState.owner,
                        revision: driveState.snapshot.revision,
                        id: volume.id,
                      }
                    : undefined,
                )
              }
              onActions={() => driveActions(volume)}
            />
          );
        return item.id === renamingPlaceId ? (
          <Row width={row.width} height={row.height}>
            <TextField
              width={row.width}
              value={renameDraft}
              autoFocus
              onChange={setRenameDraft}
              onSubmit={commitFavoriteLabel}
              onCancel={cancelFavoriteLabel}
            />
          </Row>
        ) : null;
      }}
    />
  );
  const renderCollection = ({ width: contentW, height: bodyH }: WindowSize) => {
    const gridColumns = Math.max(
      1,
      Math.floor((contentW - gridPadding * 2 + gridGap) / (cellW + gridGap)),
    );
    return (
      <DropTarget
        width={contentW}
        height={bodyH}
        mimeTypes={["text/uri-list"]}
        onDrop={(payload, _mimes, x, y) => onDropPayload(payload, x, y)}
      >
        <ContextMenuTrigger
          width={contentW}
          height={bodyH}
          onPress={() => {
            clearSelection();
            setMenu(null);
          }}
          onContextMenu={(event) => {
            clearSelection();
            const request: ContextMenuRequest = {
              x: event.x,
              y: event.y,
              title: path.basename(cwd) || cwd,
              actions: backgroundContextActions(),
            };
            if (!props.onShowContextMenu?.(request)) {
              setMenu({ kind: "background", x: event.x, y: event.y });
            }
          }}
        >
          <Surface x={0} y={0} width={contentW} height={bodyH} fill={pal.bg}>
            {directoryError || (directoryLoading && entries.length === 0) ? (
              <EmptyState
                width={contentW}
                height={bodyH}
                icon="folder"
                title={directoryError ? "Cannot open this folder" : "Loading folder…"}
                message={directoryError ?? "Reading files and their details."}
              />
            ) : entries.length === 0 ? (
              <EmptyState
                width={contentW}
                height={bodyH}
                icon={query.trim() ? "search" : "folder"}
                title={query.trim() ? "No matching files" : "This folder is empty"}
                message={
                  query.trim()
                    ? "Try a different name, or clear the search."
                    : "Drop files here, or choose another place in the sidebar."
                }
              />
            ) : view === "grid" ? (
              <Grid<Entry>
                width={contentW}
                height={bodyH}
                items={entries}
                getKey={(entry) => entry.path}
                focusedKey={selection.focusKey ?? entryKeys[0]}
                scrollY={props.tab.scrollY}
                onScroll={(scrollY) => updateTab((tab) => ({ ...tab, scrollY }))}
                itemWidth={cellW}
                fill={pal.bg}
                itemHeight={cellH}
                gap={gridGap}
                padding={gridPadding}
                renderItem={(entry) => (
                  <CollectionItem
                    key={entry.path}
                    width={cellW}
                    height={cellH}
                    focusId={`file:${entry.path}`}
                    autoFocus={!editingText && (selection.focusKey ?? entryKeys[0]) === entry.path}
                    onFocusChange={(focused) => {
                      if (focused) selection.focus(entry.path, false);
                    }}
                    dragSource={{
                      mimeTypes: ["text/uri-list"],
                      getPayload: () =>
                        pathsToUriList(dragEntriesFor(entry).map((target) => target.path)),
                      label:
                        selection.isSelected(entry.path) && selectedEntries.length > 1
                          ? `${selectedEntries.length} items`
                          : entry.name,
                      previewIcon: { name: iconFor(entry) },
                    }}
                    dropData={entry.isDir ? entry.path : undefined}
                    onPress={(event) => selectEntry(entry, event)}
                    onDoublePress={() => openEntry(entry)}
                    onKeyDown={(event) => handleEntryKey(entry, event, gridColumns)}
                    onContextMenu={(event) => {
                      if (!selection.isSelected(entry.path)) {
                        selection.select(entry.path);
                      }
                      const request: ContextMenuRequest = {
                        x: event.x,
                        y: event.y,
                        title: contextTitleFor(entry),
                        actions: contextActions(entry),
                      };
                      if (!props.onShowContextMenu?.(request)) {
                        setMenu({
                          kind: "entry",
                          entry,
                          x: event.x,
                          y: event.y,
                        });
                      }
                    }}
                  >
                    <GridItem
                      width={cellW}
                      height={cellH}
                      label={entry.name}
                      iconSize={iconSz}
                      selected={selection.isSelected(entry.path)}
                      interactive={false}
                      icon={<EntryArtwork entry={entry} size={iconSz} />}
                    />
                  </CollectionItem>
                )}
              />
            ) : (
              <Table<Entry>
                width={contentW}
                height={bodyH}
                variant="plain"
                rowHeight={Math.round(44 * ui)}
                headerHeight={Math.round(36 * ui)}
                rows={entries}
                getRowKey={(entry) => entry.path}
                sortRows={false}
                selectedKeys={selection.selectedKeys}
                focusedKey={selection.focusKey ?? entryKeys[0]}
                scrollY={props.tab.scrollY}
                onScroll={(scrollY) => updateTab((tab) => ({ ...tab, scrollY }))}
                sort={{
                  columnId: preferences.sort,
                  direction: preferences.descending ? "descending" : "ascending",
                }}
                onSortChange={(sort) =>
                  setPreferences((current) => ({
                    ...current,
                    sort:
                      sort.columnId === "modified" ||
                      sort.columnId === "size" ||
                      sort.columnId === "type"
                        ? sort.columnId
                        : "name",
                    descending: sort.direction === "descending",
                  }))
                }
                columns={[
                  {
                    id: "name",
                    label: "Name",
                    minWidth: Math.round(180 * ui),
                    sortable: true,
                    renderCell: (entry, _index, width) => (
                      <Horizontal
                        width={width}
                        height={Math.round(44 * ui)}
                        padding={{ horizontal: SPACE.sm * ui }}
                        gap={SPACE.sm * ui}
                        align="center"
                      >
                        <Box width={28 * ui} height={28 * ui}>
                          <EntryArtwork entry={entry} size={28 * ui} />
                        </Box>
                        <TextBlock
                          text={entry.name}
                          fontSize={13}
                          flexShrink={1}
                          maxLines={1}
                          overflow="ellipsis"
                        />
                      </Horizontal>
                    ),
                  },
                  ...(contentW >= 500 * ui
                    ? [
                        {
                          id: "modified",
                          label: "Modified",
                          width: 145 * ui,
                          sortable: true,
                          getValue: (entry: Entry) =>
                            new Date(entry.modified).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                        },
                      ]
                    : []),
                  {
                    id: "size",
                    label: "Size",
                    width: 78 * ui,
                    sortable: true,
                    getValue: (entry) => (entry.isDir ? "—" : formatBytes(entry.size)),
                  },
                  ...(contentW >= 640 * ui
                    ? [
                        {
                          id: "type",
                          label: "Kind",
                          width: 125 * ui,
                          sortable: true,
                          getValue: fileType,
                        },
                      ]
                    : []),
                ]}
                getRowProps={(entry) => ({
                  focusId: `file:${entry.path}`,
                  autoFocus: !editingText && (selection.focusKey ?? entryKeys[0]) === entry.path,
                  onFocusChange: (focused) => {
                    if (focused) selection.focus(entry.path, false);
                  },
                  dragSource: {
                    mimeTypes: ["text/uri-list"],
                    getPayload: () =>
                      pathsToUriList(dragEntriesFor(entry).map((target) => target.path)),
                    label:
                      selection.isSelected(entry.path) && selectedEntries.length > 1
                        ? `${selectedEntries.length} items`
                        : entry.name,
                    previewIcon: { name: iconFor(entry) },
                  },
                  dropData: entry.isDir ? entry.path : undefined,
                  onPress: (event) => selectEntry(entry, event),
                  onDoublePress: () => openEntry(entry),
                  onKeyDown: (event) => handleEntryKey(entry, event),
                  onContextMenu: (event) => showEntryContext(entry, event),
                })}
              />
            )}
          </Surface>
        </ContextMenuTrigger>
      </DropTarget>
    );
  };

  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      enabled={!prompt && !destinationPrompt && !transferDisplay}
      shortcuts={[
        {
          id: "new-tab",
          key: "t",
          platformModifier: true,
          disabled: !!controller,
          onInvoke: () => props.onNewTab(),
        },
        {
          id: "close-tab",
          key: "w",
          platformModifier: true,
          disabled: !!controller,
          onInvoke: props.onCloseTab,
        },
        { id: "next-tab", key: "Tab", ctrl: true, onInvoke: () => props.onChangeTab(1) },
        {
          id: "previous-tab",
          key: "Tab",
          ctrl: true,
          shift: true,
          onInvoke: () => props.onChangeTab(-1),
        },
        {
          id: "location",
          key: "l",
          platformModifier: true,
          onInvoke: () => setPathFocusRequest((value) => value + 1),
        },
        {
          id: "context-menu",
          key: "F10",
          shift: true,
          disabled: editingText,
          onInvoke: showKeyboardContext,
        },
        {
          id: "context-menu-key",
          code: 139,
          disabled: editingText,
          onInvoke: showKeyboardContext,
        },
        { id: "refresh", key: "F5", onInvoke: () => setTick((value) => value + 1) },
        {
          id: "select-all",
          key: "a",
          platformModifier: true,
          disabled: editingText || entries.length === 0,
          onInvoke: selection.selectAll,
        },
        {
          id: "hidden",
          key: "h",
          platformModifier: true,
          disabled: editingText,
          onInvoke: () => setPreferences((value) => ({ ...value, hidden: !value.hidden })),
        },
        {
          id: "new-folder",
          key: "n",
          platformModifier: true,
          shift: true,
          disabled: editingText || !!controller,
          onInvoke: () => beginName("folder"),
        },
        {
          id: "copy",
          key: "c",
          platformModifier: true,
          disabled: editingText || !selectedPaths.length,
          onInvoke: () => stash("copy"),
        },
        {
          id: "cut",
          key: "x",
          platformModifier: true,
          disabled: editingText || !selectedPaths.length,
          onInvoke: () => stash("move"),
        },
        {
          id: "paste",
          key: "v",
          platformModifier: true,
          disabled: editingText || !clipboard || !!controller,
          onInvoke: () => pasteFiles(),
        },
        {
          id: "undo",
          key: "z",
          platformModifier: true,
          disabled: editingText || !operations.canUndo || !!controller,
          onInvoke: undo,
        },
        {
          id: "rename",
          key: "F2",
          disabled: editingText || selectedPaths.length !== 1 || !!controller,
          onInvoke: () => beginName("rename", cwd, selectedPaths[0]),
        },
        {
          id: "trash",
          key: "Delete",
          disabled:
            editingText ||
            !selectedPaths.length ||
            !!controller ||
            cwd === operations.trashDirectory,
          onInvoke: () => trash(),
        },
        {
          id: "search",
          key: "f",
          platformModifier: true,
          onInvoke: () => setSearchFocusRequest((request) => request + 1),
        },
        { id: "back", key: "ArrowLeft", alt: true, onInvoke: () => travelHistory(-1) },
        { id: "forward", key: "ArrowRight", alt: true, onInvoke: () => travelHistory(1) },
        { id: "up", key: "ArrowUp", alt: true, onInvoke: goUp },
      ]}
    >
      <Surface x={0} y={0} width={props.width} height={props.height} fill={pal.panel}>
        <Column x={0} y={0} width={props.width} height={props.height} gap={0}>
          <Surface width={props.width} height={toolbarH} fill={pal.panel}>
            <Inset width={props.width} height={toolbarH} padding={metrics.pad}>
              <Column width={Math.max(1, props.width - metrics.pad * 2)} gap={8 * ui}>
                <Horizontal height={btn} gap={8 * ui} align="center">
                  <Horizontal width={btn * 3 + metrics.gap * 2} height={btn} gap={metrics.gap}>
                    <IconButton
                      tooltip="Back · Alt+Left"
                      tooltipPlacement="right"
                      width={btn}
                      height={btn}
                      icon={(style) => (
                        <Icon symbolic name="back" size={style.size} color={style.color} />
                      )}
                      variant="ghost"
                      disabled={navigation.index === 0}
                      onPress={() => travelHistory(-1)}
                    />
                    <IconButton
                      tooltip="Forward · Alt+Right"
                      tooltipPlacement="right"
                      width={btn}
                      height={btn}
                      icon={(style) => (
                        <Icon symbolic name="forward" size={style.size} color={style.color} />
                      )}
                      variant="ghost"
                      disabled={navigation.index >= navigation.paths.length - 1}
                      onPress={() => travelHistory(1)}
                    />
                    <IconButton
                      tooltip="Parent folder · Alt+Up"
                      width={btn}
                      height={btn}
                      icon={(style) => (
                        <Icon symbolic name="up" size={style.size} color={style.color} />
                      )}
                      variant="ghost"
                      disabled={path.dirname(cwd) === cwd}
                      onPress={goUp}
                    />
                  </Horizontal>
                  {props.width >= 760 * ui ? (
                    <Measure flexGrow={1} minWidth={1} height={btn}>
                      {({ width }) => renderPath(width)}
                    </Measure>
                  ) : null}
                  {props.width >= 360 * ui ? (
                    <Measure
                      flexGrow={props.width < 760 * ui ? 1 : 0}
                      width={props.width >= 760 * ui ? 210 * ui : undefined}
                      minWidth={1}
                      height={btn}
                    >
                      {({ width }) => renderSearch(width)}
                    </Measure>
                  ) : (
                    <Box flexGrow={1} />
                  )}
                  <Horizontal width={btn * 2 + metrics.gap} height={btn} gap={metrics.gap}>
                    {(["grid", "list"] as const).map((mode) => (
                      <IconButton
                        key={mode}
                        tooltip={mode === "grid" ? "Grid view" : "List view"}
                        width={btn}
                        height={btn}
                        variant="ghost"
                        selected={view === mode}
                        icon={(style) => (
                          <Icon
                            symbolic
                            name={mode}
                            size={style.size}
                            color={view === mode ? pal.accent : style.color}
                          />
                        )}
                        onPress={() => setView(mode)}
                      />
                    ))}
                  </Horizontal>
                </Horizontal>
                {props.width < 360 * ui
                  ? renderSearch(Math.max(1, props.width - metrics.pad * 2))
                  : null}
                {props.width < 760 * ui
                  ? renderPath(Math.max(1, props.width - metrics.pad * 2))
                  : null}
              </Column>
            </Inset>
          </Surface>
          <Separator width={props.width} height={1} />
          {messageH ? (
            <Surface width={props.width} height={messageH} fill={pal.surface}>
              <Label
                x={metrics.pad}
                y={Math.round(6 * ui)}
                width={Math.max(1, props.width - Math.round(108 * ui))}
                height={messageH - Math.round(10 * ui)}
                text={
                  progress
                    ? `${progress.done}/${progress.total} · ${progress.name}`
                    : (notice ?? "")
                }
                fontSize={11}
                wrap
                maxLines={2}
                overflow="ellipsis"
              />
              <Button
                x={props.width - Math.round(88 * ui)}
                y={Math.round(7 * ui)}
                width={Math.round(76 * ui)}
                height={Math.round(28 * ui)}
                label={progress ? "Stop" : "Dismiss"}
                variant="ghost"
                onPress={() => (progress ? controller?.abort() : setNotice(null))}
              />
            </Surface>
          ) : null}
          <AdaptivePanes
            width={props.width}
            height={bodyH}
            activePaneId={activePane}
            onActivePaneChange={setActivePane}
            navigation={{
              id: "places",
              title: "Places",
              preferredWidth: preferences.sidebarWidth * ui,
              onWidthChange: (width) =>
                setPreferences((current) => ({ ...current, sidebarWidth: width / ui })),
              render: renderSidebar,
            }}
            content={{ id: "files", title: "Files", render: renderCollection }}
            accessory={{
              id: "preview",
              title: "Preview",
              open: inspectorRequested,
              onClose: () => setInspectorRequested(false),
              preferredWidth: preferences.inspectorWidth * ui,
              onWidthChange: (width) =>
                setPreferences((current) => ({ ...current, inspectorWidth: width / ui })),
              render: (size) => (
                <FileInspector
                  {...size}
                  entries={selectedEntries}
                  cwd={cwd}
                  refresh={tick + catalogRevision}
                  tags={selectedTags}
                  tagsReady={catalogReady}
                  busy={!!controller}
                  onTags={updateTags}
                  onTextFocus={setTagFocused}
                  onOpen={openEntry}
                  onReveal={(entry) => navigateTo(path.dirname(entry.path))}
                  onRename={(entry) => beginName("rename", cwd, entry.path)}
                  onActions={() => showActions(itemActions(selectedEntries))}
                  onClose={() => setInspectorRequested(false)}
                />
              ),
            }}
          />
          <StatusBar width={props.width} height={statusH} padding={Math.round(12 * ui)}>
            <Label
              width={Math.max(1, props.width - Math.round(128 * ui))}
              height={Math.round(18 * ui)}
              fontSize={11}
              color={pal.muted}
              text={`${entries.length} ${entries.length === 1 ? "item" : "items"}${query.trim() ? ` of ${allEntries.length}` : ""}${selectedEntries.length ? ` · ${selectedEntries.length} selected` : ""}`}
            />
            <Label
              width={Math.round(96 * ui)}
              height={Math.round(18 * ui)}
              text={
                selectedEntries.length
                  ? formatBytes(
                      selectedEntries
                        .filter((entry) => !entry.isDir)
                        .reduce((total, entry) => total + entry.size, 0),
                    )
                  : ""
              }
              horizontalAlign="end"
              fontSize={11}
              color={pal.muted}
            />
          </StatusBar>
        </Column>
        {menu ? (
          <ContextMenu
            viewportWidth={props.width}
            viewportHeight={props.height}
            x={menu.x}
            y={menu.y}
            title={
              menu.kind === "entry"
                ? contextTitleFor(menu.entry)
                : menu.kind === "actions"
                  ? menu.title
                  : path.basename(cwd) || cwd
            }
            actions={
              menu.kind === "entry"
                ? contextActions(menu.entry)
                : menu.kind === "actions"
                  ? menu.actions
                  : backgroundContextActions()
            }
            onDismiss={() => setMenu(null)}
          />
        ) : null}
        {prompt ? (
          <>
            <ModalBarrier
              width={props.width}
              height={props.height}
              visible
              onDismiss={() => {
                if (!controller) setPrompt(null);
              }}
            />
            <FocusScope
              x={Math.max(4, Math.round((props.width - Math.min(props.width - 8, 420 * ui)) / 2))}
              y={Math.max(4, Math.round((props.height - 240 * ui) / 2))}
              width={Math.min(props.width - 8, 420 * ui)}
              height={Math.round(240 * ui)}
              trap
              onEscape={() => {
                if (!controller) setPrompt(null);
              }}
            >
              <Dialog
                width={Math.min(props.width - 8, 420 * ui)}
                height={Math.round(240 * ui)}
                title={
                  prompt.kind === "rename"
                    ? "Rename item"
                    : prompt.kind === "folder"
                      ? "New folder"
                      : "New text file"
                }
                onClose={() => {
                  if (!controller) setPrompt(null);
                }}
              >
                <Column
                  width={Math.max(1, Math.min(props.width - 8, 420 * ui) - Math.round(32 * ui))}
                  gap={Math.round(12 * ui)}
                >
                  <Label text="Name" fontSize={12} height={Math.round(20 * ui)} />
                  <TextField
                    width={Math.max(1, Math.min(props.width - 8, 420 * ui) - Math.round(32 * ui))}
                    height={Math.round(36 * ui)}
                    value={nameDraft}
                    autoFocus
                    selectAllOnFocus
                    invalid={!!promptError}
                    onChange={(value) => {
                      setNameDraft(value);
                      setPromptError(null);
                    }}
                    onSubmit={() => {
                      void submitName();
                    }}
                    onCancel={() => {
                      if (!controller) setPrompt(null);
                    }}
                  />
                  <Label
                    width={Math.max(1, Math.min(props.width - 8, 420 * ui) - Math.round(32 * ui))}
                    height={Math.round(40 * ui)}
                    text={promptError ?? "Existing items are never replaced."}
                    color={promptError ? pal.danger : pal.muted}
                    fontSize={11}
                    wrap
                    maxLines={3}
                    overflow="ellipsis"
                  />
                  <Row height={Math.round(32 * ui)} gap={Math.round(8 * ui)}>
                    <Button
                      width={Math.round(92 * ui)}
                      height={Math.round(32 * ui)}
                      label={prompt.kind === "rename" ? "Rename" : "Create"}
                      variant="primary"
                      disabled={!!controller}
                      onPress={() => {
                        void submitName();
                      }}
                    />
                    <Button
                      width={Math.round(88 * ui)}
                      height={Math.round(32 * ui)}
                      label="Cancel"
                      variant="ghost"
                      disabled={!!controller}
                      onPress={() => setPrompt(null)}
                    />
                  </Row>
                </Column>
              </Dialog>
            </FocusScope>
          </>
        ) : null}
        {destinationPrompt ? (
          <>
            <ModalBarrier
              width={props.width}
              height={props.height}
              visible
              onDismiss={() => setDestinationPrompt(null)}
            />
            <FocusScope
              x={4}
              y={Math.max(4, Math.round((props.height - 248 * ui) / 2))}
              width={props.width - 8}
              height={Math.round(248 * ui)}
              trap
              onEscape={() => setDestinationPrompt(null)}
            >
              <Dialog
                width={props.width - 8}
                height={Math.round(248 * ui)}
                title={`${destinationPrompt.kind === "copy" ? "Copy" : "Move"} ${destinationPrompt.paths.length} items to folder`}
                onClose={() => setDestinationPrompt(null)}
              >
                <Column width={Math.max(1, props.width - 40)} gap={Math.round(12 * ui)}>
                  <Label
                    width={Math.max(1, props.width - 40)}
                    height={Math.round(36 * ui)}
                    text="Destination folder (absolute path or ~ for Home)"
                    fontSize={12}
                    wrap
                    maxLines={2}
                  />
                  <TextField
                    width={Math.max(1, props.width - 40)}
                    value={destinationDraft}
                    autoFocus
                    selectAllOnFocus
                    onChange={setDestinationDraft}
                    onCancel={() => setDestinationPrompt(null)}
                    onSubmit={() => {
                      const value = destinationPrompt;
                      const destination = destinationDraft.startsWith("~")
                        ? path.join(home(), destinationDraft.slice(1))
                        : path.resolve(cwd, destinationDraft);
                      setDestinationPrompt(null);
                      void transferFiles(value.kind, value.paths, destination);
                    }}
                  />
                  <Button
                    width={Math.max(1, props.width - 40)}
                    height={Math.round(32 * ui)}
                    label={destinationPrompt.kind === "copy" ? "Copy here" : "Move here"}
                    variant="primary"
                    onPress={() => {
                      const value = destinationPrompt;
                      const destination = destinationDraft.startsWith("~")
                        ? path.join(home(), destinationDraft.slice(1))
                        : path.resolve(cwd, destinationDraft);
                      setDestinationPrompt(null);
                      void transferFiles(value.kind, value.paths, destination);
                    }}
                  />
                </Column>
              </Dialog>
            </FocusScope>
          </>
        ) : null}
        {transferDisplay ? (
          <TransferDialog
            width={props.width}
            height={props.height}
            value={transferDisplay}
            conflict={conflict}
            onCancel={() => controller?.abort()}
            onDismiss={() => setTransferDisplay(null)}
            onShowInFolder={
              transferDisplay.outcome !== "running" && transferDisplay.progress.validatedDirectory
                ? () => {
                    const receipt = transferDisplay;
                    const directory = receipt.progress.validatedDirectory;
                    if (!directory) return;
                    void transferDestinationFolder(directory).then(
                      (directory) => {
                        if (transferDisplayRef.current !== receipt) return;
                        navigateTo(directory);
                        setTransferDisplay(null);
                      },
                      (error) => {
                        if (transferDisplayRef.current !== receipt) return;
                        const message = `Could not show the transfer destination. ${operationError(error)}`;
                        setNotice(message);
                        setTransferDisplay({ ...receipt, navigationError: message });
                      },
                    );
                  }
                : undefined
            }
          />
        ) : null}
      </Surface>
    </ShortcutManager>
  );
}

function EntryArtwork({ entry, size }: { entry: Entry; size: number }): ReactNode {
  const pal = usePalette();
  if (!entry.isDir && /\.png$/i.test(entry.name) && entry.size <= 8 * 1024 * 1024)
    return <ImageWidget width={size} height={size} src={entry.path} fit="contain" />;
  if (entry.isDir) return <Icon symbolic name="folder-filled" size={size} color={pal.accent} />;
  return <Icon symbolic name={iconFor(entry)} size={size} color={pal.accent} />;
}

async function main() {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const desktop = initialDirectory(process.argv.slice(2));
  ensureDir(desktop);

  const app = new Application();
  const win = new Window({
    title: "Files",
    appId: "org.moire.Files",
    width: Math.round(1020 * settings.uiScale),
    height: Math.round(600 * settings.uiScale),
    resizable: true,
    decorated: false,
  });
  let activePopup: PopupHandle | null = null;
  let storageClient: FilesStorageClient | undefined;
  try {
    storageClient = await connectStorageStatus();
  } catch {
    /* Existing session service may be unavailable. */
  }
  const retireStorageMenus = () => {
    activePopup?.destroy();
    activePopup = null;
  };
  const showContextMenu = (request: ContextMenuRequest): boolean => {
    activePopup?.destroy();
    activePopup = null;
    const popupSize = contextMenuSurfaceSize(
      request.actions,
      request.title,
      244,
      Math.min(480, win.getHeight()),
    );
    let next: PopupHandle | null = null;
    next = win.showPopup({
      x: request.x,
      y: request.y,
      width: popupSize.width,
      height: popupSize.height,
      content: (surface) => (
        <ContextMenu
          viewportWidth={surface.width}
          viewportHeight={surface.height}
          x={0}
          y={0}
          title={request.title}
          actions={request.actions}
          surface
          onDismiss={() => {
            next?.destroy();
            if (activePopup === next) activePopup = null;
          }}
        />
      ),
      onClose: () => {
        if (activePopup === next) activePopup = null;
      },
    });
    if (!next) return false;
    activePopup = next;
    return true;
  };
  win.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={desktop}
      storageClient={storageClient}
      onStorageChange={retireStorageMenus}
      windowActions={win}
      onBusyChange={(busy) => win.setCloseGuard(busy ? () => false : null)}
      onShowContextMenu={showContextMenu}
      onQuit={() => {
        win.destroy();
        app.quit();
      }}
    />
  ));
  win.onClose(() => app.quit());
  app.addWindow(win);
  try {
    await app.run();
  } finally {
    retireStorageMenus();
    await storageClient?.dispose();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((err) => {
    console.error("[files]", err);
    process.exit(1);
  });
