import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  Rect,
  createShellRoot,
  renderShell,
  collectHits,
  SoftwareRenderer,
} from "@moire/react-host";
import { THEME_FAMILIES } from "@moire/theme";
import { installUiFonts, Window, Pressable, IconButton, Select, OverlayHost } from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { discoverPersonalization } from "./personalization";
import { createPersonalizedWidgetTheme, resolveStatefulStyle } from "./widget-theme";
import { contrastRatio } from "./theme-families/color";
import { createMotionValue, easeTo, tickMotionFrame } from "./motion";

// A scheduler stops on the first inactive frame. Closing a tooltip must publish
// exactly zero then, rather than leaving a faint outline until another redraw.
const closingOpacity = createMotionValue(1);
easeTo(closingOpacity, 0);
let closingFrame = tickMotionFrame(1 / 60);
for (let frame = 0; closingFrame.active && frame < 120; frame++)
  closingFrame = tickMotionFrame(1 / 60);
assert.equal(closingFrame.active, false);
assert.equal(closingOpacity.get(), 0, "the final close frame must be fully transparent");
assert.equal(closingFrame.requiresReconcile, true, "publish the final opacity before stopping");

await installUiFonts();
for (const family of THEME_FAMILIES) {
  for (const scheme of ["dark", "light"] as const) {
    const profile = discoverPersonalization("linux", { themeFamily: family, colorScheme: scheme });
    const theme = createPersonalizedWidgetTheme(profile);
    for (const variant of ["primary", "danger"] as const) {
      const recipe = theme.recipes.button[variant].medium;
      for (const state of ["rest", "hover", "pressed"] as const) {
        const root = resolveStatefulStyle(recipe.root, state);
        assert.ok(
          contrastRatio(root.fill, recipe.label.base.color) >= 4.5,
          `${family}/${scheme}/${variant}/${state} text contrast is ${contrastRatio(root.fill, recipe.label.base.color).toFixed(2)}`,
        );
        assert.equal(recipe.leadingIcon.base.color, recipe.label.base.color);
        assert.equal(recipe.trailingIcon.base.color, recipe.label.base.color);
      }
    }
  }
}

// Function artwork and element artwork must share the same centered allocation.
const root = createShellRoot();
const render = (icon: React.ReactNode | (() => React.ReactNode)) => {
  renderShell(
    root,
    <IconButton x={10} y={10} width={40} height={40} variant="ghost" icon={icon} />,
  );
  return new SoftwareRenderer().render(root.container, { width: 60, height: 60 }).pixels;
};
const artwork = <Rect width={16} height={16} fill={0xffffffff} />;
assert.deepEqual(
  render(artwork),
  render(() => artwork),
  "function artwork must center like element artwork",
);
renderShell(root, null);

const backend = new HeadlessPlatform();
await backend.connect();
const win = new Window({ title: "Pressable keyboard check", width: 240, height: 80 });
let activations = 0;
win.setContent(
  <Pressable x={10} y={10} width={100} height={40} autoFocus onPress={() => activations++} />,
);
win.mount(backend);
await Promise.resolve();
win.tick();
const native = backend.getWindows()[0];
assert.ok(native);
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
native.injectKey({ type: "down", code: 28, key: "Enter", modifiers, timeMs: 1 });
native.injectKey({ type: "repeat", code: 28, key: "Enter", modifiers, timeMs: 2 });
native.injectKey({ type: "down", code: 57, key: " ", modifiers, timeMs: 3 });
assert.equal(activations, 2, "pressable must activate once per Enter/Space, without key repeat");
win.destroy();
backend.disconnect();

const selectBackend = new HeadlessPlatform();
await selectBackend.connect();
const selectWindow = new Window({ title: "Select navigation check", width: 260, height: 240 });
let selected = "a";
let selectOpen = false;
function SelectHarness() {
  const [value, setValue] = useState("a");
  return (
    <OverlayHost width={260} height={240}>
      <Select
        x={10}
        y={10}
        width={180}
        viewportWidth={260}
        viewportHeight={240}
        value={value}
        onOpenChange={(open) => {
          selectOpen = open;
        }}
        options={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Disabled", disabled: true },
          { id: "c", label: "Charlie" },
          { id: "d", label: "Delta" },
        ]}
        onChange={(next) => {
          selected = next;
          setValue(next);
        }}
      />
    </OverlayHost>
  );
}
selectWindow.setContent(<SelectHarness />);
selectWindow.mount(selectBackend);
await Promise.resolve();
selectWindow.tick();
const selectNative = selectBackend.getWindows()[0];
assert.ok(selectNative);
const key = (code: number, name: string) => {
  selectNative.injectKey({ type: "down", code, key: name, modifiers, timeMs: code });
  selectWindow.tick();
  selectWindow.tick();
  selectWindow.tick();
};
key(15, "Tab");
key(28, "Enter");
key(108, "ArrowDown");
key(28, "Enter");
assert.equal(
  selected,
  "c",
  "Down/Enter must skip disabled options and select the next enabled item",
);
key(15, "Tab");
key(28, "Enter");
assert.equal(selectOpen, true, "select must reopen by keyboard after a choice");
key(107, "End");
key(28, "Enter");
assert.equal(selected, "d", "End must focus the last enabled option");
key(15, "Tab");
key(28, "Enter");
key(102, "Home");
key(28, "Enter");
assert.equal(selected, "a", "Home must focus the first enabled option");
selectWindow.destroy();
selectBackend.disconnect();

// The control retains hover ownership while its tooltip is visible.
const hoverRoot = createShellRoot();
renderShell(
  hoverRoot,
  <IconButton width={40} height={40} icon="×" tooltip="Close" onPress={() => {}} />,
);
const hoverHits = collectHits(hoverRoot.container).filter((hit) => hit.onPointerEnter);
assert.equal(hoverHits.length, 1, "tooltip must not intercept the button's hover region");
assert.ok(hoverHits[0]?.onPress);
renderShell(hoverRoot, null);
console.log(
  "[ui/polish-smoke] contrast, icon alignment, pressable/select keyboard interaction and tooltip hover ok",
);
