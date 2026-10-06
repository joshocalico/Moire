/** Real Window resize/input proves pane lifetime and hidden-scope isolation. */
import assert from "node:assert/strict";
import React, { useEffect, useState } from "react";
import { THEME_FAMILIES } from "@moire/theme";
import { AdaptivePanes } from "./widgets/adaptive-panes";
import { Button } from "./widgets/button";
import { ShortcutManager } from "./widgets/focus";
import {
  Window,
  installUiFonts,
  setUiScaleFactor,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { createShellRoot, renderShell, collectHits } from "@moire/react-host";
import { SplitView } from "./widgets/split-view";
await installUiFonts();
let mounts = 0,
  unmounts = 0,
  hiddenInvocations = 0,
  presses = 0,
  allocated = 0,
  resized = 0;
const counts = new Map<string, number>();
function StatefulPane(props: { width: number; height: number; name: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounts++;
    return () => {
      unmounts++;
    };
  }, []);
  assert.ok(props.width > 0 && props.height > 0);
  allocated++;
  counts.set(props.name, count);
  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      shortcuts={[
        { id: `${props.name}:hotkey`, key: "k", ctrl: true, onInvoke: () => hiddenInvocations++ },
      ]}
    >
      <Button
        label={`${props.name} ${count}`}
        focusId={`child:${props.name}`}
        onPress={() => {
          setCount(count + 1);
          presses++;
        }}
      />
    </ShortcutManager>
  );
}
for (const family of THEME_FAMILIES)
  for (const colorScheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const backend = new HeadlessPlatform();
      await backend.connect();
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { themeFamily: family, colorScheme, reducedMotion: true }),
      );
      const window = new Window({
        title: "Adaptive panes",
        width: 1600 * scale,
        height: 700 * scale,
      });
      let active = "content",
        reportedWidth = 0;
      const pane = (id: string) => ({
        id,
        title: id,
        render: (size: { width: number; height: number }) => <StatefulPane {...size} name={id} />,
      });
      const render = (size: { width: number; height: number }) => (
        <WidgetThemeProvider theme={theme}>
          <AdaptivePanes
            {...size}
            navigation={{
              ...pane("navigation"),
              onWidthChange: (width) => {
                reportedWidth = width;
                resized++;
              },
            }}
            collection={pane("collection")}
            content={pane("content")}
            accessory={{ ...pane("accessory"), open: true, onClose: () => {} }}
            activePaneId={active}
            onActivePaneChange={(id) => {
              active = id;
              window.setContent(render);
            }}
          />
        </WidgetThemeProvider>
      );
      window.setContent(render);
      window.mount(backend);
      await Promise.resolve();
      window.tick();
      const native = backend.getWindows()[0]!;
      const before = mounts,
        beforePresses = presses,
        beforeResizes = resized;
      const click = (x: number, y: number) => {
        native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
        native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
        window.tick();
      };
      click(50 * scale, 12 * scale);
      assert.equal(presses, beforePresses + 1);
      assert.equal(counts.get("navigation"), 1);
      click(211 * scale, 400 * scale);
      native.injectKey({
        type: "down",
        code: 106,
        key: "ArrowRight",
        modifiers: { ctrl: false, alt: false, meta: false, shift: false },
        timeMs: 0,
      });
      window.tick();
      assert.ok(
        resized > beforeResizes && reportedWidth > 208 * scale,
        "divider keyboard resize did not reach persisted width callback",
      );
      native.setSize(400 * scale, 700 * scale);
      window.tick();
      assert.equal(mounts, before, "resize remounted a pane");
      const beforeHotkey = hiddenInvocations;
      native.injectKey({
        type: "down",
        code: 37,
        key: "k",
        modifiers: { ctrl: true, alt: false, meta: false, shift: false },
        timeMs: 0,
      });
      window.tick();
      assert.equal(hiddenInvocations, beforeHotkey + 1, "hidden pane shortcut dispatched");
      // Only the content pane's active shortcut may dispatch; hidden siblings must not.
      const previous = hiddenInvocations;
      active = "collection";
      window.setContent(render);
      window.tick();
      native.injectKey({
        type: "down",
        code: 37,
        key: "k",
        modifiers: { ctrl: true, alt: false, meta: false, shift: false },
        timeMs: 0,
      });
      window.tick();
      assert.equal(hiddenInvocations, previous + 1);
      native.injectKey({
        type: "down",
        code: 1,
        key: "Escape",
        modifiers: { ctrl: false, alt: false, meta: false, shift: false },
        timeMs: 0,
      });
      window.tick();
      assert.equal(active, "content");
      native.setSize(1600 * scale, 700 * scale);
      window.tick();
      assert.equal(mounts, before);
      assert.equal(counts.get("navigation"), 1, "hidden pane lost its local state");
      assert.ok(native.lastFrame?.some((value) => value !== 0));
      window.destroy();
      backend.disconnect();
    }
// Impossible minima and a divider larger than its viewport cannot allocate outside it.
for (const width of [0, 1, 7, 40, 100]) {
  const root = createShellRoot();
  let first = 0,
    second = 0;
  renderShell(
    root,
    <SplitView
      width={width}
      height={40}
      firstSize={500}
      minFirst={80}
      minSecond={80}
      first={(size) => {
        first = size.width;
        return null;
      }}
      second={(size) => {
        second = size.width;
        return null;
      }}
    />,
  );
  assert.ok(first >= 0 && second >= 0 && first + second <= width);
  for (const hit of collectHits(root.container)) assert.ok(hit.x + hit.width <= width);
  renderShell(root, null);
}
assert.equal(mounts, unmounts);
assert.ok(allocated > 0);
setUiScaleFactor(1);
console.log(
  `AdaptivePanes: ${mounts} pane lifetimes preserved across 20 theme/scale resize+Escape cases; SplitView tiny bounds passed`,
);
