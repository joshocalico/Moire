/** Persistent modal actions through real layout, clipping, pixels and public Window input. */
import assert from "node:assert/strict";
import React from "react";
import { collectHits, createShellRoot, renderShell, type HitRegion } from "@moire/react-host";
import {
  Button,
  Column,
  Dialog,
  FocusScope,
  Label,
  ScrollColumn,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";

await installUiFonts();
let cases = 0;
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
function crop(
  frame: Uint8Array,
  width: number,
  bounds: Pick<HitRegion, "x" | "y" | "width" | "height">,
): Uint8Array {
  const left = Math.ceil(bounds.x),
    top = Math.ceil(bounds.y);
  const right = Math.floor(bounds.x + bounds.width),
    bottom = Math.floor(bounds.y + bounds.height);
  const out = new Uint8Array((right - left) * (bottom - top) * 4);
  for (let y = top; y < bottom; y++)
    out.set(
      frame.subarray((y * width + left) * 4, (y * width + right) * 4),
      (y - top) * (right - left) * 4,
    );
  return out;
}
try {
  for (const scheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5])
      for (const compact of [false, true]) {
        setUiScaleFactor(scale);
        const theme = createPersonalizedWidgetTheme(
          discoverPersonalization("linux", {
            themeFamily: "moire",
            colorScheme: scheme,
            reducedMotion: true,
          }),
        );
        const width = (compact ? 400 : 720) * scale,
          height = (compact ? 360 : 520) * scale;
        const inset = 8 * scale,
          dialogWidth = width - inset * 2,
          dialogHeight = height - inset * 2;
        const actions = { confirm: 0, skip: 0, done: 0, close: 0 };
        const element = (
          <WidgetThemeProvider theme={theme}>
            <FocusScope
              x={inset}
              y={inset}
              width={dialogWidth}
              height={dialogHeight}
              trap
              onEscape={() => actions.close++}
            >
              <Dialog
                width={dialogWidth}
                height={dialogHeight}
                title="Persistent actions"
                onClose={() => actions.close++}
                footer={
                  <Column gap={6 * scale}>
                    <Button
                      label="Confirm"
                      focusId="footer-confirm"
                      onPress={() => actions.confirm++}
                    />
                    <Button label="Skip" focusId="footer-skip" onPress={() => actions.skip++} />
                    <Button label="Done" focusId="footer-done" onPress={() => actions.done++} />
                  </Column>
                }
              >
                <ScrollColumn smooth={false} flexGrow={1} gap={12 * scale}>
                  {Array.from({ length: 12 }, (_, index) => (
                    <Label key={index} height={44 * scale} text={`Visible detail ${index + 1}`} />
                  ))}
                </ScrollColumn>
              </Dialog>
            </FocusScope>
          </WidgetThemeProvider>
        );
        // Independent real shared scene layout supplies coordinates; actual
        // controls below are activated only through public Window input.
        const scene = createShellRoot();
        renderShell(scene, element);
        const hits = collectHits(scene.container);
        const buttons = ["confirm", "skip", "done"].map((id) => {
          const hit = hits.find((candidate) => candidate.focusId === `footer-${id}`);
          assert.ok(hit?.onPress);
          assert.ok(hit.height > 20 * scale, "footer must have a real intrinsic allocation");
          assert.ok(
            hit.y + hit.height <= height - inset,
            "complete footer control stays inside dialog",
          );
          assert.ok(
            hit.pointerClip &&
              hit.y >= hit.pointerClip.y &&
              hit.y + hit.height <= hit.pointerClip.y + hit.pointerClip.height,
          );
          return hit;
        });
        const wheel = hits.find((hit) => hit.onWheel && hit.width > dialogWidth / 2);
        assert.ok(wheel?.onWheel);
        assert.ok(
          wheel.y + wheel.height <= buttons[0]!.y,
          "scroll viewport cannot overlap persistent actions",
        );
        const backend = new HeadlessPlatform();
        await backend.connect();
        const window = new Window({ title: "Dialog footer", width, height, decorated: false });
        // Production-style content factory must keep internal ScrollArea state.
        window.setContent(() => element);
        window.mount(backend);
        await Promise.resolve();
        const native = backend.getWindows()[0]!;
        try {
          window.tick();
          assert.ok(native.lastFrame);
          for (const hit of buttons) {
            const point = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
            native.injectPointer({ type: "down", button: "left", ...point, timeMs: 1 });
            native.injectPointer({ type: "up", button: "left", ...point, timeMs: 2 });
            window.tick();
          }
          assert.deepEqual(
            actions,
            { confirm: 1, skip: 1, done: 1, close: 0 },
            "all actions reachable before any scrolling",
          );
          // Move off the footer and settle press/hover feedback before the
          // snapshot. Wheel input then has the same pointer position and cannot
          // be confused with legitimate hover-leave color interpolation.
          native.injectPointer({
            type: "move",
            x: wheel.x + wheel.width / 2,
            y: wheel.y + wheel.height / 2,
            timeMs: 3,
          });
          for (let frame = 0; frame < 6; frame++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
            window.tick();
          }
          const before = native.lastFrame.slice();
          native.injectPointer({
            type: "wheel",
            x: wheel.x + wheel.width / 2,
            y: wheel.y + wheel.height / 2,
            deltaY: 10000,
            timeMs: 3,
          });
          window.tick();
          const after = native.lastFrame!;
          assert.ok(
            !Buffer.from(crop(before, width, wheel)).equals(crop(after, width, wheel)),
            "details actually scroll",
          );
          for (const hit of buttons)
            assert.ok(
              Buffer.from(crop(before, width, hit)).equals(crop(after, width, hit)),
              "footer pixels remain stationary during body scroll",
            );
          native.injectKey({
            type: "down",
            code: 15,
            key: "Tab",
            modifiers: { ...modifiers, shift: true },
            timeMs: 4,
          });
          native.injectKey({ type: "down", code: 28, key: "Enter", modifiers, timeMs: 5 });
          assert.equal(actions.skip, 2, "footer remains keyboard-accessible after body scrolling");
          native.injectKey({ type: "down", code: 1, key: "Escape", modifiers, timeMs: 6 });
          assert.equal(actions.close, 1);
          cases++;
        } finally {
          window.destroy();
          backend.disconnect();
          renderShell(scene, null);
        }
      }
  console.log(
    `Dialog footer ${cases} cases: real intrinsic allocation/clipping, all public Window actions before scrolling, changed detail pixels/stationary footer, keyboard/Escape. Headless scope; no native display claim.`,
  );
} finally {
  setUiScaleFactor(1);
}
