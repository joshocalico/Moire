/**
 * Moire Files — Places + grid/list browser composed from @moire/ui only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  createElement,
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
  Grid,
  GridItem,
  Icon,
  DropTarget,
  DropZone,
  Draggable,
  ScrollArea,
  ContextMenu,
  OpenWithPicker,
  themePalette,
  getUiScaleFactor,
  setUiScaleFactor,
  hitTestDropData,
  SPACE,
  TYPE_ROLES,
  type WindowSize,
  type IconName,
  type ContextMenuAction,
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

type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
};

type Place = { id: string; label: string; path: string; icon: IconName };

function home(): string {
  return os.homedir();
}

function places(): Place[] {
  const h = home();
  return [
    { id: "home", label: "Home", path: h, icon: "home" },
    { id: "desktop", label: "Desktop", path: path.join(h, "Desktop"), icon: "desktop" },
    {
      id: "downloads",
      label: "Downloads",
      path: path.join(h, "Downloads"),
      icon: "downloads",
    },
  ];
}

/** Longest matching place wins (Home must not stay selected under Desktop). */
function activePlaceId(cwd: string, list: Place[]): string | null {
  let best: Place | null = null;
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

function pathToUri(p: string): string {
  return `file://${encodeURI(p)}`;
}

function initialDirectory(argv: string[]): string {
  const fallback = path.join(home(), "Desktop");
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
  props: WindowSize & { onQuit: () => void; initialPath: string },
): ReactNode {
  const pal = themePalette();
  const ui = getUiScaleFactor();
  const pad = Math.round(SPACE.lg * ui);
  const sideW = Math.round(204 * ui);
  const [cwd, setCwd] = useState(props.initialPath);
  const [selected, setSelected] = useState(-1);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState<{ entry: Entry; x: number; y: number } | null>(
    null,
  );
  const [pickerEntry, setPickerEntry] = useState<Entry | null>(null);
  const [pickerSelection, setPickerSelection] = useState<string | null>(null);
  const placeList = useMemo(() => places(), []);
  const activePlace = activePlaceId(cwd, placeList);
  const applications = useMemo(
    () => discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire"),
    [],
  );
  const mimeDb = useMemo(
    () => loadMimeAssociationDatabase(applications),
    [applications],
  );

  useEffect(() => {
    ensureDir(path.join(home(), "Desktop"));
    ensureDir(path.join(home(), "Downloads"));
  }, []);

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
        setCwd(e.path);
        setSelected(-1);
      } else {
        openDefault(e.path);
      }
    },
    [openDefault],
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
              else {
                setCwd(path.dirname(filePath));
                setSelected(-1);
              }
            },
          },
        ];
      },
    });
    return registry;
  }, [openEntry, showOpenWith]);

  const contextActions = useCallback(
    (entry: Entry): ContextMenuAction[] => {
      const context: FileActionContext = {
        source: "files",
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
    [actionRegistry, mimeDb],
  );

  const goUp = () => {
    const parent = path.dirname(cwd);
    if (parent !== cwd) {
      setCwd(parent);
      setSelected(-1);
    }
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

  const crumb = cwd.replace(home(), "~");
  const toolbarH = Math.round(62 * ui);
  const bodyH = Math.max(1, props.height - toolbarH - 1);
  const contentW = Math.max(1, props.width - sideW - 1);
  const cellW = Math.round(124 * ui);
  const cellH = Math.round(132 * ui);
  const iconSz = Math.round(52 * ui);
  const btn = Math.round(36 * ui);

  return createElement(
    Surface,
    {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: pal.panel,
    },
    createElement(
      Column,
      { x: 0, y: 0, width: props.width, height: props.height, gap: 0 },
      createElement(
        Row,
        {
          width: props.width,
          height: toolbarH,
          padding: Math.round(SPACE.md * ui),
          gap: Math.round(SPACE.sm * ui),
          align: "center",
        },
        createElement(Button, {
          width: Math.round(72 * ui),
          height: btn,
          label: "↑  Up",
          variant: "secondary",
          onPress: goUp,
        }),
        createElement(
          DropZone,
          {
            width: Math.max(80, props.width - Math.round(256 * ui)),
            height: btn,
            id: cwd,
          },
          createElement(Label, {
            text: `Location  /  ${crumb}`,
            color: pal.text,
            width: Math.max(80, props.width - Math.round(256 * ui)),
            height: btn,
            fontSize: TYPE_ROLES.body.size,
            fontWeight: "medium",
          }),
        ),
        createElement(Button, {
          width: Math.round(88 * ui),
          height: btn,
          label: view === "grid" ? "List View" : "Grid View",
          variant: "secondary",
          onPress: () => setView((v) => (v === "grid" ? "list" : "grid")),
        }),
      ),
      createElement(Separator, { width: props.width, height: 1 }),
      createElement(
        Row,
        { width: props.width, height: bodyH, gap: 0 },
        createElement(
          Column,
          {
            width: sideW,
            height: bodyH,
            padding: Math.round(SPACE.md * ui),
            gap: Math.round(SPACE.xs * ui),
          },
          createElement(Label, {
            text: "FAVORITES",
            color: pal.accent,
            fontSize: 10,
            fontWeight: "medium",
            width: sideW - pad,
            height: Math.round(18 * ui),
          }),
          ...placeList.map((p) =>
            createElement(
              DropZone,
              {
                key: p.id,
                width: sideW - Math.round(SPACE.lg * ui),
                height: Math.round(40 * ui),
                id: p.path,
              },
              createElement(ListItem, {
                width: sideW - Math.round(SPACE.lg * ui),
                height: Math.round(40 * ui),
                title: p.label,
                leading: createElement(Icon, {
                  name: p.icon,
                  size: Math.round(20 * ui),
                  color: activePlace === p.id ? pal.accent : pal.text,
                }),
                selected: activePlace === p.id,
                onPress: () => {
                  ensureDir(p.path);
                  setCwd(p.path);
                  setSelected(-1);
                },
              }),
            ),
          ),
          createElement(Separator, {
            width: sideW - Math.round(SPACE.xl * ui),
            height: 1,
            color: pal.borderSubtle,
          }),
          createElement(Label, {
            text: "SELECTION",
            color: pal.muted,
            fontSize: 10,
            fontWeight: "medium",
            width: sideW - pad,
            height: Math.round(18 * ui),
          }),
          createElement(Label, {
            text: selectedEntry?.name ?? "Nothing selected",
            color: selectedEntry ? pal.text : pal.muted,
            fontSize: 12,
            fontWeight: selectedEntry ? "medium" : "regular",
            width: sideW - pad,
            height: Math.round(20 * ui),
          }),
          createElement(Label, {
            text: selectedEntry
              ? selectedEntry.isDir
                ? "Folder"
                : `${mimeDb.mimeTypeForPath(selectedEntry.path)} · ${formatSize(selectedEntry.size)}`
              : `${entries.length} ${entries.length === 1 ? "item" : "items"} in this folder`,
            color: pal.muted,
            fontSize: 10,
            width: sideW - pad,
            height: Math.round(30 * ui),
          }),
        ),
        createElement(Separator, { width: 1, height: bodyH }),
        createElement(
          DropTarget,
          {
            width: contentW,
            height: bodyH,
            mimeTypes: ["text/uri-list"],
            onDrop: (payload, _mimes, x, y) => onDropPayload(payload, x, y),
          },
          createElement(
            Surface,
            {
              x: 0,
              y: 0,
              width: contentW,
              height: bodyH,
              fill: pal.bg,
            },
            view === "grid"
              ? createElement(Grid, {
                  width: contentW,
                  height: bodyH,
                  items: entries,
                  itemWidth: cellW,
                  itemHeight: cellH,
                  gap: Math.round(SPACE.md * ui),
                  padding: Math.round(SPACE.lg * ui),
                  renderItem: (eRaw, i) => {
                    const e = eRaw as Entry;
                    return createElement(
                      Draggable,
                      {
                        key: e.path,
                        width: cellW,
                        height: cellH,
                        mimeTypes: ["text/uri-list"],
                        getPayload: () => pathToUri(e.path) + "\n",
                        dropData: e.isDir ? e.path : undefined,
                        previewIcon: { name: iconFor(e) },
                        onPress: () => {
                          setSelected(i);
                          setMenu(null);
                        },
                        onDoublePress: () => openEntry(e),
                        onContextMenu: (event) => {
                          setSelected(i);
                          setMenu({ entry: e, x: event.x, y: event.y });
                        },
                      },
                      createElement(GridItem, {
                        width: cellW,
                        height: cellH,
                        label: e.name,
                        iconSize: iconSz,
                        selected: selected === i,
                        interactive: false,
                        icon: createElement(Icon, {
                          name: iconFor(e),
                          size: iconSz,
                          color: e.isDir ? pal.accent : pal.text,
                        }),
                      }),
                    );
                  },
                })
              : createElement(
                  ScrollArea,
                  {
                    width: contentW,
                    height: bodyH,
                    contentHeight: Math.max(
                      bodyH,
                      entries.length * Math.round(44 * ui) + pad,
                    ),
                  },
                  ...entries.map((e, i) =>
                    createElement(
                      Draggable,
                      {
                        key: e.path,
                        x: Math.round(SPACE.sm * ui),
                        y: Math.round(SPACE.sm * ui) + i * Math.round(44 * ui),
                        width: contentW - Math.round(SPACE.lg * ui),
                        height: Math.round(40 * ui),
                        mimeTypes: ["text/uri-list"],
                        getPayload: () => pathToUri(e.path) + "\n",
                        dropData: e.isDir ? e.path : undefined,
                        previewIcon: { name: iconFor(e) },
                        onPress: () => {
                          setSelected(i);
                          setMenu(null);
                        },
                        onDoublePress: () => openEntry(e),
                        onContextMenu: (event) => {
                          setSelected(i);
                          setMenu({ entry: e, x: event.x, y: event.y });
                        },
                      },
                      createElement(ListItem, {
                        width: contentW - Math.round(SPACE.lg * ui),
                        height: Math.round(40 * ui),
                        title: e.name,
                        subtitle: e.isDir
                          ? "Folder"
                          : `${mimeDb.mimeTypeForPath(e.path)} · ${formatSize(e.size)}`,
                        selected: selected === i,
                        interactive: false,
                        leading: createElement(Icon, {
                          name: iconFor(e),
                          size: Math.round(22 * ui),
                          color: e.isDir ? pal.accent : pal.text,
                        }),
                      }),
                    ),
                  ),
                ),
          ),
        ),
      ),
    ),
    menu
      ? createElement(ContextMenu, {
          viewportWidth: props.width,
          viewportHeight: props.height,
          x: menu.x,
          y: menu.y,
          title: menu.entry.name,
          actions: contextActions(menu.entry),
          onDismiss: () => setMenu(null),
        })
      : null,
    pickerEntry
      ? createElement(OpenWithPicker, {
          viewportWidth: props.width,
          viewportHeight: props.height,
          fileName: pickerEntry.name,
          mimeType: pickerMime,
          choices: pickerChoices,
          selectedId: pickerSelection,
          onSelect: setPickerSelection,
          onOpen: (id) => finishOpenWith(id, false),
          onMakeDefault: (id) => finishOpenWith(id, true),
          onDismiss: () => {
            setPickerEntry(null);
            setPickerSelection(null);
          },
        })
      : null,
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
  win.setContent((size) =>
    createElement(FilesApp, {
      ...size,
      initialPath: desktop,
      onQuit: () => {
        win.destroy();
        app.quit();
      },
    }),
  );
  win.onClose(() => app.quit());
  app.addWindow(win);
  await app.run();
}

main().catch((err) => {
  console.error("[files]", err);
  process.exit(1);
});
