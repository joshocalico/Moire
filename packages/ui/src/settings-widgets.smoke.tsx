/**
 * The settings widgets in a real headless Window: the compact sidebar (labels, counts, dimmed
 * pages, the icon rail, arrow keys), setting rows (heights, stacking under 400px, Connect
 * revealed on hover), the hero, status tiles, picture options and swatches with arrow keys,
 * signal bars, avatars, the desktop preview and the side sheet with Escape. Each holds at scale
 * 1.5. Set MOIRE_SETTINGS_WIDGETS_CAPTURE_DIR to also write each panel as a PNG.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React, { useState, type ReactNode } from "react";
import { PNG } from "pngjs";
import type { HitRegion, SceneNode } from "@moire/react-host";
import {
  Avatar,
  Button,
  DesktopPreview,
  NavigationRail,
  OverlayHost,
  PageHero,
  PictureOptions,
  SettingsSection,
  SideSheet,
  SignalStrength,
  StatusTile,
  Surface,
  SwatchPicker,
  TextBlock,
  Toggle,
  Window,
  WidgetThemeProvider,
  avatarColor,
  avatarInitials,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  settingsSectionHeight,
  signalBars,
  statusTileHeight,
  swatchPickerSize,
  type NavigationRailSection,
  type SettingsSectionSpec,
  type WidgetTheme,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { tickMotionFrame } from "./motion";

await installUiFonts();

const KEY = {
  escape: [1, "Escape"],
  enter: [28, "Enter"],
  right: [106, "ArrowRight"],
  down: [108, "ArrowDown"],
} as const;
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
type Internals = { root: { container: SceneNode }; hits: HitRegion[] };
const capture = process.env.MOIRE_SETTINGS_WIDGETS_CAPTURE_DIR;

function themeFor(colorScheme: "dark" | "light"): WidgetTheme {
  return createPersonalizedWidgetTheme(
    discoverPersonalization("linux", { themeFamily: "moire", colorScheme, reducedMotion: true }),
  );
}

async function open(view: () => ReactNode, width: number, height: number, theme: WidgetTheme) {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Settings widgets", width, height, decorated: false });
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
  await settle();
  const texts = () => {
    const found: string[] = [];
    const walk = (node: SceneNode) => {
      if (node.kind === "text" && node.text) found.push(node.text);
      node.children.forEach(walk);
    };
    walk(internals.root.container);
    return found;
  };
  const byFocus = (id: string) => {
    const found = internals.hits.find((hit) => hit.focusId === id);
    assert.ok(found, `hit region ${id}`);
    return found;
  };
  const center = (hit: { x: number; y: number; width: number; height: number }) => ({
    x: hit.x + hit.width / 2,
    y: hit.y + hit.height / 2,
  });
  return {
    texts,
    byFocus,
    settle,
    hits: () => internals.hits,
    async key(which: keyof typeof KEY) {
      const [code, name] = KEY[which];
      native.injectKey({ type: "down", code, key: name, modifiers, timeMs: time++ });
      native.injectKey({ type: "up", code, key: name, modifiers, timeMs: time++ });
      await settle(4);
    },
    async click(at: { x: number; y: number }) {
      native.injectPointer({ type: "move", ...at, timeMs: time++ });
      native.injectPointer({ type: "down", button: "left", ...at, timeMs: time++ });
      native.injectPointer({ type: "up", button: "left", ...at, timeMs: time++ });
      await settle(6);
    },
    async move(at: { x: number; y: number }) {
      native.injectPointer({ type: "move", ...at, timeMs: time++ });
      await settle(6);
    },
    center,
    shot(name: string) {
      if (!capture) return;
      const frame = native.lastFrame!;
      const png = new PNG({ width, height });
      for (let index = 0; index < frame.length; index += 4) {
        png.data[index] = frame[index + 2]!;
        png.data[index + 1] = frame[index + 1]!;
        png.data[index + 2] = frame[index]!;
        png.data[index + 3] = 255;
      }
      fs.mkdirSync(capture, { recursive: true });
      fs.writeFileSync(path.join(capture, `${name}.png`), PNG.sync.write(png));
    },
    destroy() {
      window.destroy();
      backend.disconnect();
    },
  };
}

const PAGES: NavigationRailSection[] = [
  {
    id: "connections",
    label: "Connections",
    items: [
      { id: "network", label: "Wi‑Fi & Network", icon: "network", tint: 0xff5aa2f0, badge: 2 },
      { id: "bluetooth", label: "Bluetooth", icon: "bluetooth", tint: 0xff5aa2f0, dimmed: true },
    ],
  },
  {
    id: "devices",
    label: "Devices",
    items: [
      { id: "displays", label: "Displays", icon: "monitor", tint: 0xff8b7cf6 },
      { id: "sound", label: "Sound", icon: "volume", tint: 0xffe86a9b },
    ],
  },
];

// ---- Pure helpers.
assert.equal(signalBars(0), 1, "a network in range always shows a bar");
assert.equal(signalBars(51), 3);
assert.equal(signalBars(100), 4);
assert.equal(avatarInitials("Joshua Steele"), "JS");
assert.equal(avatarInitials("ada"), "A");
assert.equal(avatarInitials("  "), "?");
assert.equal(avatarColor("Joshua Steele"), avatarColor("Joshua Steele"), "a name keeps its colour");

for (const scale of [1, 1.5])
  for (const scheme of ["dark", "light"] as const) {
    setUiScaleFactor(scale);
    const theme = themeFor(scheme);
    const name = `${scheme}-scale${scale}`;

    // ---- Compact sidebar: labels, a count, a dimmed page, arrow keys; the icon rail.
    {
      let selected = "network";
      let expanded = true;
      const app = await open(
        () => (
          <NavigationRail
            height={300 * scale}
            expanded={expanded}
            density="compact"
            expandedWidth={248 * scale}
            idPrefix="nav"
            sections={PAGES}
            selectedId={selected}
            onSelect={(item) => {
              selected = item.id;
            }}
          />
        ),
        Math.round(260 * scale),
        Math.round(300 * scale),
        theme,
      );
      assert.ok(
        app.texts().includes("Connections") && app.texts().includes("2"),
        "labels and a count",
      );
      const network = app.byFocus("nav:network");
      const displays = app.byFocus("nav:displays");
      assert.ok(
        Math.abs(displays.height - 26 * scale) < 1,
        "compact rows are 26px (28 with the gap)",
      );
      await app.click(app.center(network));
      await app.key("down");
      await app.key("enter");
      assert.equal(selected, "bluetooth", "↓ then Enter selects the next page, dimmed or not");
      app.shot(`sidebar-${name}`);
      expanded = false;
      await app.settle();
      assert.ok(!app.texts().includes("Connections"), "the icon rail drops labels");
      assert.ok(app.byFocus("nav:network").width <= 40 * scale + 1);
      app.destroy();
    }

    // ---- Setting rows: heights match the spec, wide controls stack under 400px, Connect on hover.
    {
      let connected = 0;
      const section: SettingsSectionSpec = {
        id: "s",
        title: "Networks",
        rows: [
          {
            id: "toggle",
            label: "Wi‑Fi",
            description: "On",
            control: { kind: "compact", width: 52, render: () => <Toggle on /> },
          },
          {
            id: "wide",
            label: "Resolution",
            control: {
              kind: "wide",
              render: (width) => <Button width={width} label="1920 × 1200" />,
            },
          },
          {
            id: "ap",
            label: "Bluebird",
            description: "WPA2 Personal",
            height: 52,
            onPress: () => {},
            focusId: "row:ap",
            revealControl: {
              kind: "compact",
              width: 84,
              render: (_w, reveal) => (
                <Button
                  width={84 * scale}
                  label="Connect"
                  focusId="row:connect"
                  onHoverChange={reveal.onHoverChange}
                  onFocusChange={reveal.onFocusChange}
                  onPress={() => connected++}
                />
              ),
            },
          },
          {
            id: "link",
            label: "Join another network…",
            chevron: true,
            value: "Hidden",
            onPress: () => {},
          },
        ],
      };
      for (const width of [600, 360]) {
        const app = await open(
          () => <SettingsSection x={10} y={10} width={width * scale} section={section} />,
          Math.round((width + 20) * scale),
          Math.round(420 * scale),
          theme,
        );
        const height = settingsSectionHeight(section, width * scale);
        assert.ok(height > 0);
        assert.ok(!app.texts().includes("Connect"), "Connect waits for hover");
        await app.move(app.center(app.byFocus("row:ap")));
        assert.ok(app.texts().includes("Connect"), "hovering the row reveals Connect");
        await app.move(app.center(app.byFocus("row:connect")));
        assert.ok(app.texts().includes("Connect"), "moving onto Connect keeps it");
        await app.click(app.center(app.byFocus("row:connect")));
        if (width === 360) {
          const wide = app.texts();
          assert.ok(wide.includes("1920 × 1200"));
        }
        app.shot(`rows-${width}-${name}`);
        app.destroy();
      }
      assert.equal(connected, 2, "Connect works at both widths");
      assert.ok(
        settingsSectionHeight(section, 360 * scale) > settingsSectionHeight(section, 600 * scale),
        "narrow cards stack wide controls",
      );
    }

    // ---- Hero, tiles, picture options and swatches with arrow keys, signal bars, avatar, preview.
    {
      let picture = "islands";
      let swatch = "violet";
      let pressed = 0;
      const app = await open(
        () => (
          <>
            <PageHero
              x={10 * scale}
              y={10 * scale}
              width={520 * scale}
              icon="network"
              title="Wi‑Fi"
              detail="On · connected to Halcyon"
              control={<Toggle on />}
            />
            <StatusTile
              x={10 * scale}
              y={104 * scale}
              width={200 * scale}
              icon="battery"
              title="Battery"
              value="78%"
              progress={0.78}
              detail="3 h left"
              focusId="tile"
              onPress={() => pressed++}
            />
            <PictureOptions
              x={220 * scale}
              y={104 * scale}
              width={300 * scale}
              height={90 * scale}
              focusId="pic"
              value={picture}
              options={["islands", "full"].map((id) => ({
                id,
                label: id === "islands" ? "Floating islands" : "Full-width bar",
                picture: () => null,
              }))}
              onChange={(id) => {
                picture = id;
              }}
            />
            <SwatchPicker
              x={10 * scale}
              y={222 * scale}
              focusId="sw"
              value={swatch}
              swatches={[
                { id: "violet", color: 0xff8b7cf6, label: "Violet" },
                { id: "blue", color: 0xff5aa2f0, label: "Blue" },
                { id: "green", color: 0xff3ecf8e, label: "Green" },
              ]}
              onChange={(id) => {
                swatch = id;
              }}
            />
            <SignalStrength x={150 * scale} y={226 * scale} strength={40} />
            <Avatar x={180 * scale} y={218 * scale} name="Joshua Steele" />
            <DesktopPreview
              x={230 * scale}
              y={210 * scale}
              width={290 * scale}
              height={160 * scale}
              wallpaper={{ kind: "colors", colors: [0xff1d2b4a, 0xff6a4fb0, 0xffe58f6a] }}
              panel="islands"
              iconsOnly={false}
              desktopIcons
            />
            <TextBlock
              x={10 * scale}
              y={270 * scale}
              width={200 * scale}
              height={20 * scale}
              text={`${picture} ${swatch}`}
            />
          </>
        ),
        Math.round(540 * scale),
        Math.round(390 * scale),
        theme,
      );
      assert.ok(Math.abs(app.byFocus("tile").height - statusTileHeight()) < 1);
      await app.click(app.center(app.byFocus("tile")));
      assert.equal(pressed, 1, "the whole tile is pressable");
      await app.click(app.center(app.byFocus("pic:islands")));
      await app.key("right");
      assert.equal(picture, "full", "→ chooses the next picture");
      await app.click(app.center(app.byFocus("sw:violet")));
      await app.key("right");
      assert.equal(swatch, "blue", "→ chooses the next swatch");
      const size = swatchPickerSize({
        swatches: [1, 2, 3].map(String).map((id) => ({ id, color: 0, label: id })),
      });
      assert.ok(size.width > 0 && size.height > 0, "swatches have an intrinsic size");
      assert.ok(app.texts().includes("JS") && app.texts().includes("78%"));
      app.shot(`pictures-${name}`);
      app.destroy();
    }

    // ---- Side sheet: opens over the right, full width when narrow, Escape closes it.
    for (const width of [900, 500]) {
      let open_ = true;
      function Sheet() {
        const [count, setCount] = useState(0);
        return (
          <SideSheet
            open={open_}
            viewportWidth={width * scale}
            viewportHeight={400 * scale}
            title="Halcyon"
            subtitle="Connected"
            closeFocusId="sheet:close"
            onClose={() => {
              open_ = false;
            }}
          >
            {(size) => (
              <Button
                width={size.width - 32}
                label={`Pressed ${count}`}
                focusId="sheet:button"
                onPress={() => setCount(count + 1)}
              />
            )}
          </SideSheet>
        );
      }
      const app = await open(
        () => <Sheet />,
        Math.round(width * scale),
        Math.round(400 * scale),
        theme,
      );
      assert.ok(app.texts().includes("Halcyon") && app.texts().includes("Connected"));
      if (width === 500)
        assert.ok(app.byFocus("sheet:button").x < 40 * scale, "a narrow window's sheet covers it");
      else
        assert.ok(
          app.byFocus("sheet:button").x > (900 - 380) * scale,
          "the sheet sits at the right",
        );
      await app.click(app.center(app.byFocus("sheet:close")));
      assert.equal(open_, false, "the close button closes it");
      app.shot(`sheet-${width}-${name}`);
      app.destroy();
    }
  }
setUiScaleFactor(1);
console.log(
  "[ui/settings-widgets] sidebar, rows, hero, tiles, pictures, swatches, preview and side sheet passed",
);
