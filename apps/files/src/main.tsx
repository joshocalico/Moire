/**
 * Moire Files — Places + grid/list browser composed from @moire/ui only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Application,
  Window,
  Column,
  Row,
  Label,
  Button,
  Surface,
  Separator,
  ListItem,
  TextField,
  Grid,
  GridItem,
  Icon,
  DropTarget,
  DropZone,
  CollectionItem,
  ContextMenuTrigger,
  ScrollArea,
  ContextMenu,
  contextMenuSurfaceSize,
  OpenWithPicker,
  PathBar,
  themePalette,
  getUiScaleFactor,
  setUiScaleFactor,
  hitTestDropData,
  SPACE,
  type WindowSize,
  type IconName,
  type ContextMenuAction,
  type PopupHandle,
  type BreadcrumbSegment,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import {
  ContextActionRegistry,
  buildDesktopExec,
  discoverApplications,
  loadMimeAssociationDatabase,
  type DesktopEntry,
  type FileActionContext,
} from "@moire/app-discovery";
import {
  addFavorite,
  builtInPlaces,
  loadPlaces,
  normalizePlaceLabels,
  savePlaces,
  type FilePlace,
} from "./places.js";

type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
};

type NavigationState = {
  paths: string[];
  index: number;
};

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

function listDir(dir: string): Entry[] {
  try {
    const names = fs.readdirSync(dir);
    const out: Entry[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        out.push({
          name,
          path: full,
          isDir: st.isDirectory(),
          size: st.size,
        });
      } catch {
        /* skip */
      }
    }
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  } catch {
    return [];
  }
}

