/** Real collection input stays attached to one stable focus owner through virtualization. */
import assert from "node:assert/strict";
import React, { useState } from "react";
import { CollectionList, CollectionRow } from "./widgets/collection-list";
import {
  Window,
  installUiFonts,
  setUiScaleFactor,
  WidgetThemeProvider,
  discoverPersonalization,
  createPersonalizedWidgetTheme,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { THEME_FAMILIES } from "@moire/theme";
await installUiFonts();
const items = Array.from({ length: 60 }, (_, index) => ({
  id: String(index),
  title: `Track ${index}`,
}));
let cases = 0;
for (const family of THEME_FAMILIES)
  for (const colorScheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      let selected = "0",
        activated = "",
        visible = new Set<string>();
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { themeFamily: family, colorScheme, reducedMotion: true }),
      );
      function Demo() {
        const [key, setKey] = useState("0");
        return (
          <CollectionList
            width={400 * scale}
            height={250 * scale}
            items={items}
            getKey={(item) => item.id}
            rowHeight={64 * scale}
            selectedKey={key}
            autoFocus
            focusId="songs"
            onSelect={(item) => {
              selected = item.id;
              setKey(item.id);
            }}
            onActivate={(item) => (activated = item.id)}
            renderItem={(item, state) => {
              visible.add(item.id);
              return (
                <CollectionRow
                  {...state}
                  title={item.title}
                  subtitle="Actual artist"
                  metadata="3:42"
                />
              );
            }}
          />
        );
      }
      const backend = new HeadlessPlatform();
      await backend.connect();
      const window = new Window({ title: "Collection", width: 400 * scale, height: 250 * scale });
      window.setContent(() => (
        <WidgetThemeProvider theme={theme}>
          <Demo />
        </WidgetThemeProvider>
      ));
      window.mount(backend);
      await Promise.resolve();
      window.tick();
      const native = backend.getWindows()[0]!;
      const key = (code: number, key: string) => {
        native.injectKey({
          type: "down",
          code,
          key,
          modifiers: { ctrl: false, shift: false, alt: false, meta: false },
          timeMs: 0,
        });
        window.tick();
      };
      key(108, "ArrowDown");
      assert.equal(selected, "1");
      visible = new Set();
      key(107, "End");
      assert.equal(selected, "59");
      window.tick();
      assert.ok(visible.has("59"), "End did not reveal virtualized selection");
      key(28, "Enter");
      assert.equal(activated, "59");
      key(103, "ArrowUp");
      key(28, "Enter");
      assert.equal(activated, "58", "activation used the old focused row");
      key(102, "Home");
      assert.equal(selected, "0");
      native.injectPointer({
        type: "down",
        button: "left",
        x: 40 * scale,
        y: 90 * scale,
        timeMs: 1,
      });
      native.injectPointer({ type: "up", button: "left", x: 40 * scale, y: 90 * scale, timeMs: 2 });
      window.tick();
      assert.equal(selected, "1");
      assert.ok(native.lastFrame?.some((value) => value !== 0));
      window.destroy();
      backend.disconnect();
      cases++;
    }
setUiScaleFactor(1);
console.log(
  `CollectionList: ${cases} themed/scaled actual Window arrow/Home/End/reveal/activation/pointer cases passed`,
);
