/** Public Window input lifecycle; coalesced draft events must cause one release commit. */
import assert from "node:assert/strict";
import React from "react";
import { collectHits, createShellRoot, renderShell } from "@moire/react-host";
import { Button, FocusScope, Slider, Surface, Window, installUiFonts } from "./index";
import { HeadlessPlatform } from "./testing";

await installUiFonts();
const events: Array<[string, number?]> = [];
let value = 0.4,
  disabled = false,
  visible = true;
const backend = new HeadlessPlatform();
await backend.connect();
const window = new Window({
  title: "Slider lifecycle fixture",
  width: 360,
  height: 200,
  decorated: false,
});
const scene = createShellRoot();
const element = () => (
  <Surface width={360} height={200}>
    <FocusScope id="fixture" width={360} height={200} trap>
      {visible ? (
        <Slider
          x={20}
          y={20}
          width={300}
          value={value}
          step={0.01}
          disabled={disabled}
          focusId="fixture-slider"
          onInteractionStart={() => events.push(["start"])}
          onChange={(next) => {
            value = next;
            events.push(["draft", next]);
          }}
          onCommit={(next) => events.push(["commit", next])}
          onCancel={() => events.push(["cancel"])}
        />
      ) : null}
      <Button x={20} y={90} width={160} label="Next control" focusId="next" onPress={() => {}} />
    </FocusScope>
  </Surface>
);
window.setContent(element);
window.mount(backend);
await Promise.resolve();
window.tick();
window.tick();
const native = backend.getWindows()[0]!;
const pointer = (type: "down" | "move" | "up", x: number) =>
  native.injectPointer({ type, x, y: 30, button: "left", timeMs: 1 });
const key = (type: "down" | "up", code: number, key?: string) =>
  native.injectKey({
    type,
    code,
    key,
    modifiers: { ctrl: false, alt: false, meta: false, shift: false },
    timeMs: 1,
  });
const repaint = () => {
  window.setContent(element);
  window.tick();
  window.tick();
};
try {
  renderShell(scene, element());
  assert.equal(
    collectHits(scene.container).find((hit) => hit.focusId === "fixture-slider")?.focusScopeId,
    "fixture",
  );
  pointer("down", 40);
  for (let x = 50; x <= 280; x += 10) pointer("move", x);
  assert.equal(events.filter(([kind]) => kind === "start").length, 1);
  assert.equal(
    events.filter(([kind]) => kind === "commit").length,
    0,
    "draft does not dispatch before release",
  );
  pointer("up", 300);
  window.tick();
  assert.equal(events.filter(([kind]) => kind === "commit").length, 1);
  assert.equal(events.at(-1)?.[1], value);
  assert(value > 0.9, "batched motion reaches final position");
  events.length = 0;
  key("down", 105, "ArrowLeft");
  assert.deepEqual(
    events.map(([kind]) => kind),
    ["start", "draft"],
  );
  key("up", 105, "ArrowLeft");
  window.tick();
  assert.equal(events.filter(([kind]) => kind === "commit").length, 1);
  events.length = 0;
  key("down", 102, "Home");
  key("down", 106, "ArrowRight");
  key("up", 102, "Home");
  assert.equal(events.filter(([kind]) => kind === "commit").length, 0);
  key("up", 106, "ArrowRight");
  window.tick();
  assert.deepEqual(events.at(-1), ["commit", 0.01]);
  events.length = 0;
  key("down", 107, "End");
  key("up", 107, "End");
  window.tick();
  assert.deepEqual(events.at(-1), ["commit", 1]);
  events.length = 0;
  key("down", 105, "ArrowLeft");
  key("down", 15, "Tab");
  key("up", 15, "Tab");
  window.tick();
  assert.equal(events.filter(([kind]) => kind === "cancel").length, 1, "focus loss cancels draft");
  key("up", 105, "ArrowLeft");
  assert.equal(events.filter(([kind]) => kind === "commit").length, 0);
  events.length = 0;
  pointer("down", 100);
  disabled = true;
  repaint();
  pointer("move", 240);
  pointer("up", 260);
  window.tick();
  assert.equal(events.filter(([kind]) => kind === "cancel").length, 1);
  assert.equal(events.filter(([kind]) => kind === "commit").length, 0);
  disabled = false;
  repaint();
  events.length = 0;
  pointer("down", 100);
  visible = false;
  repaint();
  pointer("up", 260);
  window.tick();
  assert.equal(
    events.filter(([kind]) => kind === "cancel").length,
    1,
    "unmount cancels captured draft",
  );
  assert.equal(events.filter(([kind]) => kind === "commit").length, 0);
  console.log(
    "[slider-commit] actual Window captured batched motion, key release, overlapping keys, blur, disabled and unmount cancellation passed",
  );
} finally {
  window.destroy();
  backend.disconnect();
}
