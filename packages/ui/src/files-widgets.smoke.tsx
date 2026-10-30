/**
 * The Files redesign widgets in a real headless Window: keyboard, pointer, overflow into menus,
 * token removal and completion, drop-target highlights and reduced motion. Set
 * MOIRE_FILES_WIDGETS_CAPTURE_DIR to also write each panel as a PNG in dark and light, scale 1
 * and 1.5.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React, { useState, type ReactNode } from "react";
import { PNG } from "pngjs";
import { Group, Rect, type HitRegion, type SceneNode } from "@moire/react-host";
import {
  ChipGroup,
  FileTile,
  FilterChip,
  HoverActions,
  IconSegmentedControl,
  ItemCard,
  NavigationRail,
  NavigationSidebar,
  OverlayHost,
  SelectionBar,
  Surface,
  TextBlock,
  TokenField,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  selectionBarHeight,
  setUiScaleFactor,
  type ChipGroupItem,
  type NavigationRailSection,
  type TokenFieldCompletion,
  type TokenFieldToken,
  type WidgetTheme,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { tickMotionFrame } from "./motion";

await installUiFonts();

const KEY = {
  escape: [1, "Escape"],
  backspace: [14, "Backspace"],
  tab: [15, "Tab"],
  enter: [28, "Enter"],
  space: [57, " "],
  home: [102, "Home"],
  up: [103, "ArrowUp"],
  left: [105, "ArrowLeft"],
  right: [106, "ArrowRight"],
  end: [107, "End"],
  down: [108, "ArrowDown"],
} as const;
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
const GREEN = 0xff4fbf8a,
  BLUE = 0xff6aa6f0,
  PINK = 0xffe0709b,
  AMBER = 0xffd9a441,
  RED = 0xffe2685a;

function themeFor(colorScheme: "dark" | "light", reducedMotion = true): WidgetTheme {
  return createPersonalizedWidgetTheme(
    discoverPersonalization("linux", { themeFamily: "moire", colorScheme, reducedMotion }),
  );
}

type Internals = { root: { container: SceneNode }; hits: HitRegion[]; focusedId: string | null };

/** A real Window around `view`, with input and inspection helpers. */
async function open(view: () => ReactNode, width: number, height: number, theme: WidgetTheme) {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Files widgets", width, height, decorated: false });
  window.setContent(() => (
    <WidgetThemeProvider theme={theme}>
      <OverlayHost width={width} height={height}>
        <Surface width={width} height={height} fill={theme.foundations.palette.bg}>
          {view()}
        </Surface>
      </OverlayHost>
    </WidgetThemeProvider>
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0]!;
  const internals = window as unknown as Internals;
  let time = 1;
  const settle = async (frames = 30) => {
    for (let frame = 0; frame < frames; frame++) {
      tickMotionFrame(1 / 60);
      window.requestRedraw();
      window.tick();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const key = async (which: keyof typeof KEY, text?: string) => {
    const [code, name] = KEY[which];
    native.injectKey({ type: "down", code, key: name, text, modifiers, timeMs: time++ });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: time++ });
    await settle(4);
  };
  const type = async (text: string) => {
    for (const char of text) {
      native.injectKey({ type: "down", code: 0, key: char, text: char, modifiers, timeMs: time++ });
      native.injectKey({ type: "up", code: 0, key: char, modifiers, timeMs: time++ });
      await settle(2);
    }
  };
  const center = (hit: { x: number; y: number; width: number; height: number }) => ({
    x: hit.x + hit.width / 2,
    y: hit.y + hit.height / 2,
  });
  const click = async (at: { x: number; y: number }, button: "left" | "right" = "left") => {
    native.injectPointer({ type: "move", ...at, timeMs: time++ });
    native.injectPointer({ type: "down", button, ...at, timeMs: time++ });
    native.injectPointer({ type: "up", button, ...at, timeMs: time++ });
    await settle(6);
  };
  const move = async (at: { x: number; y: number }) => {
    native.injectPointer({ type: "move", ...at, timeMs: time++ });
    await settle(6);
  };
  const texts = () => {
    const found: { text: string; x: number; y: number }[] = [];
    const walk = (node: SceneNode, x: number, y: number) => {
      x += node.x;
      y += node.y;
      if (node.kind === "text" && node.text) found.push({ text: node.text, x, y });
      node.children.forEach((child) => walk(child, x, y));
    };
    walk(internals.root.container, 0, 0);
    return found;
  };
  const textAt = (label: string) => {
    const found = texts().find((entry) => entry.text === label);
    assert.ok(found, `"${label}" is painted`);
    return { x: found.x + 2, y: found.y + 4 };
  };
  const hit = (predicate: (hit: HitRegion) => boolean, what: string) => {
    const found = internals.hits.find(predicate);
    assert.ok(found, `hit region for ${what}`);
    return found;
  };
  const byFocus = (suffix: string) => hit((h) => !!h.focusId?.endsWith(suffix), suffix);
  /** Rects painted with the theme's drop-target feedback. */
  const dropFeedback = () => {
    const style = theme.recipes.dnd.dropTarget;
    let count = 0;
    const walk = (node: SceneNode) => {
      if (
        node.kind === "rect" &&
        node.fill === style.fill &&
        node.stroke === style.stroke &&
        node.strokeWidth === style.strokeWidth
      )
        count++;
      node.children.forEach(walk);
    };
    walk(internals.root.container);
    return count;
  };
  const frame = () => Uint8Array.from(native.lastFrame!);
  const capture = (file: string) => {
    const bytes = frame();
    const png = new PNG({ width, height });
    for (let offset = 0; offset < bytes.length; offset += 4) {
      png.data[offset] = bytes[offset + 2]!;
      png.data[offset + 1] = bytes[offset + 1]!;
      png.data[offset + 2] = bytes[offset]!;
      png.data[offset + 3] = 255;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(png));
  };
  await settle();
  return {
    window,
    internals,
    settle,
    key,
    type,
    click,
    move,
    center,
    texts,
    textAt,
    hit,
    byFocus,
    dropFeedback,
    frame,
    capture,
    focused: () => internals.focusedId,
    close: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- Fixtures ---------- */

const RAIL_SECTIONS: NavigationRailSection[] = [
  {
    id: "places",
    label: "Places",
    items: [
      { id: "home", label: "Home", icon: "home", dropData: "/home/me" },
      { id: "recent", label: "Recent", icon: "history" },
      { id: "documents", label: "Documents", icon: "document", dropData: "/home/me/Documents" },
      { id: "downloads", label: "Downloads", icon: "downloads", badge: 3 },
      { id: "pictures", label: "Pictures", icon: "image" },
      { id: "trash", label: "Trash", icon: "trash", dropData: "trash:" },
    ],
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    items: [
      { id: "projects", label: "Projects", icon: "folder", tint: 0xff8b7cf6 },
      { id: "archive", label: "Old archive", icon: "archive", disabled: true },
    ],
  },
  {
    id: "drives",
    label: "Drives",
    placement: "end",
    items: [{ id: "usb", label: "USB stick", icon: "disk-usage" }],
  },
];

const FILTERS: ChipGroupItem[] = [
  { id: "all", label: "All", count: 10 },
  { id: "folders", label: "Folders", count: 3 },
  { id: "images", label: "Images", count: 1 },
  { id: "documents", label: "Documents", count: 4 },
  { id: "audio", label: "Audio", count: 1 },
  { id: "video", label: "Video", count: 2 },
  { id: "archives", label: "Archives", count: 1 },
];

const KINDS: ChipGroupItem[] = [
  { id: "images", label: "Images", count: "1,204", icon: "image", tint: GREEN },
  { id: "documents", label: "Documents", count: 312, icon: "document", tint: BLUE },
  { id: "audio", label: "Audio", count: 88, icon: "music", tint: PINK },
  { id: "video", label: "Video", count: 14, icon: "video", tint: 0xffe39a6a },
  { id: "archives", label: "Archives", count: 12, icon: "archive", tint: AMBER },
  { id: "large", label: "Large files", count: 9, icon: "disk-usage" },
];

const KIND_COMPLETIONS: TokenFieldCompletion[] = [
  {
    id: "kind:image",
    label: "kind:image",
    detail: "1,204 files",
    icon: "image",
    tint: GREEN,
    token: { id: "kind:image", label: "kind: image", tint: GREEN },
  },
  {
    id: "kind:document",
    label: "kind:document",
    detail: "312 files",
    icon: "document",
    tint: BLUE,
    token: { id: "kind:document", label: "kind: document", tint: BLUE },
  },
  {
    id: "kind:audio",
    label: "kind:audio",
    detail: "88 files",
    icon: "music",
    tint: PINK,
    token: { id: "kind:audio", label: "kind: audio", tint: PINK },
  },
];

const ACTIONS = [
  { id: "open", label: "Open", icon: "forward" as const },
  { id: "copy", label: "Copy", icon: "document" as const },
  { id: "move", label: "Move to…", icon: "folder" as const },
  { id: "trash", label: "Trash", icon: "trash" as const, tone: "danger" as const },
  { id: "rename", label: "Rename", icon: "editor" as const },
];

/** A stand-in photo for thumbnail slots. */
function Landscape(props: { width: number; height: number; seed: number }): ReactNode {
  const sky = [0xff6d8fd8, 0xffe39a6a, 0xff7a5fc0][props.seed % 3]!;
  const land = [0xff3f6e55, 0xff7a4a3a, 0xff2f3c6a][props.seed % 3]!;
  const sun = Math.round(Math.min(props.width, props.height) * 0.16);
  return (
    <Group width={props.width} height={props.height}>
      <Rect width={props.width} height={props.height} fill={sky} radius={8} />
      <Rect
        y={Math.round(props.height * 0.62)}
        width={props.width}
        height={props.height - Math.round(props.height * 0.62)}
        fill={land}
        radius={8}
      />
      <Rect
        x={Math.round(props.width * 0.68)}
        y={Math.round(props.height * 0.16)}
        width={sun}
        height={sun}
        radius={sun / 2}
        fill={0xfff6e7b0}
      />
    </Group>
  );
}

/* ---------- Panels: one per widget group, used for captures and rendering checks ---------- */

function RailPanel(props: { s: number; height: number }): ReactNode {
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState("home");
  const s = props.s;
  return (
    <>
      <NavigationRail
        height={props.height}
        sections={RAIL_SECTIONS}
        selectedId={selected}
        onSelect={(item) => setSelected(item.id)}
      />
      <NavigationRail
        x={80 * s}
        height={props.height}
        sections={RAIL_SECTIONS}
        selectedId={selected}
        expanded={expanded}
        onSelect={(item) => setSelected(item.id)}
        header={
          <TextBlock
            x={20 * s}
            width={160 * s}
            height={60 * s}
            text="Files"
            fontSize={14}
            fontWeight="medium"
            verticalAlign="center"
          />
        }
        footer={
          <FilterChip
            x={12 * s}
            y={12 * s}
            label={expanded ? "Collapse" : "Expand"}
            onPress={() => setExpanded(!expanded)}
          />
        }
      />
      {/* A sidebar shorter than its footer and two rows: the footer scrolls with the rows. */}
      <NavigationSidebar
        x={300 * s}
        width={220 * s}
        height={110 * s}
        sections={[{ id: "places", items: RAIL_SECTIONS[0]!.items.slice(0, 3) }]}
        footer={<TextBlock width={180 * s} height={36 * s} text="160 GB free" fontSize={11} />}
        footerHeight={60 * s}
      />
    </>
  );
}

function ChipsPanel(props: { s: number }): ReactNode {
  const s = props.s;
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("list");
  return (
    <>
      <IconSegmentedControl
        x={16 * s}
        y={16 * s}
        options={[
          { id: "list", icon: "list", label: "List" },
          { id: "grid", icon: "grid", label: "Grid" },
          { id: "columns", icon: "columns", label: "Columns" },
        ]}
        value={view}
        onChange={setView}
      />
      <FilterChip x={140 * s} y={17 * s} label="Anywhere" selected />
      <FilterChip x={240 * s} y={17 * s} label="USB stick" icon="disk-usage" count="20 GB free" />
      <ChipGroup
        x={16 * s}
        y={64 * s}
        width={420 * s}
        chips={FILTERS}
        selectedId={filter}
        onSelect={(chip) => setFilter(chip.id)}
      />
      <ChipGroup x={16 * s} y={112 * s} width={520 * s} chips={KINDS} wrap />
    </>
  );
}

function TokenPanel(props: { s: number; autoFocus?: boolean }): ReactNode {
  const s = props.s;
  const [tokens, setTokens] = useState<TokenFieldToken[]>([
    { id: "kind:image", label: "kind: image", tint: GREEN },
    { id: "when:week", label: "when: this week", tint: BLUE },
  ]);
  const [value, setValue] = useState("kind:");
  return (
    <TokenField
      x={16 * s}
      y={16 * s}
      width={560 * s}
      height={44 * s}
      tokens={tokens}
      value={value}
      placeholder="Search Projects"
      trailingText="14 results"
      autoFocus={props.autoFocus}
      completions={value.startsWith("kind:") ? KIND_COMPLETIONS : []}
      onChange={setValue}
      onTokensChange={setTokens}
    />
  );
}

function SelectionPanel(props: { s: number }): ReactNode {
  const s = props.s;
  const bar = selectionBarHeight();
  return (
    <>
      <SelectionBar
        y={16 * s}
        width={640 * s}
        count={2}
        detail="selected · 4.4 MB"
        actions={ACTIONS.slice(0, 4)}
      />
      <SelectionBar
        y={32 * s + bar}
        width={420 * s}
        count={12}
        detail="selected · 1.2 GB"
        actions={ACTIONS}
      />
    </>
  );
}

function ItemsPanel(props: { s: number }): ReactNode {
  const s = props.s;
  const pal = themeRef.current!.foundations.palette;
  const tile = 112 * s;
  return (
    <>
      <FileTile
        x={16 * s}
        y={16 * s}
        width={tile}
        name="Design"
        detail="12 items"
        icon="folder-filled"
      />
      <FileTile
        x={16 * s + (tile + 16 * s)}
        y={16 * s}
        width={tile}
        name="Holiday in Lisbon.jpg"
        detail="3.1 MB"
        selected
        thumbnail={({ width, height }) => <Landscape width={width} height={height} seed={0} />}
      />
      <FileTile
        x={16 * s + (tile + 16 * s) * 2}
        y={16 * s}
        width={tile}
        name="Launch plan with a long name.pdf"
        detail="1.2 MB"
        icon="document"
        tint={RED}
        extension="pdf"
        hovered
      />
      <FileTile
        x={16 * s + (tile + 16 * s) * 3}
        y={16 * s}
        width={tile}
        name="Night drive.mp3"
        detail="4.2 MB"
        icon="music"
        tint={PINK}
        extension="mp3"
        dropTarget
      />
      <FileTile
        x={16 * s + (tile + 16 * s) * 4}
        y={16 * s}
        width={tile}
        name="site-backup.tar.gz"
        detail="86 MB"
        icon="archive"
        tint={AMBER}
        extension="gz"
        focused
      />
      {(
        [
          ["Projects", "10 items", 0xff8b7cf6],
          ["Photos", "248 items", GREEN],
          ["Invoices", "36 items", 0xffe39a6a],
        ] as const
      ).map(([title, detail, tint], index) => (
        <ItemCard
          key={title}
          x={16 * s + index * 212 * s}
          y={210 * s}
          width={200 * s}
          icon="folder-filled"
          tint={tint}
          title={title}
          detail={detail}
          selected={index === 2}
        />
      ))}
      {(
        [
          ["Music", "1,204 items", BLUE],
          ["Downloads", "18 items", AMBER],
        ] as const
      ).map(([title, detail, tint], index) => (
        <ItemCard
          key={title}
          x={16 * s + index * 212 * s}
          y={280 * s}
          width={200 * s}
          layout="stacked"
          icon="folder-filled"
          tint={tint}
          title={title}
          detail={detail}
          onMenu={() => {}}
        />
      ))}
      {[false, true].map((active, index) => (
        <Group
          key={String(active)}
          x={440 * s}
          y={(280 + index * 50) * s}
          width={240 * s}
          height={46 * s}
        >
          <Rect
            width={240 * s}
            height={46 * s}
            radius={10 * s}
            fill={active ? pal.surface : 0x00000000}
          />
          <TextBlock
            x={12 * s}
            width={100 * s}
            height={46 * s}
            text={active ? "readme.md" : "todo.txt"}
            fontSize={13}
            verticalAlign="center"
          />
          <HoverActions
            x={100 * s}
            width={132 * s}
            height={46 * s}
            active={active}
            trailing="Yesterday"
            actions={[
              { id: "open", label: "Open", icon: "forward" },
              { id: "copy", label: "Copy", icon: "document" },
              { id: "trash", label: "Move to Trash", icon: "trash", tone: "danger" },
            ]}
          />
        </Group>
      ))}
    </>
  );
}

const themeRef: { current: WidgetTheme | null } = { current: null };

/* ---------- Captures and rendering checks across schemes and scales ---------- */

const captureDir = process.env.MOIRE_FILES_WIDGETS_CAPTURE_DIR;
let panels = 0;
try {
  for (const scheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const theme = themeFor(scheme);
      themeRef.current = theme;
      const sized = (w: number, h: number) =>
        [Math.round(w * scale), Math.round(h * scale)] as const;
      const shots: [string, () => ReactNode, readonly [number, number]][] = [
        ["rail", () => <RailPanel s={scale} height={Math.round(520 * scale)} />, sized(540, 520)],
        ["chips", () => <ChipsPanel s={scale} />, sized(560, 200)],
        ["token-field", () => <TokenPanel s={scale} autoFocus />, sized(600, 220)],
        ["selection-bar", () => <SelectionPanel s={scale} />, sized(660, 130)],
        ["items", () => <ItemsPanel s={scale} />, sized(700, 390)],
      ];
      for (const [name, view, [width, height]] of shots) {
        const window = await open(view, width, height, theme);
        try {
          // Nothing paints past the panel: every text starts inside it.
          for (const text of window.texts())
            assert.ok(
              text.x >= 0 && text.y >= 0 && text.x < width && text.y < height,
              `${name}/${scheme}/${scale}: "${text.text}" inside the panel`,
            );
          if (name === "token-field")
            assert.ok(
              window.texts().some((text) => text.text === "kind:document"),
              "focused token field lists completions",
            );
          if (name === "rail") {
            // Too short to pin the footer under two rows, the sidebar scrolls it after the rows.
            const sidebar = window.texts().filter((text) => text.x >= 300 * scale);
            const footer = sidebar.find((text) => text.text === "160 GB free");
            const lastRow = sidebar.find((text) => text.text === "Documents");
            assert.ok(footer && lastRow && footer.y > lastRow.y, "the footer follows the rows");
          }
          if (captureDir) window.capture(path.join(captureDir, `${name}-${scheme}-${scale}.png`));
          panels++;
        } finally {
          window.close();
        }
      }
    }
} finally {
  setUiScaleFactor(1);
}

/* ---------- Behaviour, at scale 1 ---------- */

const theme = themeFor("dark");
themeRef.current = theme;

// NavigationRail: arrows move focus, Enter selects, pointer, context menu, tooltip, drop target.
{
  const selections: string[] = [];
  const menus: string[] = [];
  let expanded = false;
  const window = await open(
    () => (
      <NavigationRail
        height={520}
        sections={RAIL_SECTIONS}
        selectedId="home"
        expanded={expanded}
        onSelect={(item) => selections.push(item.id)}
        onContextMenu={(item) => menus.push(item.id)}
      />
    ),
    300,
    520,
    theme,
  );
  try {
    await window.key("tab");
    assert.ok(window.focused()?.endsWith(":home"), "Tab reaches the first rail item");
    await window.key("down");
    await window.key("down");
    assert.ok(window.focused()?.endsWith(":documents"), "Down moves focus without selecting");
    assert.deepEqual(selections, []);
    await window.key("enter");
    assert.deepEqual(selections, ["documents"], "Enter selects the focused item");
    await window.key("end");
    assert.ok(window.focused()?.endsWith(":usb"), "End reaches the pinned drive section");
    await window.key("up");
    assert.ok(window.focused()?.endsWith(":projects"), "Up skips the disabled item");
    await window.key("home");
    assert.ok(window.focused()?.endsWith(":home"));
    // Focus shows the item's tooltip after its delay (collapsed rails have no labels).
    await sleep(400);
    await window.settle();
    assert.ok(
      window.texts().some((text) => text.text === "Home"),
      "focus shows the tooltip",
    );
    await window.click(window.center(window.byFocus(":pictures")));
    assert.equal(selections.at(-1), "pictures", "a press selects");
    await window.click(window.center(window.byFocus(":trash")), "right");
    assert.deepEqual(menus, ["trash"], "secondary click asks for the item's menu");
    assert.ok(
      !window.internals.hits.some((h) => h.focusId?.endsWith(":archive") && h.onPress),
      "a disabled item takes no presses",
    );
    const trash = window.center(window.byFocus(":trash"));
    assert.equal(window.window.hitTestData(trash.x, trash.y), "trash:");
    assert.equal(window.dropFeedback(), 0);
    window.window.updateDropHover(trash.x, trash.y);
    await window.settle(4);
    assert.equal(window.dropFeedback(), 1, "a drag over a drop target highlights it");
    window.window.clearDropHover();
    await window.settle(4);
    assert.equal(window.dropFeedback(), 0);
    expanded = true;
    window.window.requestRedraw();
    await window.settle();
    assert.ok(
      window.texts().some((text) => text.text === "Downloads"),
      "expanded shows labels",
    );
    assert.ok(
      window.texts().some((text) => text.text === "Bookmarks"),
      "and section labels",
    );
    assert.ok(
      window.texts().some((text) => text.text === "3"),
      "and badges",
    );
  } finally {
    window.close();
  }
}

// NavigationRail: stable focus ids and a hover action (eject) in both modes.
for (const expanded of [false, true]) {
  const ejected: string[] = [];
  const window = await open(
    () => (
      <NavigationRail
        height={400}
        idPrefix="places"
        expanded={expanded}
        sections={[
          { id: "places", items: [{ id: "home", label: "Home", icon: "home" }] },
          {
            id: "drives",
            items: [
              {
                id: "usb",
                label: "USB stick",
                icon: "disk-usage",
                action: {
                  icon: "eject",
                  label: "Eject USB stick",
                  onPress: () => ejected.push("usb"),
                },
              },
            ],
          },
        ]}
      />
    ),
    240,
    400,
    theme,
  );
  try {
    const usb = window.byFocus("places:usb");
    assert.equal(usb.focusId, "places:usb", "idPrefix names the focus ids");
    assert.ok(
      !window.internals.hits.some((h) => h.focusId === "places:usb:action"),
      "the action hides at rest",
    );
    await window.move(window.center(usb));
    const action = window.byFocus("places:usb:action");
    assert.ok(
      action.x + action.width <= usb.x + usb.width + 6 && action.y >= usb.y - 6,
      "the action sits on its item",
    );
    await window.click(window.center(action));
    assert.deepEqual(ejected, ["usb"], `pressing the action runs it (expanded=${expanded})`);
  } finally {
    window.close();
  }
}

// ChipGroup: overflow into "More", menu choice, arrow keys, wrapping.
{
  const selected: string[] = [];
  let wrap = false;
  const window = await open(
    () => (
      <ChipGroup
        x={10}
        y={10}
        width={360}
        chips={FILTERS}
        selectedId="all"
        wrap={wrap}
        onSelect={(chip) => selected.push(chip.id)}
      />
    ),
    420,
    360,
    theme,
  );
  try {
    const labels = () => window.texts().map((text) => text.text);
    assert.ok(labels().includes("More"), "chips that don't fit go into More");
    assert.ok(!labels().includes("Archives"), "the last chip is hidden");
    await window.key("tab");
    await window.key("right");
    await window.key("right");
    await window.key("enter");
    assert.deepEqual(selected, ["images"], "arrows move between chips, Enter presses");
    await window.key("end");
    assert.ok(window.focused()?.endsWith("chip-group:more"), "End reaches More");
    await window.key("enter");
    assert.ok(labels().includes("Archives"), "More opens a menu of the hidden chips");
    await window.click(window.textAt("Archives"));
    await window.settle(40);
    assert.equal(selected.at(-1), "archives", "choosing from the menu selects the chip");
    assert.ok(!labels().includes("Archives"), "and closes the menu");
    await window.click(window.textAt("Folders"));
    assert.equal(selected.at(-1), "folders", "a press selects");
    wrap = true;
    window.window.requestRedraw();
    await window.settle();
    assert.ok(!labels().includes("More"), "wrapping shows every chip");
    const archives = window.texts().find((text) => text.text === "Archives")!;
    assert.ok(archives.y > 10 + 30, "on a second row");
  } finally {
    window.close();
  }
}

// IconSegmentedControl: pointer, arrows, tooltip.
{
  let value = "list";
  const window = await open(
    () => (
      <IconSegmentedControl
        x={20}
        y={20}
        options={[
          { id: "list", icon: "list", label: "List view" },
          { id: "grid", icon: "grid", label: "Grid view" },
          { id: "columns", icon: "columns", label: "Columns view" },
        ]}
        value={value}
        onChange={(next) => {
          value = next;
          window.window.requestRedraw();
        }}
      />
    ),
    240,
    140,
    theme,
  );
  try {
    await window.click(window.center(window.byFocus(":grid")));
    assert.equal(value, "grid");
    await window.key("right");
    assert.equal(value, "columns", "arrows choose the next segment");
    await window.key("right");
    assert.equal(value, "list", "and wrap around");
    await window.key("left");
    assert.equal(value, "columns");
    await sleep(400);
    await window.settle();
    assert.ok(
      window.texts().some((text) => text.text === "Columns view"),
      "focus shows its label",
    );
  } finally {
    window.close();
  }
}

// TokenField: completion with Tab and Enter, Backspace removal, submit, Escape, pointer accept.
{
  let tokens: TokenFieldToken[] = [];
  let value = "";
  const submits: string[] = [];
  let escapes = 0;
  const outside: string[] = [];
  const window = await open(
    () => (
      <TokenField
        x={10}
        y={10}
        width={460}
        tokens={tokens}
        value={value}
        focusId="search"
        placeholder="Search"
        completions={value.startsWith("kind:") ? KIND_COMPLETIONS : []}
        onChange={(next) => {
          value = next;
          window.window.requestRedraw();
        }}
        onTokensChange={(next) => {
          tokens = next;
          window.window.requestRedraw();
        }}
        onSubmit={(text, current) =>
          submits.push(`${current.map((token) => token.id).join(",")}|${text}`)
        }
        onEscape={() => escapes++}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return false;
          outside.push("down");
          return true;
        }}
      />
    ),
    480,
    300,
    theme,
  );
  try {
    await window.key("tab");
    assert.equal(window.focused(), "search");
    await window.type("kind:");
    assert.ok(
      window.texts().some((text) => text.text === "kind:document"),
      "completions show",
    );
    await window.key("down");
    assert.deepEqual(outside, [], "the open list keeps its own arrows");
    await window.key("tab");
    assert.deepEqual(
      tokens.map((token) => token.id),
      ["kind:document"],
      "Tab accepts the highlighted completion as a token",
    );
    await window.key("down");
    assert.deepEqual(outside, ["down"], "with no list, onKeyDown sees the arrows");
    assert.equal(value, "", "and clears the typed text");
    assert.equal(window.focused(), "search", "focus stays in the field");
    assert.ok(
      window.texts().some((text) => text.text === "kind: document"),
      "the token shows",
    );
    await window.type("kind:");
    await window.key("enter");
    assert.deepEqual(
      tokens.map((token) => token.id),
      ["kind:document", "kind:image"],
      "Enter accepts too",
    );
    await window.type("kind:");
    await window.key("escape");
    assert.ok(!window.texts().some((text) => text.text === "kind:audio"), "Escape closes the list");
    assert.equal(escapes, 0, "without leaving the search");
    await window.key("enter");
    assert.deepEqual(submits, ["kind:document,kind:image|kind:"], "Enter with no list submits");
    for (let index = 0; index < 5; index++) await window.key("backspace");
    assert.equal(value, "");
    assert.equal(tokens.length, 2, "Backspace edits text before tokens");
    await window.key("backspace");
    assert.deepEqual(
      tokens.map((token) => token.id),
      ["kind:document"],
      "Backspace in empty text removes the last token",
    );
    await window.key("escape");
    assert.equal(escapes, 1, "Escape with no list calls onEscape");
    // Pointer: pressing a completion accepts it and gives focus back to the field.
    await window.type("kind:");
    const audio = window.textAt("kind:audio");
    await window.move(audio);
    await window.click(audio);
    await window.settle();
    assert.deepEqual(
      tokens.map((token) => token.id),
      ["kind:document", "kind:audio"],
      "a pressed completion is accepted",
    );
    assert.equal(window.focused(), "search", "and the field keeps focus");
    await window.type("x");
    assert.equal(value, "x", "typing continues in the field");
    // A token's close button removes that token.
    const chip = window.textAt("kind: document");
    const close = window.hit(
      (h) => !!h.onPress && !h.focusable && h.y < chip.y + 20 && h.x > chip.x + 40,
      "token close button",
    );
    await window.click(window.center(close));
    assert.deepEqual(
      tokens.map((token) => token.id),
      ["kind:audio"],
      "close removes the token",
    );
    assert.equal(window.focused(), "search", "and focus returns to the field");
  } finally {
    window.close();
  }
}

// SelectionBar: everything fits, overflow into ⋯, reduced motion vs entrance motion.
{
  const ran: string[] = [];
  let width = 700;
  const window = await open(
    () => (
      <SelectionBar
        y={300}
        width={width}
        count={3}
        detail="selected · 4.4 MB"
        actions={ACTIONS}
        onAction={(action) => ran.push(action.id)}
      />
    ),
    720,
    360,
    theme,
  );
  try {
    const labels = () => window.texts().map((text) => text.text);
    for (const action of ACTIONS) assert.ok(labels().includes(action.label), `${action.id} fits`);
    await window.click(window.textAt("Copy"));
    assert.deepEqual(ran, ["copy"]);
    width = 420;
    window.window.requestRedraw();
    await window.settle();
    assert.ok(labels().includes("Open"), "the first actions stay");
    assert.ok(!labels().includes("Rename"), "the last ones move to ⋯");
    const more = window.hit(
      (h) => !!h.focusId?.startsWith("icon-button:") && h.y > 300,
      "more button",
    );
    await window.click(window.center(more));
    assert.ok(labels().includes("Rename"), "⋯ lists the actions that didn't fit");
    const rename = window.textAt("Rename");
    assert.ok(rename.y < 300, "the menu opens above the bar");
    await window.click(rename);
    await window.settle(40);
    assert.equal(ran.at(-1), "rename", "a menu action runs");
  } finally {
    window.close();
  }
  // With reduced motion the first frame is already the settled bar; otherwise it rises in.
  for (const reduced of [true, false]) {
    const motionTheme = themeFor("dark", reduced);
    const backend = new HeadlessPlatform();
    await backend.connect();
    const bar = new Window({ title: "bar", width: 640, height: 120, decorated: false });
    bar.setContent(() => (
      <WidgetThemeProvider theme={motionTheme}>
        <Surface width={640} height={120} fill={motionTheme.foundations.palette.bg}>
          <SelectionBar
            y={40}
            width={640}
            count={2}
            detail="selected"
            actions={ACTIONS.slice(0, 3)}
          />
        </Surface>
      </WidgetThemeProvider>
    ));
    bar.mount(backend);
    await Promise.resolve();
    const native = backend.getWindows()[0]!;
    bar.tick();
    const first = Uint8Array.from(native.lastFrame!);
    for (let frame = 0; frame < 90; frame++) {
      tickMotionFrame(1 / 60);
      bar.requestRedraw();
      bar.tick();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const settled = Uint8Array.from(native.lastFrame!);
    if (reduced) assert.deepEqual(first, settled, "reduced motion shows the bar settled at once");
    else assert.notDeepEqual(first, settled, "the bar animates in otherwise");
    bar.destroy();
    backend.disconnect();
  }
}

// FileTile and ItemCard: press, double press, Enter, context menu, menu button, hover, drops.
{
  const events: string[] = [];
  const window = await open(
    () => (
      <>
        <FileTile
          x={10}
          y={10}
          name="Design"
          detail="12 items"
          icon="folder-filled"
          focusId="tile:design"
          dropData="/home/me/Design"
          onPress={() => events.push("press")}
          onDoublePress={() => events.push("open")}
          onContextMenu={() => events.push("menu")}
        />
        <ItemCard
          x={160}
          y={10}
          width={220}
          icon="folder-filled"
          title="Projects"
          detail="10 items"
          focusId="card:projects"
          dropData="/home/me/Projects"
          onPress={() => events.push("card")}
          onMenu={() => events.push("card-menu")}
        />
      </>
    ),
    400,
    220,
    theme,
  );
  try {
    const tile = window.byFocus("tile:design");
    const before = window.frame();
    await window.move(window.center(tile));
    assert.notDeepEqual(window.frame(), before, "hover changes the tile");
    await window.click(window.center(tile));
    assert.deepEqual(events, ["press"]);
    await window.click(window.center(tile));
    assert.deepEqual(events, ["press", "open"], "a double press opens");
    await window.click(window.center(tile), "right");
    assert.equal(events.at(-1), "menu");
    await window.key("enter");
    assert.equal(events.at(-1), "open", "Enter on the focused tile opens");
    const point = window.center(tile);
    window.window.updateDropHover(point.x, point.y);
    await window.settle(4);
    assert.equal(window.dropFeedback(), 1, "the tile highlights as a drop target");
    window.window.clearDropHover();
    const card = window.byFocus("card:projects");
    await window.click({ x: card.x + 30, y: card.y + card.height / 2 });
    assert.equal(events.at(-1), "card");
    const menu = window.hit(
      (h) => !!h.focusId?.startsWith("icon-button:") && h.x > card.x,
      "card menu button",
    );
    await window.click(window.center(menu));
    assert.equal(events.at(-1), "card-menu", "⋯ calls onMenu, not onPress");
    assert.equal(events.filter((event) => event === "card").length, 1);
    const target = window.center(card);
    window.window.updateDropHover(target.x, target.y);
    await window.settle(4);
    assert.equal(window.dropFeedback(), 1, "the card highlights as a drop target");
    assert.equal(window.window.hitTestData(target.x, target.y), "/home/me/Projects");
    window.window.clearDropHover();
  } finally {
    window.close();
  }
}

// HoverActions: trailing text at rest, actions when active, and they stay while focused.
{
  let active = false;
  const ran: string[] = [];
  const window = await open(
    () => (
      <HoverActions
        x={10}
        y={10}
        width={200}
        height={46}
        active={active}
        trailing="Yesterday"
        actions={[
          { id: "open", label: "Open", icon: "forward" },
          { id: "trash", label: "Move to Trash", icon: "trash", tone: "danger" },
        ]}
        onAction={(action) => ran.push(action.id)}
      />
    ),
    240,
    120,
    theme,
  );
  try {
    const labels = () => window.texts().map((text) => text.text);
    assert.ok(labels().includes("Yesterday"), "inactive shows the trailing text");
    assert.ok(!window.internals.hits.some((h) => h.focusId?.startsWith("icon-button:")));
    active = true;
    window.window.requestRedraw();
    await window.settle();
    assert.ok(!labels().includes("Yesterday"), "active swaps it for the actions");
    const buttons = window.internals.hits.filter((h) => h.focusId?.startsWith("icon-button:"));
    assert.equal(buttons.length, 2);
    await window.click(window.center(buttons[1]!));
    assert.deepEqual(ran, ["trash"]);
    await window.key("tab");
    active = false;
    window.window.requestRedraw();
    await window.settle();
    assert.ok(
      window.internals.hits.some((h) => h.focusId === window.focused()),
      "a focused action keeps the actions up after the row goes inactive",
    );
    await window.key("enter");
    assert.equal(ran.length, 2, "and Enter runs it");
  } finally {
    window.close();
  }
}

console.log(
  `[ui/files-widgets] ${panels} panel renders (dark/light × scale 1/1.5) and rail, chips, segments, token field, selection bar, tiles, cards and hover actions behaviour passed`,
);
