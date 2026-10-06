/** Actual Window traversal must paint a visible focus outline on opaque controls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { PNG } from "pngjs";
import { applyThemeFamily, getTheme, THEME_FAMILIES } from "@moire/theme";
import { collectHits, createShellRoot, renderShell } from "@moire/react-host";
import {
  Button,
  FocusScope,
  Surface,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindow,
} from "./index";
import { HeadlessPlatform } from "./testing";
import { contrastRatio } from "#ui/theme-family-color";

await installUiFonts();
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
let cases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const retained of [false, true]) {
          setUiScaleFactor(scale);
          const theme = createPersonalizedWidgetTheme(
            discoverPersonalization("linux", {
              themeFamily: family,
              colorScheme,
              accent: applyThemeFamily(getTheme(), family, colorScheme === "dark").tokens.accent,
              contrast: "normal",
              reducedTransparency: false,
              fontScale: 1,
              reducedMotion: true,
            }),
          );
          const width = 360 * scale,
            height = 440 * scale;
          const actions: string[] = [];
          const controls: Array<{
            id: string;
            variant: "primary" | "danger" | "secondary" | "ghost";
            fill?: number;
          }> = [
            { id: "primary", variant: "primary" },
            { id: "danger", variant: "danger" },
            { id: "secondary", variant: "secondary" },
            { id: "explicit", variant: "primary", fill: theme.foundations.palette.focusRing },
            { id: "ghost", variant: "ghost" },
          ];
          const element = (
            <WidgetThemeProvider theme={theme}>
              <Surface width={width} height={height} fill={theme.foundations.palette.panel}>
                <FocusScope width={width} height={height} trap>
                  <Button
                    x={24 * scale}
                    y={12 * scale}
                    width={280 * scale}
                    height={36 * scale}
                    label="Anchor"
                    focusId="anchor"
                    onPress={() => actions.push("anchor")}
                  />
                  {controls.map((control, index) => (
                    <Button
                      key={control.id}
                      x={24 * scale}
                      y={(64 + index * 56) * scale}
                      width={280 * scale}
                      height={40 * scale}
                      label={control.id === "primary" ? "Keep both" : control.id}
                      variant={control.variant}
                      fill={control.fill}
                      focusId={control.id}
                      onPress={() => actions.push(control.id)}
                    />
                  ))}
                  <Button
                    x={24 * scale}
                    y={352 * scale}
                    width={280 * scale}
                    height={40 * scale}
                    label="Disabled"
                    variant="primary"
                    disabled
                    focusId="disabled"
                    onPress={() => actions.push("disabled")}
                  />
                </FocusScope>
              </Surface>
            </WidgetThemeProvider>
          );
          const scene = createShellRoot();
          renderShell(scene, element);
          const hits = collectHits(scene.container);
          const backend = new HeadlessPlatform();
          await backend.connect();
          const window = new Window({ title: "Primary focus", width, height, decorated: false });
          window.setContent(() => element);
          window.mount(backend);
          await Promise.resolve();
          const native = backend.getWindows()[0];
          assert.ok(native);
          if (retained) {
            const platform: PlatformWindow = native;
            platform.presentScene = () => false;
          }
          const key = (code: number, value: string, shift = false) => {
            for (const type of ["down", "up"] as const)
              native.injectKey({
                type,
                code,
                key: value,
                modifiers: { ...modifiers, shift },
                timeMs: 1,
              });
            window.tick();
          };
          const frame = () => {
            assert.ok(native.lastFrame);
            return native.lastFrame.slice();
          };
          const capture = (name: string, bytes: Uint8Array) => {
            const directory = process.env.MOIRE_FOCUS_CAPTURE_DIR;
            if (
              !directory ||
              family !== "moire" ||
              colorScheme !== "dark" ||
              scale !== 1 ||
              retained
            )
              return;
            fs.mkdirSync(directory, { recursive: true });
            const png = new PNG({ width, height });
            // Window's native framebuffer is tight BGRA; PNG encodes RGBA.
            for (let offset = 0; offset < bytes.length; offset += 4) {
              png.data[offset] = bytes[offset + 2]!;
              png.data[offset + 1] = bytes[offset + 1]!;
              png.data[offset + 2] = bytes[offset]!;
              png.data[offset + 3] = bytes[offset + 3]!;
            }
            fs.writeFileSync(path.join(directory, `${name}.png`), PNG.sync.write(png));
          };
          const pixel = (bytes: Uint8Array, x: number, y: number) => {
            const offset = (y * width + x) * 4;
            return (
              ((bytes[offset + 3]! << 24) |
                (bytes[offset + 2]! << 16) |
                (bytes[offset + 1]! << 8) |
                bytes[offset]!) >>>
              0
            );
          };
          try {
            window.tick();
            // Mounting the trap chooses its initial anchor after layout; paint
            // that focus before recording the stable unfocused-control frame.
            window.tick();
            const initial = frame();
            capture("unfocused-primary", initial);
            for (const control of controls) {
              const hit = hits.find((candidate) => candidate.focusId === control.id);
              assert.ok(hit);
              key(15, "Tab");
              const focused = frame();
              if (control.id === "primary") capture("focused-primary", focused);
              let contrastingBorder = 0;
              for (let y = Math.ceil(hit.y); y < Math.floor(hit.y + hit.height); y++)
                for (let x = Math.ceil(hit.x); x < Math.floor(hit.x + hit.width); x++) {
                  if (
                    // The central band is inside even a fully rounded capsule;
                    // a rectangular five-pixel inset can still cross its rim.
                    x > hit.x + hit.height / 2 &&
                    x < hit.x + hit.width - hit.height / 2 &&
                    y > hit.y + 5 * scale &&
                    y < hit.y + hit.height - 5 * scale
                  ) {
                    assert.equal(
                      pixel(focused, x, y),
                      pixel(initial, x, y),
                      `${family}/${colorScheme}/${scale}/${retained}/${control.id} at ${x},${y}: focus does not repaint label or interior fill`,
                    );
                    continue;
                  }
                  // Transparent ghost retains its existing theme policy; opaque
                  // controls require a genuinely contrasting outline.
                  if (
                    contrastRatio(pixel(focused, x, y), pixel(initial, x, y)) >=
                    (control.variant === "ghost" ? 1.1 : 3)
                  )
                    contrastingBorder++;
                }
              assert.ok(
                contrastingBorder > hit.width / 2,
                `${family}/${colorScheme}/${scale}/${retained}/${control.id}: focus needs contrasting border pixels; got ${contrastingBorder}`,
              );
              key(28, "Enter");
              assert.equal(actions.at(-1), control.id, "pixels and actual keyboard target agree");
            }
            // Disabled is skipped; wrapping restores the initial anchor frame.
            key(15, "Tab");
            capture("blurred-primary", frame());
            assert.ok(
              Buffer.from(frame()).equals(initial),
              "blur restores all original unfocused pixels",
            );
            key(15, "Tab", true);
            key(57, " ");
            assert.equal(actions.at(-1), "ghost", "reverse traversal skips disabled control");
            assert.ok(!actions.includes("disabled"));
            cases++;
          } finally {
            window.destroy();
            backend.disconnect();
            renderShell(scene, null);
          }
        }
  console.log(
    `Primary focus ${cases} actual Window cases: contrasting outline, unchanged interior/rest pixels, Tab/ShiftTab/Enter/Space, disabled skipping; direct and retained CPU. No native display claim.`,
  );
} finally {
  setUiScaleFactor(1);
}
