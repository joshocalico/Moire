/** Actual public Window editing and rendered-node secrecy, no real credentials. */
import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  createShellRoot,
  renderShell,
  rasterize,
  measureText,
  type SceneNode,
} from "@moire/react-host";
import {
  TextField,
  Surface,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindowOpts,
} from "./index";
import { HeadlessPlatform } from "./testing";
class Retained extends HeadlessPlatform {
  override createWindow(opts: PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), { presentScene: () => false });
  }
}
const all = (n: SceneNode): SceneNode[] => [n, ...n.children.flatMap(all)];
await installUiFonts();
let cases = 0;
for (const retained of [false, true])
  for (const scale of [1, 1.5]) {
    setUiScaleFactor(scale);
    const theme = createPersonalizedWidgetTheme(
      discoverPersonalization("linux", {
        themeFamily: "moire",
        colorScheme: "dark",
        reducedMotion: true,
        accent: "#b794f4",
      }),
    );
    let observed = "",
      submitted = "";
    let replace: (s: string) => void = () => {};
    function App() {
      const [value, setValue] = useState("");
      replace = (s) => {
        observed = s;
        setValue(s);
      };
      return (
        <WidgetThemeProvider theme={theme}>
          <Surface width={400 * scale} height={100 * scale}>
            <TextField
              width={300 * scale}
              x={10 * scale}
              y={10 * scale}
              autoFocus
              password
              value={value}
              onChange={replace}
              onSubmit={(s) => {
                submitted = s;
              }}
            />
          </Surface>
        </WidgetThemeProvider>
      );
    }
    const backend = retained ? new Retained() : new HeadlessPlatform();
    await backend.connect();
    const win = new Window({
      title: "Synthetic password fixture",
      width: 400 * scale,
      height: 100 * scale,
    });
    try {
      win.setContent(<App />);
      win.mount(backend);
      await Promise.resolve();
      win.tick();
      const native = backend.getWindows()[0];
      assert(native);
      const key = (code: number, name: string, text?: string, ctrl = false, shift = false) => {
        for (const type of ["down", "up"] as const)
          native.injectKey({
            type,
            code,
            key: name,
            text,
            modifiers: { ctrl, shift, alt: false, meta: false },
            timeMs: code,
          });
      };
      for (const c of "Synthetic9") key(30, c, c);
      assert.equal(observed, "Synthetic9");
      key(105, "ArrowLeft", undefined, false, true);
      key(14, "Backspace");
      assert.equal(observed, "Synthetic");
      key(102, "Home");
      key(111, "Delete");
      assert.equal(observed, "ynthetic");
      key(30, "a", undefined, true);
      await backend.writeClipboardText("Private8");
      key(47, "v", undefined, true);
      await new Promise<void>((r) => setImmediate(r));
      win.tick();
      assert.equal(observed, "Private8");
      key(30, "a", undefined, true);
      await backend.writeClipboardText("sentinel");
      key(46, "c", undefined, true);
      key(45, "x", undefined, true);
      await Promise.resolve();
      assert.equal(await backend.readClipboardText(), "sentinel");
      assert.equal(observed, "Private8");
      key(28, "Enter");
      assert.equal(submitted, "Private8");
      // Pending paste must not overwrite a subsequent controlled replacement.
      await backend.writeClipboardText("LatePaste");
      key(47, "v", undefined, true);
      replace("External");
      win.requestRedraw();
      win.tick();
      await new Promise<void>((r) => setImmediate(r));
      assert.equal(observed, "External");
      replace("abcdef");
      win.requestRedraw();
      win.tick();
      const padding = theme.recipes.textField.medium.metrics.paddingX;
      const x = 10 * scale + padding + measureText("••", 1);
      for (const type of ["down", "up"] as const)
        native.injectPointer({ type, button: "left", x, y: 30 * scale, timeMs: 1 });
      key(30, "X", "X");
      assert.equal(
        observed,
        "abXcdef",
        "pointer caret maps masked glyph positions to underlying UTF-16 positions",
      );
      const paint = (value: string) => {
        const root = createShellRoot();
        renderShell(
          root,
          <WidgetThemeProvider theme={theme}>
            <TextField width={300 * scale} height={40 * scale} password value={value} focused />
          </WidgetThemeProvider>,
        );
        const texts = all(root.container)
          .filter((n) => n.kind === "text")
          .map((n) => n.text);
        assert(!texts.some((t) => t?.includes(value)));
        assert(texts.includes("•".repeat(value.length)), "masked glyph nodes");
        const pixels = rasterize(root.container, 300 * scale, 40 * scale).pixels;
        renderShell(root, null);
        return pixels;
      };
      assert.deepEqual(
        paint("Synthetic9"),
        paint("Different8"),
        "same-length synthetic values have identical masked raster",
      );
      await backend.writeClipboardText("AfterClose");
      key(47, "v", undefined, true);
      const beforeClose = observed;
      win.destroy();
      await new Promise<void>((r) => setImmediate(r));
      assert.equal(observed, beforeClose, "paste completion cannot edit after unmount");
      cases++;
    } finally {
      win.destroy();
      await backend.disconnect();
    }
  }
console.log(
  `TextField password: ${cases} public Window cases; masking/edit/paste/clipboard isolation/stale paste passed`,
);
