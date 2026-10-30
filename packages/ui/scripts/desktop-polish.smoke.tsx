/* eslint-disable import/no-relative-parent-imports -- Integration checks render app sources without making the widget library depend on its callers. */
/** Render real app trees, inspect input allocations, and exercise folder search. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import {
  createShellRoot,
  renderShell,
  collectHits,
  SoftwareRenderer,
  type SceneNode,
  type HitKeyEvent,
} from "@moire/react-host";
import { THEME_FAMILIES } from "@moire/theme";
import {
  installUiFonts,
  setUiScaleFactor,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { FilesApp } from "../../../apps/bundled/files/src/main";
import { SettingsApp } from "../../../apps/core/settings/src/main";
import { settingsFixture } from "../../../apps/core/settings/src/testing";
import { filesLayout } from "../../../apps/bundled/files/src/layout";

await installUiFonts();
setUiScaleFactor(1);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "moire-desktop-polish-"));
const originalHome = process.env.HOME;
const originalConfig = process.env.XDG_CONFIG_HOME;
process.env.HOME = temporary;
process.env.XDG_CONFIG_HOME = path.join(temporary, ".config");
// The session file clipboard lives in the runtime directory; keep it in the fixture.
process.env.XDG_RUNTIME_DIR = path.join(temporary, ".run");
const fixture = path.join(temporary, "Projects", "Moire");
fs.mkdirSync(fixture, { recursive: true });
for (const directory of ["design", "packages", "wallpapers"])
  fs.mkdirSync(path.join(fixture, directory));
// Properties opens on design/, so its preview has an item to count and measure.
fs.writeFileSync(path.join(fixture, "design", "brief.md"), "Moire design brief\n");
fs.writeFileSync(path.join(fixture, "README.md"), "Moire desktop\n");
fs.writeFileSync(path.join(fixture, "desktop.tsx"), "export const desktop = true;\n");
fs.copyFileSync(
  new URL("../../../themes/default/botanical-wisteria.png", import.meta.url),
  path.join(fixture, "Botanical.png"),
);
const textNodes = (node: SceneNode): string[] => [
  ...(node.kind === "text" ? [node.text ?? ""] : []),
  ...node.children.flatMap(textNodes),
];
function positionedText(
  node: SceneNode,
  x = 0,
  y = 0,
): Array<{ text: string; x: number; y: number; width: number; height: number }> {
  x += node.x;
  y += node.y;
  return [
    ...(node.kind === "text"
      ? [{ text: node.text ?? "", x, y, width: node.width, height: node.height }]
      : []),
    ...node.children.flatMap((child) => positionedText(child, x, y)),
  ];
}
const previewDir = process.env.MOIRE_DESKTOP_PREVIEW_DIR;
const renderer = new SoftwareRenderer();
function savePreview(
  root: ReturnType<typeof createShellRoot>,
  width: number,
  height: number,
  name: string,
) {
  const frame = renderer.render(root.container, { width, height });
  if (!previewDir) return;
  fs.mkdirSync(previewDir, { recursive: true });
  const pixels = Buffer.alloc(width * height * 3);
  for (let input = 0, output = 0; input < frame.pixels.length; input += 4, output += 3) {
    pixels[output] = frame.pixels[input + 2]!;
    pixels[output + 1] = frame.pixels[input + 1]!;
    pixels[output + 2] = frame.pixels[input]!;
  }
  fs.writeFileSync(
    path.join(previewDir, `${name}.ppm`),
    Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]),
  );
}

try {
  for (const family of THEME_FAMILIES) {
    for (const scheme of ["dark", "light"] as const) {
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { themeFamily: family, colorScheme: scheme }),
      );
      for (const [width, height] of [
        [200, 320],
        [320, 440],
        [640, 440],
        [1020, 600],
      ]) {
        assert.ok(width && height);
        const root = createShellRoot();
        // Wide windows open Properties on a folder, to check the inspector's layout too.
        const app = (
          <WidgetThemeProvider theme={theme}>
            <FilesApp
              width={width}
              height={height}
              initialPath={fixture}
              reveal={
                width >= 960 ? { path: path.join(fixture, "design"), properties: true } : null
              }
              onQuit={() => {}}
            />
          </WidgetThemeProvider>
        );
        renderShell(root, app);
        // Directory reads are asynchronous; verify the loaded app, not its
        // intentional first-frame loading state.
        for (
          let attempt = 0;
          attempt < 100 && !textNodes(root.container).includes("README.md");
          attempt++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          renderShell(root, app);
        }
        const metrics = filesLayout(width, height, 1);
        for (const hit of collectHits(root.container).filter(
          (hit) => hit.y < metrics.topH && hit.focusable,
        )) {
          assert.ok(
            hit.x >= 0 && hit.x + hit.width <= width,
            `${family}/${scheme}/${width}: toolbar hit outside window at ${hit.x}+${hit.width}`,
          );
        }
        const toolbarLabels = positionedText(root.container).filter(
          (node) => node.y < metrics.topH,
        );
        for (const label of [
          "New folder",
          "Cut",
          "Copy",
          "Rename",
          "Trash",
          "Undo",
          "Paste",
          "More…",
        ])
          assert.ok(
            !toolbarLabels.some((node) => node.text === label),
            `${family}/${scheme}/${width}: file operation ${label} must live in a context menu`,
          );
        // Short windows fold the title; the All chip still counts the folder's items (the
        // narrowest window folds every chip into "More").
        const labels = textNodes(root.container);
        if (width >= 320)
          assert.equal(
            labels[labels.indexOf("All") + 1],
            "6",
            "the page must report the actual item count",
          );
        if (width >= 960) {
          // Properties is docked at the right; its heading marks the pane's left edge.
          const paneLeft = () =>
            positionedText(root.container).find(
              (node) => node.text === "Properties" && node.x > width / 2,
            )?.x ?? width;
          const pane = () =>
            positionedText(root.container).filter((node) => node.x >= paneLeft() && node.x < width);
          // The folder's preview loads asynchronously: the hero counts its items and the
          // Information card measures its size.
          const loaded = () => {
            const text = pane();
            return (
              text.some((node) => node.text === "1 item · 0 folders") &&
              text.some((node) => /^\d+ B in 1 file$/.test(node.text)) &&
              text.some((node) => node.text === "Sharing & permissions")
            );
          };
          for (let attempt = 0; attempt < 200 && !loaded(); attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            renderShell(root, app);
          }
          assert.ok(
            loaded(),
            `${family}/${scheme}: inspector loads the folder's details: ${pane()
              .map((node) => node.text)
              .join(" | ")}`,
          );
          const left = paneLeft();
          assert.ok(
            left >= width - 400 && left < width - 300,
            `${family}/${scheme}: inspector docks at the right (left edge ${left})`,
          );
          // Hero, title block, then each card's heading and rows, top to bottom, none overlapping.
          const text = pane();
          const details = [
            "1 item · 0 folders",
            "design",
            "Folder · ",
            "Open in New Tab",
            "Information",
            "Kind",
            "Size",
            "Tags",
            "Add tag",
            "Location",
            "Sharing & permissions",
            "You",
            "Group",
            "Everyone",
            "History",
            "Created",
            "Modified",
          ].map((label) =>
            text.find((node) =>
              label.endsWith(" ") ? node.text.startsWith(label) : node.text === label,
            ),
          );
          for (const [index, detail] of details.entries()) {
            assert.ok(detail, `${family}/${scheme}: inspector detail ${index} did not load`);
            assert.ok(
              detail.x + detail.width <= width,
              `${family}/${scheme}: ${detail.text} runs past the window`,
            );
            const previous = details[index - 1];
            if (previous)
              assert.ok(
                detail.y >= previous.y + previous.height,
                `${family}/${scheme}: inspector details overlap at ${previous.text}/${detail.text}`,
              );
          }
        }
        savePreview(root, width, height, `files-${family}-${scheme}-${width}`);
        renderShell(root, null);
      }
      for (const [width, height] of [
        [320, 440],
        [480, 600],
      ]) {
        assert.ok(width && height);
        const root = createShellRoot();
        renderShell(
          root,
          <WidgetThemeProvider theme={theme}>
            <SettingsApp
              width={width}
              height={height}
              {...settingsFixture({
                ...loadSettings(),
                themeFamily: family,
                dark: scheme === "dark",
              }).props}
            />
          </WidgetThemeProvider>,
        );
        for (const hit of collectHits(root.container).filter((hit) => hit.focusable)) {
          assert.ok(
            hit.x >= 0 && hit.x + hit.width <= width + 1,
            `${family}/${scheme}/${width}: Settings control outside window at ${hit.x}+${hit.width}`,
          );
        }
        savePreview(root, width, height, `settings-${family}-${scheme}-${width}`);
        renderShell(root, null);
      }
      console.log(`[desktop/polish-smoke] ${family}/${scheme}: real Files and Settings layouts ok`);
    }
  }
  const root = createShellRoot();
  const tree = <FilesApp width={1020} height={600} initialPath={fixture} onQuit={() => {}} />;
  const refresh = () => renderShell(root, tree);
  refresh();
  for (
    let attempt = 0;
    attempt < 100 && !textNodes(root.container).includes("README.md");
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresh();
  }
  const command: HitKeyEvent = {
    code: 33,
    key: "f",
    repeat: false,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
  const shortcut = collectHits(root.container).find((hit) => hit.onGlobalKeyDown);
  assert.ok(shortcut?.onGlobalKeyDown);
  assert.equal(shortcut.onGlobalKeyDown(command), true, "Ctrl+F must focus folder search");
  refresh();
  const search = collectHits(root.container).find(
    (hit) => hit.autoFocus && hit.focusId === "files:search",
  );
  assert.ok(search?.onKeyDown);
  search.onFocusChange?.(true);
  search.onKeyDown({ ...command, ctrlKey: false, code: 48, key: "b", text: "Botanical" });
  refresh();
  for (
    let attempt = 0;
    attempt < 100 && !textNodes(root.container).includes("Best match");
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresh();
  }
  assert.ok(
    textNodes(root.container).includes("Botanical.png"),
    "search must find actual directory entries",
  );
  assert.ok(!textNodes(root.container).includes("desktop.tsx"), "unmatched files must disappear");
  const field = collectHits(root.container).find((hit) => hit.focusId === search.focusId);
  assert.ok(field?.onKeyDown);
  field.onKeyDown({ ...command, ctrlKey: false, code: 1, key: "Escape" });
  refresh();
  assert.ok(
    textNodes(root.container).includes("desktop.tsx") &&
      !textNodes(root.container).includes("Best match"),
    "Escape must return to the folder",
  );
  renderShell(root, null);
  console.log("[desktop/polish-smoke] Ctrl+F, live filename search and Escape ok");
} finally {
  if (originalHome == null) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalConfig == null) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfig;
  fs.rmSync(temporary, { recursive: true, force: true });
}