function iconFor(e: Entry): IconName {
  if (e.isDir) return "folder";
  const ext = path.extname(e.name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
  return "file";
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function breadcrumbSegments(cwd: string): BreadcrumbSegment[] {
  const resolved = path.resolve(cwd);
  const h = home();
  const insideHome = resolved === h || resolved.startsWith(h + path.sep);
  const root = insideHome ? h : path.parse(resolved).root;
  const segments: BreadcrumbSegment[] = [
    { id: root, label: insideHome ? "Home" : root },
  ];
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    segments.push({ id: current, label: part });
  }
  return segments;
}

function openPath(p: string): void {
  spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
}

function launchWith(app: DesktopEntry, filePath: string): void {
  const command = buildDesktopExec(app, [filePath]);
  spawn("/bin/sh", ["-lc", command], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function ensureDir(p: string): void {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    /* ok */
  }
}

function createUniqueFolder(parent: string): string | null {
  for (let index = 1; index < 10_000; index++) {
    const name = index === 1 ? "New Folder" : `New Folder ${index}`;
    const destination = path.join(parent, name);
    try {
      fs.mkdirSync(destination);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
    }
  }
  return null;
}

function pathToUri(p: string): string {
  return `file://${encodeURI(p)}`;
}

function initialDirectory(argv: string[]): string {
  const fallback =
    builtInPlaces().find((place) => place.id === "desktop")?.path ??
    path.join(home(), "Desktop");
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

function payloadToPaths(payload: unknown): string[] {
  const text = typeof payload === "string" ? payload : String(payload ?? "");
  return text
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith("file:"))
    .map((u) => {
      try {
        return decodeURIComponent(u.replace(/^file:\/\//, ""));
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function actionIcon(icon?: string): IconName | undefined {
  const known: IconName[] = [
    "app",
    "desktop",
    "file",
    "folder",
    "grid",
    "list",
    "trash",
    "up",
  ];
  return known.includes(icon as IconName) ? (icon as IconName) : undefined;
}

function FilesApp(
  props: WindowSize & {
    onQuit: () => void;
    initialPath: string;
    onShowContextMenu?: (request: ContextMenuRequest) => boolean;
  },
): ReactNode {
  const pal = themePalette();
  const ui = getUiScaleFactor();
  const pad = Math.round(SPACE.lg * ui);
  const sideW = Math.round(204 * ui);
  const [navigation, setNavigation] = useState<NavigationState>(() => ({
    paths: [props.initialPath],
    index: 0,
  }));
  const cwd = navigation.paths[navigation.index] ?? props.initialPath;
  const [selected, setSelected] = useState(-1);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState<
    | { kind: "entry"; entry: Entry; x: number; y: number }
    | { kind: "background"; x: number; y: number }
    | null
  >(null);
  const [pickerEntry, setPickerEntry] = useState<Entry | null>(null);
  const [pickerSelection, setPickerSelection] = useState<string | null>(null);
  const [placeList, setPlaceList] = useState<FilePlace[]>(loadPlaces);
  const [editingPlaces, setEditingPlaces] = useState(false);
  const activePlace = activePlaceId(cwd, placeList);
  const applications = useMemo(
    () => discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire"),
    [],
  );
  const mimeDb = useMemo(
    () => loadMimeAssociationDatabase(applications),
    [applications],
  );

  const navigateTo = useCallback((destination: string) => {
    const resolved = path.resolve(destination);
    setNavigation((current) => {
      if (current.paths[current.index] === resolved) return current;
      const paths = [...current.paths.slice(0, current.index + 1), resolved];
      return { paths, index: paths.length - 1 };
    });
    setSelected(-1);
    setMenu(null);
  }, []);

  const travelHistory = (offset: -1 | 1) => {
    setNavigation((current) => ({
      ...current,
      index: Math.max(
        0,
        Math.min(current.paths.length - 1, current.index + offset),
      ),
    }));
    setSelected(-1);
    setMenu(null);
  };

  useEffect(() => {
    for (const place of placeList) {
      if (place.builtIn) ensureDir(place.path);
    }
  }, [placeList]);

  useEffect(() => {
    let w: fs.FSWatcher | null = null;
    try {
      w = fs.watch(cwd, () => setTick((t) => t + 1));
    } catch {
      /* ok */
    }
    return () => w?.close();
  }, [cwd]);

  const entries = useMemo(() => {
    void tick;
    return listDir(cwd);
  }, [cwd, tick]);

  const openDefault = useCallback(
    (filePath: string) => {
      const mime = mimeDb.mimeTypeForPath(filePath);
      const app = mimeDb.defaultApplicationForMime(mime);
      if (app) launchWith(app, filePath);
      else openPath(filePath);
    },
    [mimeDb],
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
      const choices = mimeDb.applicationsForPath(e.path);
      setPickerEntry(e);
      setPickerSelection(choices[0]?.id ?? null);
      setMenu(null);
    },
    [mimeDb],
  );

  const actionRegistry = useMemo(() => {
    const registry = new ContextActionRegistry();
    registry.register({
      id: "moire.open",
      actions(context) {
        const filePath = context.paths[0];
        if (!filePath) return [];
        const directory = context.directories[0] ?? false;
        return [
          {
            id: "open",
            label: "Open",
            description: directory ? "Browse this folder" : "Use the default application",
            icon: directory ? "folder" : "file",
            run: () =>
              openEntry({
                name: path.basename(filePath),
                path: filePath,
                isDir: directory,
                size: 0,
              }),
          },
          {
            id: "open-with",
            label: "Open With…",
            description: "Choose a compatible application",
            icon: "app",
            run: () =>
              showOpenWith({
                name: path.basename(filePath),
                path: filePath,
                isDir: directory,
                size: 0,
              }),
          },
        ];
      },
    });
    registry.register({
      id: "moire.location",
      actions(context) {
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
            run: () => {
              const created = createUniqueFolder(directory);
              if (created) {
                setTick((current) => current + 1);
                setSelected(-1);
              }
            },
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
            run: () =>
              setView((current) => (current === "grid" ? "list" : "grid")),
          },
        ];
      },
    });
    return registry;
  }, [navigateTo, openEntry, showOpenWith, view]);

  const contextActions = useCallback(
    (entry: Entry): ContextMenuAction[] => {
      const context: FileActionContext = {
        source: "files",
        scope: "items",
        currentDirectory: cwd,
        paths: [entry.path],
        mimeTypes: [mimeDb.mimeTypeForPath(entry.path)],
        directories: [entry.isDir],
      };
      return actionRegistry.actionsFor(context).map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        icon: actionIcon(action.icon),
        danger: action.danger,
        disabled: action.enabled === false,
        separatorBefore: action.separatorBefore,
        onPress: action.run,
      }));
    },
    [actionRegistry, cwd, mimeDb],
  );

  const backgroundContextActions = (): ContextMenuAction[] =>
    actionRegistry
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
      }));

  const goUp = () => {
    const parent = path.dirname(cwd);
    if (parent !== cwd) navigateTo(parent);
  };

  const onDropPayload = (payload: unknown, x: number, y: number) => {
    const paths = payloadToPaths(payload);
    const hitPath = hitTestDropData(x, y);
    const targetDir = typeof hitPath === "string" ? hitPath : cwd;
    console.log(`[files] onDropPayload cwd=${cwd} hitPath=${String(hitPath)} targetDir=${targetDir} paths=${JSON.stringify(paths)}`);
    for (const src of paths) {
      const dest = path.join(targetDir, path.basename(src));
      if (src === dest) {
        console.log(`[files] drop skipped (src===dest) ${src}`);
        continue;
      }
      try {
        fs.renameSync(src, dest);
        console.log(`[files] drop moved ${src} -> ${dest}`);
      } catch (renameErr) {
        try {
          fs.copyFileSync(src, dest);
          console.log(`[files] drop copied ${src} -> ${dest}`);
        } catch (err) {
          console.warn("[files] drop failed", src, "rename err:", renameErr, "copy err:", err);
        }
      }
    }
    setTick((t) => t + 1);
  };

  const selectedEntry = entries[selected] ?? null;
  const pickerMime = pickerEntry
    ? mimeDb.mimeTypeForPath(pickerEntry.path)
    : "application/octet-stream";
  const pickerApps = pickerEntry
    ? mimeDb.applicationsForMime(pickerMime)
    : [];
  const pickerChoices = pickerApps.map((app, index) => ({
    id: app.id,
    name: app.name,
    description: app.comment ?? app.genericName ?? app.exec,
    isDefault: index === 0,
  }));
  const finishOpenWith = (desktopId: string, makeDefault: boolean) => {
    if (!pickerEntry) return;
    const app = pickerApps.find((candidate) => candidate.id === desktopId);
    if (!app) return;
    if (makeDefault) mimeDb.setDefaultApplication(pickerMime, desktopId);
    launchWith(app, pickerEntry.path);
    setPickerEntry(null);
    setPickerSelection(null);
  };

  const toolbarH = Math.round(62 * ui);
  const bodyH = Math.max(1, props.height - toolbarH - 1);
  const contentW = Math.max(1, props.width - sideW - 1);
  const cellW = Math.round(124 * ui);
  const cellH = Math.round(132 * ui);
  const iconSz = Math.round(52 * ui);
  const btn = Math.round(36 * ui);
  const pathBarWidth = Math.max(80, props.width - Math.round(272 * ui));

  const finishEditingPlaces = () => {
    const normalized = normalizePlaceLabels(placeList);
    setPlaceList(normalized);
    savePlaces(normalized);
    setEditingPlaces(false);
  };

  const addCurrentFavorite = () => {
    const next = addFavorite(placeList, cwd);
    setPlaceList(next);
    savePlaces(next);
  };

  const renameFavorite = (id: string, label: string) => {
    setPlaceList((current) =>
      current.map((place) => (place.id === id ? { ...place, label } : place)),
    );
  };

  const commitFavoriteLabel = () => {
    setPlaceList((current) => {
      const next = normalizePlaceLabels(current);
      savePlaces(next);
      return next;
    });
  };

  const removeFavorite = (id: string) => {
    setPlaceList((current) => {
      const next = current.filter((place) => place.builtIn || place.id !== id);
      savePlaces(next);
      return next;
    });
  };

  const commitLocation = (value: string): string | undefined => {
    const expanded =
      value === "~" ? home() : value.startsWith(`~${path.sep}`) ? path.join(home(), value.slice(2)) : value;
    const destination = path.resolve(cwd, expanded);
    try {
      if (!fs.statSync(destination).isDirectory()) return "Not a folder";
      navigateTo(destination);
      return undefined;
    } catch {
      return "Folder not found";
    }
  };

  return (
    <Surface x={0} y={0} width={props.width} height={props.height} fill={pal.panel}>
      <Column x={0} y={0} width={props.width} height={props.height} gap={0}>
        <Row
          width={props.width}
          height={toolbarH}
          padding={Math.round(SPACE.md * ui)}
          gap={Math.round(SPACE.sm * ui)}
          align="center"
        >
          <Button
            width={btn}
            height={btn}
            label="←"
            variant="ghost"
            disabled={navigation.index === 0}
            onPress={() => travelHistory(-1)}
          />
          <Button
            width={btn}
            height={btn}
            label="→"
            variant="ghost"
            disabled={navigation.index >= navigation.paths.length - 1}
            onPress={() => travelHistory(1)}
          />
          <Button
            width={Math.round(56 * ui)}
            height={btn}
            label="↑  Up"
            variant="secondary"
            onPress={goUp}
          />
          <PathBar
            width={pathBarWidth}
            height={btn}
            value={cwd.replace(home(), "~")}
            segments={breadcrumbSegments(cwd)}
            onNavigate={navigateTo}
            onCommit={commitLocation}
          />
          <Button
            width={Math.round(88 * ui)}
            height={btn}
            label={view === "grid" ? "List View" : "Grid View"}
            variant="secondary"
            onPress={() => setView((current) => (current === "grid" ? "list" : "grid"))}
          />
        </Row>
        <Separator width={props.width} height={1} />
        <Row width={props.width} height={bodyH} gap={0}>
          <Column
            width={sideW}
            height={bodyH}
            padding={Math.round(SPACE.md * ui)}
            gap={Math.round(SPACE.xs * ui)}
          >
            <Row
              width={sideW - pad}
              height={Math.round(28 * ui)}
              align="center"
              gap={Math.round(SPACE.xs * ui)}
            >
              <Label
                text="FAVORITES"
                color={pal.accent}
                fontSize={10}
                fontWeight="medium"
                width={sideW - pad - Math.round(56 * ui)}
                height={Math.round(18 * ui)}
              />
              <Button
                width={Math.round(52 * ui)}
                height={Math.round(26 * ui)}
                label={editingPlaces ? "Done" : "Edit"}
                variant="ghost"
                fontSize={11}
                onPress={() => {
                  if (editingPlaces) finishEditingPlaces();
                  else setEditingPlaces(true);
                }}
              />
            </Row>
            {placeList.map((place) => (
              editingPlaces && !place.builtIn ? (
                <Row
                  key={place.id}
                  width={sideW - Math.round(SPACE.lg * ui)}
                  height={Math.round(40 * ui)}
                  align="center"
                  gap={Math.round(SPACE.xs * ui)}
                >
                  <Icon
                    name="folder"
                    size={Math.round(18 * ui)}
                    color={pal.accent}
                  />
                  <TextField
                    width={sideW - Math.round(82 * ui)}
                    height={Math.round(30 * ui)}
                    value={place.label}
                    onChange={(label) => renameFavorite(place.id, label)}
                    onSubmit={commitFavoriteLabel}
                    onFocusChange={(focused) => {
                      if (!focused) commitFavoriteLabel();
                    }}
                  />
                  <Button
                    width={Math.round(30 * ui)}
                    height={Math.round(30 * ui)}
                    label="−"
                    variant="ghost"
                    color={pal.danger}
                    fontSize={16}
                    onPress={() => removeFavorite(place.id)}
                  />
                </Row>
              ) : (
                <DropZone
                  key={place.id}
                  width={sideW - Math.round(SPACE.lg * ui)}
                  height={Math.round(40 * ui)}
                  id={place.path}
                >
                  <ListItem
                    width={sideW - Math.round(SPACE.lg * ui)}
                    height={Math.round(40 * ui)}
                    title={place.label}
                    leading={
                      <Icon
                        name={place.icon}
                        size={Math.round(20 * ui)}
                        color={activePlace === place.id ? pal.accent : pal.text}
                      />
                    }
                    selected={activePlace === place.id}
                    onPress={() => {
                      if (place.builtIn) ensureDir(place.path);
                      try {
                        if (fs.statSync(place.path).isDirectory()) {
                          navigateTo(place.path);
                        }
                      } catch {
                        // A missing favorite remains editable and removable.
                      }
                    }}
                  />
                </DropZone>
              )
            ))}
            {editingPlaces ? (
              <Button
                width={sideW - Math.round(SPACE.lg * ui)}
                height={Math.round(34 * ui)}
                label="+ Add Current Folder"
                variant="secondary"
                fontSize={11}
                disabled={placeList.some((place) => place.path === cwd)}
                onPress={addCurrentFavorite}
              />
            ) : null}
            <Separator
              width={sideW - Math.round(SPACE.xl * ui)}
              height={1}
              color={pal.borderSubtle}
            />
            <Label
              text="SELECTION"
              color={pal.muted}
              fontSize={10}
              fontWeight="medium"
              width={sideW - pad}
              height={Math.round(18 * ui)}
            />
            <Label
              text={selectedEntry?.name ?? "Nothing selected"}
              color={selectedEntry ? pal.text : pal.muted}
              fontSize={12}
              fontWeight={selectedEntry ? "medium" : "regular"}
              width={sideW - pad}
              height={Math.round(20 * ui)}
            />
            <Label
              text={
                selectedEntry
                  ? selectedEntry.isDir
                    ? "Folder"
                    : `${mimeDb.mimeTypeForPath(selectedEntry.path)} · ${formatSize(selectedEntry.size)}`
                  : `${entries.length} ${entries.length === 1 ? "item" : "items"} in this folder`
              }
              color={pal.muted}
              fontSize={10}
              width={sideW - pad}
              height={Math.round(30 * ui)}
            />
          </Column>
          <Separator width={1} height={bodyH} />
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
                setSelected(-1);
                setMenu(null);
              }}
              onContextMenu={(event) => {
                setSelected(-1);
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
                {view === "grid" ? (
                  <Grid<Entry>
                  width={contentW}
                  height={bodyH}
                  items={entries}
                  itemWidth={cellW}
                  itemHeight={cellH}
                  gap={Math.round(SPACE.md * ui)}
                  padding={Math.round(SPACE.lg * ui)}
                  renderItem={(entry, index) => (
                    <CollectionItem
                      key={entry.path}
                      width={cellW}
                      height={cellH}
                      focusId={`file:${entry.path}`}
                      dragSource={{
                        mimeTypes: ["text/uri-list"],
                        getPayload: () => pathToUri(entry.path) + "\n",
                        previewIcon: { name: iconFor(entry) },
                      }}
                      dropData={entry.isDir ? entry.path : undefined}
                      onPress={() => {
                        setSelected(index);
                        setMenu(null);
                      }}
                      onDoublePress={() => openEntry(entry)}
                      onContextMenu={(event) => {
                        setSelected(index);
                        const request: ContextMenuRequest = {
                          x: event.x,
                          y: event.y,
                          title: entry.name,
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
                        selected={selected === index}
                        interactive={false}
                        icon={
                          <Icon
                            name={iconFor(entry)}
                            size={iconSz}
                            color={entry.isDir ? pal.accent : pal.text}
                          />
                        }
                      />
                    </CollectionItem>
                  )}
                  />
                ) : (
                  <ScrollArea
                  width={contentW}
                  height={bodyH}
                  contentHeight={Math.max(
                    bodyH,
                    entries.length * Math.round(44 * ui) + pad,
                  )}
                >
                  {entries.map((entry, index) => (
                    <CollectionItem
                      key={entry.path}
                      x={Math.round(SPACE.sm * ui)}
                      y={Math.round(SPACE.sm * ui) + index * Math.round(44 * ui)}
                      width={contentW - Math.round(SPACE.lg * ui)}
                      height={Math.round(40 * ui)}
                      focusId={`file:${entry.path}`}
                      dragSource={{
                        mimeTypes: ["text/uri-list"],
                        getPayload: () => pathToUri(entry.path) + "\n",
                        previewIcon: { name: iconFor(entry) },
                      }}
                      dropData={entry.isDir ? entry.path : undefined}
                      onPress={() => {
                        setSelected(index);
                        setMenu(null);
                      }}
                      onDoublePress={() => openEntry(entry)}
                      onContextMenu={(event) => {
                        setSelected(index);
                        const request: ContextMenuRequest = {
                          x: event.x,
                          y: event.y,
                          title: entry.name,
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
                      <ListItem
                        width={contentW - Math.round(SPACE.lg * ui)}
                        height={Math.round(40 * ui)}
                        title={entry.name}
                        subtitle={
                          entry.isDir
                            ? "Folder"
                            : `${mimeDb.mimeTypeForPath(entry.path)} · ${formatSize(entry.size)}`
                        }
                        selected={selected === index}
                        interactive={false}
                        leading={
                          <Icon
                            name={iconFor(entry)}
                            size={Math.round(22 * ui)}
                            color={entry.isDir ? pal.accent : pal.text}
                          />
                        }
                      />
                    </CollectionItem>
                  ))}
                  </ScrollArea>
                )}
              </Surface>
            </ContextMenuTrigger>
          </DropTarget>
        </Row>
      </Column>
      {menu ? (
        <ContextMenu
          viewportWidth={props.width}
          viewportHeight={props.height}
          x={menu.x}
          y={menu.y}
          title={
            menu.kind === "entry" ? menu.entry.name : path.basename(cwd) || cwd
          }
          actions={
            menu.kind === "entry"
              ? contextActions(menu.entry)
              : backgroundContextActions()
          }
          onDismiss={() => setMenu(null)}
        />
      ) : null}
      {pickerEntry ? (
        <OpenWithPicker
          viewportWidth={props.width}
          viewportHeight={props.height}
          fileName={pickerEntry.name}
          mimeType={pickerMime}
          choices={pickerChoices}
          selectedId={pickerSelection}
          onSelect={setPickerSelection}
          onOpen={(id) => finishOpenWith(id, false)}
          onMakeDefault={(id) => finishOpenWith(id, true)}
          onDismiss={() => {
            setPickerEntry(null);
            setPickerSelection(null);
          }}
        />
      ) : null}
    </Surface>
  );
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
    width: Math.round(820 * settings.uiScale),
    height: Math.round(540 * settings.uiScale),
    resizable: true,
  });
  let activePopup: PopupHandle | null = null;
  const showContextMenu = (request: ContextMenuRequest): boolean => {
    activePopup?.destroy();
    activePopup = null;
    const popupSize = contextMenuSurfaceSize(request.actions, request.title);
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
      onShowContextMenu={showContextMenu}
      onQuit={() => {
        win.destroy();
        app.quit();
      }}
    />
  ));
  win.onClose(() => app.quit());
  app.addWindow(win);
  await app.run();
}

main().catch((err) => {
  console.error("[files]", err);
  process.exit(1);
});
