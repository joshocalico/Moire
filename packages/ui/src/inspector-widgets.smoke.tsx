/**
 * The Files inspector widgets (MetaPill, TagChip, ColourStrip, Histogram, StackedBar, PageStepper
 * and compact PropertyList) in a real headless Window: measured sizes scale with the UI, nothing
 * paints outside its measured box, and chips, the tag field and the page stepper respond to
 * pointer and keys. Set MOIRE_CAPTURE_DIR to also write the panel as a PNG in dark and light,
 * scale 1 and 1.5.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React, { type ReactNode } from "react";
import { PNG } from "pngjs";
import { Group, measureTextBounds, type HitRegion, type SceneNode } from "@moire/react-host";
import {
  ColourStrip,
  Histogram,
  MetaPill,
  OverlayHost,
  PageStepper,
  PropertyList,
  StackedBar,
  Surface,
  TagChip,
  Window,
  WidgetThemeProvider,
  colourStripWidth,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  layoutTagChips,
  metaPillHeight,
  metaPillWidth,
  pageStepperHeight,
  pageStepperWidth,
  propertyListHeight,
  setUiScaleFactor,
  stackedBarHeight,
  tagChipHeight,
  tagChipWidth,
  type PropertyListItem,
  type StackedBarSegment,
  type WidgetTheme,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { tickMotionFrame } from "./motion";

await installUiFonts();

const KEY = {
  escape: [1, "Escape"],
  tab: [15, "Tab"],
  enter: [28, "Enter"],
  left: [105, "ArrowLeft"],
  right: [106, "ArrowRight"],
  delete: [111, "Delete"],
} as const;
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };

function themeFor(colorScheme: "dark" | "light"): WidgetTheme {
  return createPersonalizedWidgetTheme(
    discoverPersonalization("linux", { themeFamily: "moire", colorScheme, reducedMotion: true }),
  );
}

type Internals = { root: { container: SceneNode }; hits: HitRegion[]; focusedId: string | null };

/** A real Window around `view`, with input and inspection helpers. */
async function open(view: () => ReactNode, width: number, height: number, theme: WidgetTheme) {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Inspector widgets", width, height, decorated: false });
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
  const settle = async (frames = 20) => {
    for (let frame = 0; frame < frames; frame++) {
      tickMotionFrame(1 / 60);
      window.requestRedraw();
      window.tick();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const key = async (which: keyof typeof KEY) => {
    const [code, name] = KEY[which];
    native.injectKey({ type: "down", code, key: name, modifiers, timeMs: time++ });
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
  const click = async (at: { x: number; y: number }) => {
    native.injectPointer({ type: "move", ...at, timeMs: time++ });
    native.injectPointer({ type: "down", button: "left", ...at, timeMs: time++ });
    native.injectPointer({ type: "up", button: "left", ...at, timeMs: time++ });
    await settle(6);
  };
  const center = (hit: { x: number; y: number; width: number; height: number }) => ({
    x: hit.x + hit.width / 2,
    y: hit.y + hit.height / 2,
  });
  const texts = () => {
    const found: { text: string; x: number; y: number; node: SceneNode }[] = [];
    const walk = (node: SceneNode, x: number, y: number) => {
      x += node.x;
      y += node.y;
      if (node.kind === "text" && node.text) found.push({ text: node.text, x, y, node });
      node.children.forEach((child) => walk(child, x, y));
    };
    walk(internals.root.container, 0, 0);
    return found;
  };
  const byFocus = (id: string) => internals.hits.find((hit) => hit.focusId === id);
  /** Each probe Group's (`data: "probe:<name>"`) node and absolute origin. */
  const probes = () => {
    const found = new Map<string, { node: SceneNode; x: number; y: number }>();
    const walk = (node: SceneNode, x: number, y: number) => {
      x += node.x;
      y += node.y;
      const data = (node as { data?: unknown }).data;
      if (typeof data === "string" && data.startsWith("probe:"))
        found.set(data.slice(6), { node, x, y });
      node.children.forEach((child) => walk(child, x, y));
    };
    walk(internals.root.container, 0, 0);
    return found;
  };
  const capture = (file: string) => {
    const bytes = Uint8Array.from(native.lastFrame!);
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
    settle,
    key,
    type,
    click,
    center,
    texts,
    byFocus,
    probes,
    capture,
    focused: () => internals.focusedId,
    close: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}

/** Every node under `root` (a probe's widget) lies inside `width` × `height`, text included. */
function assertContained(root: SceneNode, width: number, height: number, what: string): void {
  const walk = (node: SceneNode, x: number, y: number) => {
    const right =
      node.kind === "text" && node.text
        ? x +
          measureTextBounds(node.text, {
            fontSize: node.fontSize,
            fontWeight: node.fontWeight,
          }).width
        : x + node.width;
    const bottom = y + node.height;
    assert.ok(
      x >= -0.5 && y >= -0.5 && right <= width + 1 && bottom <= height + 0.5,
      `${what}: ${node.kind}${node.text ? ` "${node.text}"` : ""} at ${x},${y} to ${right},${bottom} inside ${width}×${height}`,
    );
    node.children.forEach((child) => walk(child, x + child.x, y + child.y));
  };
  root.children.forEach((child) => walk(child, child.x, child.y));
}

/* ---------- Fixtures ---------- */

const BLUE = 0xff6aa6f0,
  GREEN = 0xff4fbf8a,
  ORANGE = 0xffe39a6a,
  PINK = 0xffe0709b;
const SWATCHES = [0xff2b2140, 0xff8d6bb8, 0xffd9c4ef, 0xff4d6b3a, 0xfff2e6f7, 0xff1a1a1f];
const HISTOGRAM = Array.from({ length: 48 }, (_, index) =>
  Math.max(0, Math.sin((index / 47) * Math.PI) * 0.8 + Math.cos(index * 0.9) * 0.15),
);
const KINDS: StackedBarSegment[] = [
  { id: "images", label: "Images", value: 185_800, colour: GREEN, detail: "185.8 KB" },
  { id: "documents", label: "Documents", value: 16_400, colour: BLUE, detail: "16.4 KB" },
  { id: "video", label: "Video", value: 5_200, colour: ORANGE, detail: "5.2 KB" },
  { id: "audio", label: "Audio", value: 900, colour: PINK, detail: "900 B" },
];
const FACTS: PropertyListItem[] = [
  { id: "created", label: "Created", value: "Today, 04:46 pm" },
  { id: "modified", label: "Modified", value: "Today, 05:41 pm" },
  { id: "opened", label: "Last opened", value: "Image Viewer · 2 h ago", tone: "accent" },
];

function Probe(props: {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: ReactNode;
}): ReactNode {
  return (
    <Group
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      data={`probe:${props.name}`}
    >
      {props.children}
    </Group>
  );
}

/** Every widget once, stacked in a 360px column, each in a probe sized by its measurer. */
function Panel(props: { s: number }): ReactNode {
  const px = (value: number) => Math.round(value * props.s);
  const column = px(360);
  const tags = layoutTagChips(
    [
      { label: "Travel" },
      { label: "Lisbon" },
      { label: "Add tag", variant: "add" },
      { label: "2024", variant: "suggestion" },
      { label: "Fujifilm", variant: "suggestion" },
    ],
    column,
  );
  const tagSpecs: Array<[string, "tag" | "add" | "suggestion", number | undefined]> = [
    ["Travel", "tag", BLUE],
    ["Lisbon", "tag", ORANGE],
    ["Add tag", "add", undefined],
    ["2024", "suggestion", undefined],
    ["Fujifilm", "suggestion", undefined],
  ];
  let y = px(16);
  const place = (height: number) => {
    const at = y;
    y += height + px(16);
    return at;
  };
  const pillY = place(metaPillHeight());
  const tagsY = place(tags.height);
  const stripY = place(px(26));
  const barY = place(stackedBarHeight());
  const stepperY = place(pageStepperHeight());
  const factsY = place(propertyListHeight(FACTS.length));
  const x = px(16);
  const histogramWidth = column - colourStripWidth(SWATCHES.length) - px(16);
  return (
    <Group width={column + px(32)} height={y}>
      <Probe
        name="pill"
        x={x}
        y={pillY}
        width={metaPillWidth("600 × 400")}
        height={metaPillHeight()}
      >
        <MetaPill text="600 × 400" />
      </Probe>
      <Probe
        name="pill-solid"
        x={x + metaPillWidth("600 × 400") + px(6)}
        y={pillY}
        width={metaPillWidth("X-T30 II")}
        height={metaPillHeight()}
      >
        <MetaPill text="X-T30 II" tone="solid" />
      </Probe>
      {tagSpecs.map(([label, variant, colour], index) => (
        <Probe
          key={label}
          name={`tag-${label}`}
          x={x + tags.positions[index]!.x}
          y={tagsY + tags.positions[index]!.y}
          width={tags.positions[index]!.width}
          height={tagChipHeight()}
        >
          <TagChip
            label={label}
            variant={variant}
            colour={colour}
            onPress={() => {}}
            onRemove={variant === "tag" ? () => {} : undefined}
          />
        </Probe>
      ))}
      <Probe name="histogram" x={x} y={stripY} width={histogramWidth} height={px(26)}>
        <Histogram width={histogramWidth} height={px(26)} values={HISTOGRAM} />
      </Probe>
      <Probe
        name="swatches"
        x={x + column - colourStripWidth(SWATCHES.length)}
        y={stripY + px(4)}
        width={colourStripWidth(SWATCHES.length)}
        height={px(18)}
      >
        <ColourStrip colours={SWATCHES} />
      </Probe>
      <Probe name="stacked-bar" x={x} y={barY} width={column} height={stackedBarHeight()}>
        <StackedBar width={column} segments={KINDS} />
      </Probe>
      <Probe
        name="stepper"
        x={x + Math.round((column - pageStepperWidth(12)) / 2)}
        y={stepperY}
        width={pageStepperWidth(12)}
        height={pageStepperHeight()}
      >
        <PageStepper page={1} pages={12} />
      </Probe>
      <Probe name="facts" x={x} y={factsY} width={column} height={propertyListHeight(FACTS.length)}>
        <PropertyList
          width={column}
          height={propertyListHeight(FACTS.length)}
          density="compact"
          scroll={false}
          sections={[{ id: "history", items: FACTS }]}
        />
      </Probe>
    </Group>
  );
}

const panelHeight = (s: number) => {
  const px = (value: number) => Math.round(value * s);
  return (
    px(16) * 7 +
    metaPillHeight() +
    tagChipHeight() +
    px(26) +
    stackedBarHeight() +
    pageStepperHeight() +
    propertyListHeight(FACTS.length) +
    px(40)
  );
};

/* ---------- Measurers scale with the UI ---------- */

const measure = () => ({
  metaPillWidth: metaPillWidth("600 × 400"),
  metaPillHeight: metaPillHeight(),
  tagWidth: tagChipWidth("Travel"),
  tagUnremovableWidth: tagChipWidth("Travel", "tag", false, false),
  addWidth: tagChipWidth("Add tag", "add"),
  addEditingWidth: tagChipWidth("Add tag", "add", true),
  suggestionWidth: tagChipWidth("Fujifilm", "suggestion"),
  tagHeight: tagChipHeight(),
  stripWidth: colourStripWidth(6),
  barHeight: stackedBarHeight(),
  barOnlyHeight: stackedBarHeight(false),
  stepperWidth: pageStepperWidth(12),
  stepperUnknownWidth: pageStepperWidth(null),
  stepperHeight: pageStepperHeight(),
  compactList: propertyListHeight(3),
  regularList: propertyListHeight(3, "regular"),
});
setUiScaleFactor(1);
const at1 = measure();
setUiScaleFactor(1.5);
const at15 = measure();
setUiScaleFactor(1);
for (const name of Object.keys(at1) as Array<keyof typeof at1>) {
  assert.ok(
    Math.abs(at15[name] - at1[name] * 1.5) <= 2,
    `${name} scales: ${at1[name]} at 1, ${at15[name]} at 1.5`,
  );
}
assert.equal(at1.metaPillHeight, 22);
assert.equal(at1.tagHeight, 26);
assert.equal(at1.stepperHeight, 32);
assert.ok(at1.stepperWidth >= 148 && at15.stepperWidth >= 222, "the stepper is at least 148px");
assert.equal(at1.compactList, 72);
assert.equal(at15.compactList, 108, "compact rows are 36px at 1.5");
assert.equal(at15.regularList, 189, "regular rows are 63px at 1.5");
assert.ok(at1.tagUnremovableWidth < at1.tagWidth, "a tag without × is narrower");

// Chips wrap into rows a chip and 6px apart, and a chip wider than the row is capped to it.
{
  const rows = layoutTagChips(
    [{ label: "Travel" }, { label: "Lisbon" }, { label: "A very long tag name indeed" }],
    120,
  );
  assert.equal(rows.positions[0]!.y, 0);
  assert.equal(rows.positions[1]!.y, 32, "Lisbon wraps");
  assert.equal(rows.positions[2]!.width, 120, "a chip never outgrows the row");
  assert.equal(rows.height, 64 + 26);
  assert.deepEqual(layoutTagChips([], 120), { positions: [], height: 0 });
}

/* ---------- Renders across schemes and scales ---------- */

const captureDir = process.env.MOIRE_CAPTURE_DIR;
let renders = 0;
try {
  for (const scheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const theme = themeFor(scheme);
      const width = Math.round(392 * scale);
      const height = panelHeight(scale);
      const window = await open(() => <Panel s={scale} />, width, height, theme);
      try {
        const probes = window.probes();
        assert.equal(probes.size, 12, "every widget is probed");
        for (const [name, probe] of probes) {
          assert.ok(
            probe.node.children.length > 0,
            `${name}/${scheme}/${scale}: the widget renders`,
          );
          assertContained(
            probe.node,
            probe.node.width,
            probe.node.height,
            `${name}/${scheme}/${scale}`,
          );
          const widget = probe.node.children[0]!;
          if (name !== "facts")
            assert.ok(
              Math.abs(widget.width - probe.node.width) <= 1 &&
                Math.abs(widget.height - probe.node.height) <= 1,
              `${name}/${scheme}/${scale}: drawn ${widget.width}×${widget.height}, measured ${probe.node.width}×${probe.node.height}`,
            );
        }
        // Compact facts: rows 24px apart at the scale, in a 96px label column.
        const rows = ["Created", "Modified", "Last opened"].map((label) =>
          window.texts().find((text) => text.text === label)!,
        );
        assert.ok(rows.every(Boolean), "fact labels paint");
        assert.equal(rows[1]!.y - rows[0]!.y, Math.round(24 * scale));
        const value = window.texts().find((text) => text.text === "Image Viewer · 2 h ago")!;
        assert.equal(value.x - rows[2]!.x, Math.round(96 * scale), "values start after 96px");
        assert.equal(value.node.color, theme.foundations.palette.accentLine, "accent tone");
        if (captureDir)
          window.capture(path.join(captureDir, `inspector-widgets-${scheme}-${scale}.png`));
        renders++;
      } finally {
        window.close();
      }
    }
} finally {
  setUiScaleFactor(1);
}

/* ---------- Behaviour, at scale 1 ---------- */

const theme = themeFor("dark");

// PropertyList: regular rows at 1.5 are 63px, compact 36px (wide enough not to stack: 420px × 1.5).
{
  setUiScaleFactor(1.5);
  try {
    for (const density of ["regular", "compact"] as const) {
      const window = await open(
        () => (
          <PropertyList
            width={800}
            height={300}
            density={density}
            sections={[{ id: "history", items: FACTS }]}
          />
        ),
        800,
        300,
        theme,
      );
      try {
        const created = window.texts().find((text) => text.text === "Created")!;
        const modified = window.texts().find((text) => text.text === "Modified")!;
        assert.equal(
          modified.y - created.y,
          density === "compact" ? 36 : 63,
          `${density} rows at 1.5`,
        );
      } finally {
        window.close();
      }
    }
  } finally {
    setUiScaleFactor(1);
  }
}

// TagChip: press, remove by pointer and by Delete, the add chip's field, suggestions.
{
  const pressed: string[] = [];
  const submitted: string[] = [];
  let tags = ["Travel", "Lisbon"];
  let editing = false;
  let draft = "";
  const window = await open(
    () => {
      const items = [
        ...tags.map((label) => ({ label, variant: "tag" as const })),
        { label: "Add tag", variant: "add" as const, editing },
        { label: "2024", variant: "suggestion" as const },
      ];
      const rows = layoutTagChips(items, 380);
      return items.map((item, index) => (
        <TagChip
          key={item.label}
          x={10 + rows.positions[index]!.x}
          y={10 + rows.positions[index]!.y}
          label={item.label}
          variant={item.variant}
          colour={BLUE}
          focusId={`tag:${item.label}`}
          editing={item.variant === "add" ? editing : undefined}
          draft={draft}
          onDraft={(value) => (draft = value)}
          onSubmit={() => {
            submitted.push(draft);
            tags = [...tags, draft];
            draft = "";
            editing = false;
          }}
          onCancel={() => {
            draft = "";
            editing = false;
          }}
          onPress={() => {
            pressed.push(item.label);
            if (item.variant === "add") editing = true;
          }}
          onRemove={() => (tags = tags.filter((tag) => tag !== item.label))}
        />
      ));
    },
    400,
    120,
    theme,
  );
  try {
    const travel = window.byFocus("tag:Travel")!;
    await window.click({ x: travel.x + 12, y: travel.y + travel.height / 2 });
    assert.deepEqual(pressed, ["Travel"], "pressing a tag's body presses it");
    const remove = window.byFocus("tag:Travel:remove");
    assert.ok(remove, "a removable tag has a × with its own focus id");
    await window.click(window.center(remove));
    assert.deepEqual(tags, ["Lisbon"], "× removes the tag");
    assert.deepEqual(pressed, ["Travel"], "× doesn't press the chip");
    await window.click({
      x: window.byFocus("tag:Lisbon")!.x + 12,
      y: window.byFocus("tag:Lisbon")!.y + 8,
    });
    await window.key("delete");
    assert.deepEqual(tags, [], "Delete on a focused tag removes it");
    await window.click(window.center(window.byFocus("tag:2024")!));
    assert.equal(pressed.at(-1), "2024", "a suggestion presses");
    await window.click(window.center(window.byFocus("tag:Add tag")!));
    assert.equal(editing, true, "the add chip asks to edit");
    await window.settle();
    assert.equal(window.focused(), "tag:Add tag:field", "the field takes focus");
    await window.type("Trip");
    assert.equal(draft, "Trip", "typing reports the draft");
    await window.key("enter");
    assert.deepEqual(submitted, ["Trip"], "Enter submits");
    assert.deepEqual(tags, ["Trip"]);
    assert.ok(window.byFocus("tag:Add tag"), "the add chip is back after submitting");
    await window.click(window.center(window.byFocus("tag:Add tag")!));
    await window.settle();
    await window.type("x");
    await window.key("escape");
    assert.equal(editing, false, "Escape cancels");
    assert.deepEqual(submitted, ["Trip"]);
  } finally {
    window.close();
  }
}

// PageStepper: buttons and arrows page, and the ends disable.
{
  let page = 1;
  const window = await open(
    () => (
      <PageStepper
        x={20}
        y={20}
        page={page}
        pages={3}
        focusId="pdf"
        onPage={(next) => (page = next)}
      />
    ),
    240,
    80,
    theme,
  );
  const enabled = (id: string) => !!window.byFocus(id)?.onPress;
  try {
    assert.equal(enabled("pdf:previous"), false, "Previous is disabled on page 1");
    assert.equal(enabled("pdf:next"), true);
    assert.ok(window.texts().some((text) => text.text === "Page 1 of 3"));
    await window.click(window.center(window.byFocus("pdf:next")!));
    assert.equal(page, 2, "Next pages forward");
    await window.settle();
    assert.ok(window.texts().some((text) => text.text === "Page 2 of 3"));
    assert.equal(enabled("pdf:previous"), true);
    await window.click(window.center(window.byFocus("pdf:previous")!));
    assert.equal(page, 1, "Previous pages back");
    await window.key("tab");
    assert.equal(window.focused(), "pdf:next", "Tab reaches Next");
    await window.key("right");
    assert.equal(page, 2, "Right pages forward while focused");
    await window.key("right");
    assert.equal(page, 3);
    await window.key("right");
    assert.equal(page, 3, "not past the last page");
    assert.equal(enabled("pdf:next"), false, "Next is disabled on the last page");
    await window.key("left");
    assert.equal(page, 2, "Left pages back");
  } finally {
    window.close();
  }
  // Unknown count: "Page n", Next never disables, and arrows don't page without focus.
  page = 4;
  const unknown = await open(
    () => <PageStepper page={page} pages={null} focusId="doc" onPage={(next) => (page = next)} />,
    240,
    60,
    theme,
  );
  try {
    assert.ok(unknown.texts().some((text) => text.text === "Page 4"));
    assert.ok(unknown.byFocus("doc:next")?.onPress, "Next stays enabled without a count");
    await unknown.key("right");
    assert.equal(page, 4, "arrows do nothing until the stepper has focus");
  } finally {
    unknown.close();
  }
}

// StackedBar: the legend drops items rather than overflow a narrow width.
for (const scale of [1, 1.5]) {
  setUiScaleFactor(scale);
  try {
    const width = Math.round(150 * scale);
    const window = await open(
      () => (
        <Probe name="bar" x={0} y={0} width={width} height={stackedBarHeight()}>
          <StackedBar width={width} segments={KINDS} />
        </Probe>
      ),
      width + 40,
      stackedBarHeight() + 10,
      theme,
    );
    try {
      const probe = window.probes().get("bar")!;
      assertContained(probe.node, width, stackedBarHeight(), `narrow stacked bar at ${scale}`);
      const legend = window.texts().map((text) => text.text);
      assert.ok(legend.includes("Images 185.8 KB"), "the first item fits");
      assert.ok(legend.length < KINDS.length, "items that don't fit are dropped");
    } finally {
      window.close();
    }
  } finally {
    setUiScaleFactor(1);
  }
}

console.log(
  `[ui/inspector-widgets] measurers scale, ${renders} panel renders (dark/light × scale 1/1.5) stay inside their bounds, and tag chips, the tag field, page stepper, stacked bar legend and compact property list behave`,
);
