/** Actual public Window burst routing; no direct component handler calls. */
import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  Button,
  Surface,
  TextField,
  WidgetThemeProvider,
  Window,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindowOpts,
} from "./index";
import { HeadlessPlatform } from "./testing";

class RetainedCpuPlatform extends HeadlessPlatform {
  override createWindow(opts: PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), { presentScene: () => false });
  }
}

await installUiFonts();
const pathValue = "/home/moire/c36-native-crop/original.png";
let cases = 0;
for (const retained of [false, true]) {
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
    const observed: { value: string; changes: string[]; submissions: string[] } = {
      value: "",
      changes: [],
      submissions: [],
    };
    function Fixture() {
      const [value, setValue] = useState("");
      return (
        <WidgetThemeProvider theme={theme}>
          <Surface width={640 * scale} height={160 * scale} fill={theme.foundations.palette.bg}>
            <TextField
              x={12 * scale}
              y={12 * scale}
              width={610 * scale}
              height={40 * scale}
              autoFocus
              value={value}
              onChange={(next) => {
                observed.value = next;
                observed.changes.push(next);
                setValue(next);
              }}
              onSubmit={(next) => observed.submissions.push(next)}
            />
            <Button
              x={12 * scale}
              y={80 * scale}
              width={180 * scale}
              height={36 * scale}
              label="External value"
              focusId="external-value"
              onPress={() => {
                observed.value = "XY";
                setValue("XY");
              }}
            />
          </Surface>
        </WidgetThemeProvider>
      );
    }
    const backend = retained ? new RetainedCpuPlatform() : new HeadlessPlatform();
    const window = new Window({
      title: "TextField burst",
      width: 640 * scale,
      height: 160 * scale,
    });
    try {
      await backend.connect();
      window.setContent(<Fixture />);
      window.mount(backend);
      await Promise.resolve();
      window.tick();
      const native = backend.getWindows()[0];
      assert.ok(native);
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
      const type = (text: string) => {
        for (const character of text) key(30, character, character);
      };
      // No await, tick or rendering call between any keys in this entire burst.
      type(pathValue);
      key(28, "Enter");
      assert.equal(
        observed.value,
        pathValue,
        "single-turn actual Window preserves the complete path",
      );
      assert.deepEqual(observed.submissions, [pathValue], "submit sees the final burst value");
      assert.deepEqual(
        observed.changes,
        Array.from({ length: pathValue.length }, (_, index) => pathValue.slice(0, index + 1)),
        "every character composes with the preceding edit",
      );
      key(30, "a", undefined, true);
      type("Ab9 /-_é");
      key(107, "End");
      key(105, "ArrowLeft", undefined, false, true);
      key(105, "ArrowLeft", undefined, false, true);
      type("Z");
      assert.equal(observed.value, "Ab9 /-Z", "selection replacement composes within the burst");
      key(14, "Backspace");
      key(102, "Home");
      key(111, "Delete");
      type("q");
      key(28, "Enter");
      assert.equal(observed.value, "qb9 /-", "Backspace/Delete use the current edited value");
      assert.equal(observed.submissions.at(-1), "qb9 /-");
      // Real parent-controlled replacement through a mounted Button, then field traversal.
      native.injectPointer({
        type: "down",
        button: "left",
        x: 80 * scale,
        y: 96 * scale,
        timeMs: 1,
      });
      native.injectPointer({ type: "up", button: "left", x: 80 * scale, y: 96 * scale, timeMs: 2 });
      key(15, "Tab", undefined, false, true);
      type("!");
      key(28, "Enter");
      assert.equal(observed.value, "XY!", "external controlled value replaces the editing source");
      assert.equal(observed.submissions.at(-1), "XY!");
      window.tick();
      assert.ok(native.lastFrame?.some((byte) => byte !== 0));
      cases++;
    } finally {
      window.destroy();
      backend.disconnect();
    }
  }
}
console.log(
  `TextField ${cases} public Window burst/selection/delete/submit/external-value cases passed`,
);
