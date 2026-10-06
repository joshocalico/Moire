/** Ordinary-size shipped launcher adoption through actual SVGs and headless Window. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import { createShellRoot, renderShell, SoftwareRenderer } from "@moire/react-host";
import { THEME_FAMILIES } from "@moire/theme";
import { loadSvgIconSync } from "#ui/image/svg-icon";
import {
  Icon,
  IconButton,
  Label,
  Surface,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
} from "./index";
import { ICON_NAMES, applicationIcon } from "#ui/widgets/icon";
import { HeadlessPlatform } from "./testing";

const appDirectory = fileURLToPath(new URL("../../../apps/", import.meta.url));
const iconDirectory = fileURLToPath(new URL("../icons/", import.meta.url));
const output = process.env.MOIRE_ICON_PREVIEW_DIR;
const sizes = [16, 20, 24, 32];
const launchers = ["bundled", "core", "developer"]
  .flatMap((category) => {
    const directory = path.join(appDirectory, category);
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const app = path.join(directory, entry.name);
        return fs
          .readdirSync(app)
          .filter((name) => name.endsWith(".desktop"))
          .map((id) => {
            const file = path.join(app, id);
            const source = fs.readFileSync(file, "utf8");
            const title = source.match(/^Name=(.+)$/m)?.[1];
            const declared = source.match(/^Icon=(.+)$/m)?.[1];
            assert.ok(title && declared, `${file}: missing launcher identity`);
            const icon = applicationIcon(id);
            assert.notEqual(icon, "app", `${id}: shipped launcher uses generic identity`);
            assert.equal(
              declared,
              `moire-${icon}`,
              `${id}: desktop declaration differs from shared application identity`,
            );
            return { id, title, icon, file };
          });
      });
  })
  .sort((a, b) => a.title.localeCompare(b.title));
assert.equal(
  launchers.length,
  25,
  "Shipped launcher count changed; inspect actual adoption coverage",
);
assert.equal(
  new Set(launchers.map((entry) => entry.icon)).size,
  25,
  "Shipped application identities collide",
);
assert.equal(applicationIcon("org.moire.Benchmark"), "benchmark");
assert.equal(applicationIcon("org.moire.Showcase"), "showcase");
assert.equal(applicationIcon("org.moire.SystemMonitor"), "monitor");
assert.equal(applicationIcon("org.example.Benchmark"), "app", "Foreign namespace was captured");
assert.equal(applicationIcon("org.example.Showcase"), "app", "Foreign namespace was captured");
assert.equal(applicationIcon("org.example.Files"), "app", "Foreign namespace was captured");

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-icon-adoption-"));
const environment = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
if (output) fs.mkdirSync(output, { recursive: true });
function png(file: string, bgra: Uint8Array, width: number, height: number): void {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < bgra.length; offset += 4) {
    image.data[offset] = bgra[offset + 2]!;
    image.data[offset + 1] = bgra[offset + 1]!;
    image.data[offset + 2] = bgra[offset]!;
    image.data[offset + 3] = bgra[offset + 3]!;
  }
  fs.writeFileSync(file, PNG.sync.write(image));
}
const rasterMetrics: Array<{ context: string; icon: string; size: number; coverage: number }> = [];
const renderer = new SoftwareRenderer();
let frames = 0,
  windows = 0,
  activations = 0;
try {
  await installUiFonts();
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const) {
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { themeFamily: family, colorScheme, reducedMotion: true }),
      );
      const pal = theme.foundations.palette;
      const context = `${family}-${colorScheme}`;
      for (const size of sizes) {
        const identities = new Set<string>();
        for (const icon of ICON_NAMES) {
          const artwork = loadSvgIconSync(path.join(iconDirectory, `${icon}.svg`), size, pal.text);
          let coverage = 0;
          const root = createShellRoot();
          try {
            renderShell(
              root,
              <WidgetThemeProvider theme={theme}>
                <Icon name={icon} size={size} />
              </WidgetThemeProvider>,
            );
            const pixels = renderer.render(root.container, { width: size, height: size }).pixels;
            for (let offset = 0; offset < pixels.length; offset += 4) {
              const x = (offset / 4) % size,
                y = Math.floor(offset / 4 / size);
              assert.equal(
                pixels[offset + 3],
                artwork.rgba[offset + 3],
                `${context}/${icon}/${size}: did not use actual SVG alpha`,
              );
              if (!pixels[offset + 3]) continue;
              assert.ok(
                x > 0 && y > 0 && x < size - 1 && y < size - 1,
                `${context}/${icon}/${size}: icon clips its allocation`,
              );
              assert.equal(
                pixels[offset],
                Math.round(((pal.text & 0xff) * artwork.rgba[offset + 3]!) / 255),
                `${context}/${icon}: theme blue changed`,
              );
              assert.equal(
                pixels[offset + 1],
                Math.round((((pal.text >>> 8) & 0xff) * artwork.rgba[offset + 3]!) / 255),
                `${context}/${icon}: theme green changed`,
              );
              assert.equal(
                pixels[offset + 2],
                Math.round((((pal.text >>> 16) & 0xff) * artwork.rgba[offset + 3]!) / 255),
                `${context}/${icon}: theme red changed`,
              );
              coverage += pixels[offset + 3]! / 255;
            }
            assert.ok(coverage >= 3, `${context}/${icon}/${size}: empty or vanishing glyph`);
            if (launchers.some((entry) => entry.icon === icon)) {
              const digest = createHash("sha256").update(pixels).digest("hex");
              assert.ok(
                !identities.has(digest),
                `${context}/${icon}/${size}: indistinguishable application identity`,
              );
              identities.add(digest);
            }
            rasterMetrics.push({ context, icon, size, coverage });
            frames++;
          } finally {
            renderShell(root, null);
          }
        }
        assert.equal(
          identities.size,
          25,
          `${context}/${size}: launcher raster coverage omitted identities`,
        );
      }
      for (const scale of [1, 1.5]) {
        setUiScaleFactor(scale);
        const width = Math.round(1060 * scale),
          rowHeight = 38 * scale;
        const height = Math.round((140 + 25 * 38) * scale);
        const backend = new HeadlessPlatform();
        await backend.connect();
        const win = new Window({
          title: "Shipped icon identities",
          width,
          height,
          decorated: false,
        });
        const pressed: string[] = [];
        const control = (icon: "benchmark" | "showcase", x: number, disabled = false) => (
          <IconButton
            x={x * scale}
            y={53 * scale}
            width={38 * scale}
            height={38 * scale}
            icon={(style) => <Icon name={icon} size={style.size} color={style.color} />}
            autoFocus={icon === "benchmark" && !disabled}
            disabled={disabled}
            tooltip={icon === "benchmark" ? "Benchmark" : "Widget showcase"}
            onPress={() => {
              pressed.push(icon);
              activations++;
            }}
          />
        );
        win.setContent(
          <WidgetThemeProvider theme={theme}>
            <Surface width={width} height={height} fill={pal.panel}>
              <Label
                x={14 * scale}
                y={12 * scale}
                width={1020 * scale}
                height={28 * scale}
                text={`Moire icons · ${context} · scale ${scale} · actual headless Window`}
                fontSize={16}
              />
              {control("benchmark", 16)}
              {control("showcase", 60, true)}
              {control("showcase", 104)}
              <Label
                x={164 * scale}
                y={55 * scale}
                width={850 * scale}
                text="Enabled / disabled / enabled controls. Enter, Space, Tab use actual Window dispatch."
                fontSize={12}
              />
              {sizes.map((size, column) => (
                <React.Fragment key={size}>
                  <Label
                    x={(230 + column * 91) * scale}
                    y={106 * scale}
                    width={75 * scale}
                    text={`${size}px`}
                    fontSize={12}
                  />
                  <Label
                    x={(655 + column * 91) * scale}
                    y={106 * scale}
                    width={75 * scale}
                    text={`${size}px accent`}
                    fontSize={12}
                  />
                </React.Fragment>
              ))}
              {launchers.map((entry, row) => (
                <React.Fragment key={entry.id}>
                  <Label
                    x={14 * scale}
                    y={(140 + row * 38) * scale}
                    width={200 * scale}
                    height={rowHeight}
                    text={entry.title}
                    fontSize={12}
                    verticalAlign="center"
                  />
                  {sizes.map((size, column) => (
                    <React.Fragment key={size}>
                      <Icon
                        name={entry.icon}
                        size={size * scale}
                        x={(230 + column * 91 + (32 - size) / 2) * scale}
                        y={(140 + row * 38 + (38 - size) / 2) * scale}
                      />
                      <Icon
                        name={entry.icon}
                        size={size * scale}
                        color={pal.accent}
                        x={(655 + column * 91 + (32 - size) / 2) * scale}
                        y={(140 + row * 38 + (38 - size) / 2) * scale}
                      />
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
            </Surface>
          </WidgetThemeProvider>,
        );
        try {
          win.mount(backend);
          await Promise.resolve();
          win.tick();
          const native = backend.getWindows()[0];
          assert.ok(native?.lastFrame);
          if (output)
            png(path.join(output, `${context}-scale${scale}.png`), native.lastFrame, width, height);
          const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
          let timeMs = 0;
          const key = (code: number, key: string, repeat = false) => {
            native.injectKey({
              type: repeat ? "repeat" : "down",
              code,
              key,
              modifiers,
              timeMs: ++timeMs,
            });
            if (!repeat) native.injectKey({ type: "up", code, key, modifiers, timeMs: ++timeMs });
            win.tick();
          };
          key(28, "Enter");
          key(28, "Enter", true);
          key(57, " ");
          key(15, "Tab");
          key(28, "Enter");
          assert.deepEqual(
            pressed,
            ["benchmark", "benchmark", "showcase"],
            `${context}/scale${scale}: icon controls lost keyboard activation or disabled skip`,
          );
          windows++;
        } finally {
          win.destroy();
          backend.disconnect();
        }
      }
    }
  if (output)
    fs.writeFileSync(
      path.join(output, "manifest.json"),
      JSON.stringify(
        {
          scope:
            "Actual SVG/SoftwareRenderer and headless Window; no native desktop/hardware visual claim",
          frames,
          windows,
          activations,
          sizes,
          launchers,
          rasterMetrics,
          assets: ICON_NAMES.map((icon) => ({
            icon,
            sha256: createHash("sha256")
              .update(fs.readFileSync(path.join(iconDirectory, `${icon}.svg`)))
              .digest("hex"),
          })),
        },
        null,
        2,
      ) + "\n",
    );
  console.log(
    `[icon-adoption] ${frames} actual SVG/theme/size frames,25 actual launcher files,${windows} headless Windows,${activations} keyboard activations passed; native desktop visual acceptance remains separate`,
  );
} finally {
  setUiScaleFactor(1);
  for (const key of ["HOME", "XDG_CONFIG_HOME"] as const) {
    const value = environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}
