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
import { filesLayout } from "../../../apps/bundled/files/src/layout";

await installUiFonts();
setUiScaleFactor(1);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "moire-desktop-polish-"));
const originalHome = process.env.HOME;
const originalConfig = process.env.XDG_CONFIG_HOME;
process.env.HOME = temporary;
process.env.XDG_CONFIG_HOME = path.join(temporary, ".config");
const fixture = path.join(temporary, "Projects", "Moire");
fs.mkdirSync(fixture, { recursive: true });
for (const directory of ["design", "packages", "wallpapers"])
  fs.mkdirSync(path.join(fixture, directory));
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
): Array<{ text: string; x: number; y: number; height: number }> {
  x += node.x;
  y += node.y;
  return [
    ...(node.kind === "text" ? [{ text: node.text ?? "", x, y, height: node.height }] : []),
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
        renderShell(
          root,
          <WidgetThemeProvider theme={theme}>
            <FilesApp width={width} height={height} initialPath={fixture} onQuit={() => {}} />
          </WidgetThemeProvider>,
        );
        // Directory reads are asynchronous; verify the loaded app, not its
        // intentional first-frame loading state.
        for (
          let attempt = 0;
          attempt < 100 && !textNodes(root.container).includes("6 items");
          attempt++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          renderShell(
            root,
            <WidgetThemeProvider theme={theme}>
              <FilesApp width={width} height={height} initialPath={fixture} onQuit={() => {}} />
            </WidgetThemeProvider>,
          );
        }
        const metrics = filesLayout(width, height, 1);
        for (const hit of collectHits(root.container).filter(
          (hit) => hit.y < metrics.toolbarH && hit.focusable,
        )) {
          assert.ok(
            hit.x >= 0 && hit.x + hit.width <= width,
            `${family}/${scheme}/${width}: toolbar hit outside window at ${hit.x}+${hit.width}`,
          );
        }
        const toolbarLabels = positionedText(root.container).filter(
          (node) => node.y < metrics.toolbarH,
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
        assert.ok(
          textNodes(root.container).includes("6 items"),
          "status must report actual item count",
        );
        if (width >= 960) {
          for (
            let attempt = 0;
            attempt < 100 && !textNodes(root.container).includes("Contents");
            attempt++
          )
            await new Promise((resolve) => setTimeout(resolve, 10));
          const text = positionedText(root.container);
          const details = [
            "Selection",
            "File bytes",
            "Location",
            "Modified",
            "Accessed",
            "Metadata changed",
            "Permissions",
            "Owner / group",
            "Contents",
          ].map((label) => text.find((node) => node.text === label && node.x > width - 240));
          for (const [index, detail] of details.entries()) {
            assert.ok(detail, `${family}/${scheme}: inspector detail did not load`);
            const previous = details[index - 1];
            if (previous)
              assert.ok(
                detail.y >= previous.y + previous.height,
                `${family}/${scheme}: nested inspector details overlap at ${previous.text}/${detail.text}`,
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
              display={null}
              initial={{ ...loadSettings(), themeFamily: family, dark: scheme === "dark" }}
              onQuit={() => {}}
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
    attempt < 100 && !textNodes(root.container).includes("6 items");
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
    (hit) => hit.autoFocus && hit.focusId?.startsWith("text-field:"),
  );
  assert.ok(search?.onKeyDown);
  search.onFocusChange?.(true);
  search.onKeyDown({ ...command, ctrlKey: false, code: 48, key: "b", text: "Botanical" });
  refresh();
  assert.ok(
    textNodes(root.container).includes("1 item of 6"),
    "search must filter actual directory entries",
  );
  assert.ok(!textNodes(root.container).includes("desktop.tsx"), "unmatched files must disappear");
  const field = collectHits(root.container).find((hit) => hit.focusId === search.focusId);
  assert.ok(field?.onKeyDown);
  field.onKeyDown({ ...command, ctrlKey: false, code: 1, key: "Escape" });
  refresh();
  assert.ok(textNodes(root.container).includes("6 items"), "Escape must clear the filter");
  renderShell(root, null);
  console.log("[desktop/polish-smoke] Ctrl+F, live filename filtering and Escape ok");
} finally {
  if (originalHome == null) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalConfig == null) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfig;
  fs.rmSync(temporary, { recursive: true, force: true });
}
