/**
 * Moire Files — @moire/ui file browser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  Draggable,
  ScrollArea,
  themePalette,
  getUiScaleFactor,
  setUiScaleFactor,
  SPACE,
  TYPE_ROLES,
  type WindowSize,
  type IconName,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";

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

function openPath(p: string): void {
  spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
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

function FilesApp(
  props: WindowSize & { onQuit: () => void; initialPath: string },
): ReactNode {
  const pal = themePalette();
  const ui = getUiScaleFactor();
  const pad = Math.round(SPACE.lg * ui);
  const sideW = Math.round(168 * ui);
  const [cwd, setCwd] = useState(props.initialPath);
  const [selected, setSelected] = useState(-1);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [tick, setTick] = useState(0);
  const placeList = useMemo(() => places(), []);

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

  const openEntry = useCallback((e: Entry) => {
    if (e.isDir) {
      setCwd(e.path);
      setSelected(-1);
    } else {
      openPath(e.path);
    }
  }, []);

  const goUp = () => {
    const parent = path.dirname(cwd);
    if (parent !== cwd) {
      setCwd(parent);
      setSelected(-1);
    }
  };

  const onDropPayload = (payload: unknown) => {
    const paths = payloadToPaths(payload);
    for (const src of paths) {
      const dest = path.join(cwd, path.basename(src));
      try {
        if (src === dest) continue;
        fs.renameSync(src, dest);
      } catch {
        try {
          fs.copyFileSync(src, dest);
        } catch (err) {
          console.warn("[files] drop failed", src, err);
        }
      }
    }
    setTick((t) => t + 1);
  };

  const crumb = cwd.replace(home(), "~");
  const toolbarH = Math.round(48 * ui);
  const bodyH = Math.max(1, props.height - toolbarH - 1);
  const contentW = Math.max(1, props.width - sideW - 1);
  const cellW = Math.round(100 * ui);
  const cellH = Math.round(104 * ui);

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
          padding: pad,
          gap: Math.round(SPACE.sm * ui),
          align: "center",
        },
        createElement(Button, {
          width: Math.round(40 * ui),
          height: Math.round(30 * ui),
          label: "Up",
          variant: "secondary",
          onPress: goUp,
        }),
        createElement(Label, {
          text: crumb,
          width: Math.max(80, props.width - Math.round(200 * ui)),
          height: Math.round(22 * ui),
          fontSize: TYPE_ROLES.body.size,
        }),
        createElement(Button, {
          width: Math.round(56 * ui),
          height: Math.round(30 * ui),
          label: view === "grid" ? "List" : "Grid",
          variant: "ghost",
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
            text: "Places",
            color: pal.muted,
            fontSize: TYPE_ROLES.caption.size,
            width: sideW - pad,
            height: Math.round(18 * ui),
          }),
          ...placeList.map((p) =>
            createElement(ListItem, {
              key: p.id,
              width: sideW - Math.round(SPACE.lg * ui),
              height: Math.round(34 * ui),
              title: p.label,
              leading: createElement(Icon, {
                name: p.icon,
                size: Math.round(16 * ui),
              }),
              selected: cwd === p.path || cwd.startsWith(p.path + path.sep),
              onPress: () => {
                ensureDir(p.path);
                setCwd(p.path);
                setSelected(-1);
              },
            }),
          ),
        ),
        createElement(Separator, { width: 1, height: bodyH }),
        createElement(
          DropTarget,
          {
            width: contentW,
            height: bodyH,
            mimeTypes: ["text/uri-list"],
            onDrop: (payload) => onDropPayload(payload),
          },
          view === "grid"
            ? createElement(Grid, {
                width: contentW,
                height: bodyH,
                items: entries,
                itemWidth: cellW,
                itemHeight: cellH,
                gap: Math.round(SPACE.md * ui),
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
                    },
                    createElement(GridItem, {
                      width: cellW,
                      height: cellH,
                      label: e.name,
                      selected: selected === i,
                      icon: createElement(Icon, {
                        name: iconFor(e),
                        size: Math.round(40 * ui),
                        color: e.isDir ? pal.accent : pal.text,
                      }),
                      onPress: () => setSelected(i),
                      onDoublePress: () => openEntry(e),
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
                    entries.length * Math.round(40 * ui),
                  ),
                },
                ...entries.map((e, i) =>
                  createElement(
                    Draggable,
                    {
                      key: e.path,
                      x: 0,
                      y: i * Math.round(40 * ui),
                      width: contentW - 8,
                      height: Math.round(40 * ui),
                      mimeTypes: ["text/uri-list"],
                      getPayload: () => pathToUri(e.path) + "\n",
                    },
                    createElement(ListItem, {
                      width: contentW - 8,
                      height: Math.round(40 * ui),
                      title: e.name,
                      subtitle: e.isDir ? "Folder" : `${e.size} B`,
                      selected: selected === i,
                      leading: createElement(Icon, {
                        name: iconFor(e),
                        size: Math.round(18 * ui),
                      }),
                      onPress: () => setSelected(i),
                      onDoublePress: () => openEntry(e),
                    }),
                  ),
                ),
              ),
        ),
      ),
    ),
  );
}

async function main() {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const desktop = path.join(home(), "Desktop");
  ensureDir(desktop);

  const app = new Application();
  const win = new Window({
    title: "Files",
    appId: "org.moire.Files",
    width: Math.round(760 * settings.uiScale),
    height: Math.round(500 * settings.uiScale),
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
