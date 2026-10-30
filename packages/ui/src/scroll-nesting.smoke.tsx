/** Nested scroll viewports: the innermost scroller under the pointer takes the wheel, and
 * hands it to its parent once it can move no further (scroll chaining). */
import assert from "node:assert/strict";
import React from "react";
import { Rect } from "@moire/react-host";
import {
  ScrollArea,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
} from "./index";
import { HeadlessPlatform } from "./testing";

await installUiFonts();
const theme = createPersonalizedWidgetTheme(
  discoverPersonalization("linux", { colorScheme: "dark", reducedMotion: true }),
);
const backend = new HeadlessPlatform();
await backend.connect();
const window = new Window({ title: "Nested scroll fixture", width: 400, height: 300 });
let outer = 0,
  inner = 0,
  presses = 0;
const view = () => (
  <WidgetThemeProvider theme={theme}>
    <ScrollArea
      width={400}
      height={300}
      contentHeight={1200}
      smooth={false}
      scrollY={outer}
      onScroll={(next) => {
        outer = next;
        window.setContent(view());
      }}
    >
      <ScrollArea
        x={20}
        y={20}
        width={300}
        height={200}
        contentHeight={500}
        smooth={false}
        scrollY={inner}
        onScroll={(next) => {
          inner = next;
          window.setContent(view());
        }}
      >
        <Rect width={280} height={40} fill={0xff4466aa} onPress={() => presses++} />
      </ScrollArea>
    </ScrollArea>
  </WidgetThemeProvider>
);
window.setContent(view());
window.mount(backend);
await Promise.resolve();
window.tick();
const native = backend.getWindows()[0]!;
let time = 1;
const wheel = (x: number, y: number, deltaY: number) => {
  native.injectPointer({ type: "wheel", x, y, deltaY, timeMs: time++ });
  window.tick();
};
const click = (x: number, y: number) => {
  native.injectPointer({ type: "down", button: "left", x, y, timeMs: time++ });
  native.injectPointer({ type: "up", button: "left", x, y, timeMs: time++ });
  window.tick();
};

// Inside the inner viewport the inner scroller moves, not the page around it.
wheel(150, 100, 120);
assert.equal(inner, 120, "inner viewport takes the wheel");
assert.equal(outer, 0, "outer viewport stays put while the inner one can move");

// At the inner limit the remaining wheel chains to the outer viewport.
wheel(150, 100, 1000);
assert.equal(inner, 300, "inner viewport clamps at its end");
wheel(150, 100, 50);
assert.equal(outer, 50, "wheel at the inner limit scrolls the outer viewport");

// Outside the inner viewport only the outer scroller moves.
wheel(380, 280, 100);
assert.equal(outer, 150);

// Presses reach content through the wheel catchers.
outer = 0;
inner = 0;
window.setContent(view());
window.tick();
click(100, 40);
assert.equal(presses, 1, "content inside nested viewports remains pressable");
console.log("[ui/scroll-nesting] inner wheel, chaining at limits, outer wheel and press passed");
process.exit(0);
