/** Public Window input and painted pixels; no native device or display claim. */
import assert from "node:assert/strict";
import React from "react";
import { Group, Rect } from "@moire/react-host";
import {
  Button,
  FocusScope,
  ScrollArea,
  Slider,
  TextArea,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
} from "./index";
import { HeadlessPlatform } from "./testing";

await installUiFonts();
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
let cases = 0;
try {
  for (const scheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { colorScheme: scheme, reducedMotion: true }),
      );
      const width = 320 * scale,
        viewport = 160 * scale,
        height = 220 * scale;
      const backend = new HeadlessPlatform();
      await backend.connect();
      const window = new Window({ title: "Keyboard scroll fixture", width, height });
      let contentHeight = 640 * scale;
      let offset = 0,
        slider = 0.4,
        text = "abc",
        footerCalls = 0;
      const view = () => (
        <WidgetThemeProvider theme={theme}>
          <FocusScope width={width} height={height} trap>
            <ScrollArea
              width={width}
              height={viewport}
              contentHeight={contentHeight}
              smooth={false}
              keyboard={{ focusId: "fixture:body" }}
              scrollY={offset}
              onScroll={(next) => {
                offset = next;
                window.setContent(view());
              }}
            >
              <Rect width={width - 30 * scale} height={16 * scale} fill={0xffd44066} />
              <Slider
                x={20 * scale}
                y={35 * scale}
                width={180 * scale}
                value={slider}
                focusId="fixture:slider"
                onChange={(next) => {
                  slider = next;
                  window.setContent(view());
                }}
              />
              <TextArea
                x={20 * scale}
                y={80 * scale}
                width={180 * scale}
                height={55 * scale}
                value={text}
                focusId="fixture:text"
                onChange={(next) => {
                  text = next;
                  window.setContent(view());
                }}
              />
              <Rect
                y={620 * scale}
                width={width - 30 * scale}
                height={16 * scale}
                fill={0xff31bd65}
              />
            </ScrollArea>
            <Group y={180 * scale} width={width} height={40 * scale}>
              <Button label="Back" focusId="fixture:footer" onPress={() => footerCalls++} />
            </Group>
          </FocusScope>
        </WidgetThemeProvider>
      );
      window.setContent(view());
      window.mount(backend);
      await Promise.resolve();
      window.tick();
      const native = backend.getWindows()[0]!;
      const key = (
        code: number,
        mods = modifiers,
        type: "down" | "repeat" = "down",
        value?: string,
      ) => {
        native.injectKey({ type, code, key: value, text: value, modifiers: mods, timeMs: 1 });
        native.injectKey({ type: "up", code, modifiers: mods, timeMs: 2 });
      };
      const paint = () => {
        window.tick();
        assert(native.lastFrame);
        return native.lastFrame.slice();
      };
      const body = (frame: Uint8Array) => frame.slice(0, width * viewport * 4);
      const footer = (frame: Uint8Array) => frame.slice(width * 175 * scale * 4);
      try {
        // Entering the trapped scope focuses its first reading viewport.
        const initial = paint();
        key(109);
        const page = paint();
        assert.equal(
          offset,
          Math.max(theme.recipes.scrollArea.medium.metrics.wheelStep, viewport * 0.8),
        );
        assert.notDeepEqual(body(page), body(initial), "PageDown moves actual body pixels");
        assert.deepEqual(footer(page), footer(initial), "footer pixels stay fixed");
        const before = offset;
        key(108, { ...modifiers, ctrl: true });
        key(107, { ...modifiers, shift: true });
        key(57);
        assert.equal(offset, before, "modifiers and Space cannot scroll or activate passive body");
        key(102);
        assert.equal(offset, 0);
        for (let n = 0; n < 3; n++) key(108, modifiers, "repeat");
        assert.equal(
          offset,
          theme.recipes.scrollArea.medium.metrics.wheelStep * 3,
          "batched repeats accumulate",
        );
        key(107);
        const end = paint();
        assert.equal(offset, 480 * scale);
        assert.equal(
          Buffer.from(end).readUInt32LE((Math.floor(145 * scale) * width + 60) * 4),
          0xff31bd65,
          "End reveals the actual tail marker",
        );
        key(109);
        assert.equal(offset, 480 * scale, "End is clamped");
        key(104);
        assert(offset < 480 * scale);
        key(102);
        paint();
        key(15); // Nested slider owns its arrows and Home/End.
        key(108);
        paint();
        assert(slider < 0.4);
        assert.equal(offset, 0);
        key(107);
        paint();
        assert.equal(slider, 1);
        assert.equal(offset, 0);
        key(15); // Nested editor owns caret navigation and typing.
        key(102);
        key(45, modifiers, "down", "x");
        paint();
        assert.equal(text, "xabc");
        assert.equal(offset, 0, "child editor Home/typing does not scroll parent");
        key(15);
        key(28);
        assert.equal(footerCalls, 1, "Tab still reaches stationary Back");
        assert.equal(offset, 0);
        // Pointer wheel still moves the same controlled viewport independently of focus.
        const wheelBefore = paint();
        native.injectPointer({
          type: "wheel",
          x: width - 40 * scale,
          y: 30 * scale,
          deltaY: 10000,
          timeMs: 3,
        });
        const wheelAfter = paint();
        assert.equal(offset, 480 * scale);
        assert.notDeepEqual(body(wheelAfter), body(wheelBefore));
        assert.deepEqual(footer(wheelAfter), footer(wheelBefore));
        native.injectPointer({
          type: "down",
          button: "left",
          x: width - 40 * scale,
          y: 30 * scale,
          timeMs: 4,
        });
        native.injectPointer({
          type: "up",
          button: "left",
          x: width - 40 * scale,
          y: 30 * scale,
          timeMs: 5,
        });
        key(102);
        contentHeight = viewport;
        window.setContent(view());
        paint();
        key(109);
        assert.equal(offset, 0, "short content navigation is a no-op");
        contentHeight = 640 * scale;
        window.setContent(view());
        paint();
        key(109);
        assert.equal(offset, viewport * 0.8, "reading focus survives shrink and regrow");
        cases++;
      } finally {
        window.destroy();
        backend.disconnect();
      }
    }
} finally {
  setUiScaleFactor(1);
}
console.log(
  `[scroll-keyboard] ${cases} public Window theme/scale workflows: pages/bounds/batched repeats, actual tail pixels, stationary footer, nested slider/editor keys and wheel passed`,
);
