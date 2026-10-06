/* eslint-disable import/no-relative-parent-imports -- Exercise real Settings controls without applying host preferences. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import {
  collectHits,
  createShellRoot,
  hitRegionContains,
  renderShell,
  type SceneNode,
} from "@moire/react-host";
import { installUiFonts } from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { SettingsApp } from "../../../apps/core/settings/src/main";

await installUiFonts();
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-settings-display-"));
const saved = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  MOIRE_SETTINGS_TAB: process.env.MOIRE_SETTINGS_TAB,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
process.env.MOIRE_SETTINGS_TAB = "1";
type Controller = NonNullable<Parameters<typeof SettingsApp>[0]["display"]>;
const oldMode = "1280x800@60000",
  newMode = "1024x768@60000";
let actual: Awaited<ReturnType<Controller["getState"]>> = {
  current: oldMode,
  preferred: oldMode,
  name: "Test display",
  widthMm: 300,
  heightMm: 200,
  modes: [oldMode, newMode],
  outputs: [
    {
      id: "test",
      name: "Test",
      make: "",
      model: "Test",
      serial: "",
      mode: oldMode,
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
      scale120: 120,
      primary: true,
    },
  ],
};
let finishMode: ((accepted: boolean) => void) | undefined;
let modeCalls = 0,
  layoutCalls = 0,
  rejectConfirm = true,
  rejectRevert = true,
  stateFailures = 0;
const display: Controller = {
  ...actual,
  getState: async () => {
    if (stateFailures-- > 0) throw new Error("state read disconnected");
    return actual;
  },
  setMode: () => {
    modeCalls++;
    return new Promise((resolve) => {
      finishMode = resolve;
    });
  },
  confirmMode: async () => {
    if (rejectConfirm) throw new Error("confirmation connection lost");
    return true;
  },
  revertMode: async () => {
    if (rejectRevert) return false;
    actual = { ...actual, current: oldMode };
    return true;
  },
  setLayout: async (outputs) => {
    layoutCalls++;
    actual = { ...actual, outputs };
    return true;
  },
  confirmLayout: async () => false,
  revertLayout: async () => {
    actual = { ...actual, outputs: actual.outputs.map((output) => ({ ...output, scale120: 120 })) };
    return true;
  },
};
const root = createShellRoot();
const tree = (
  <SettingsApp
    width={640}
    height={1000}
    initial={loadSettings()}
    display={display}
    onQuit={() => {}}
  />
);
const refresh = () => renderShell(root, tree);
const texts = (node: SceneNode): string[] => [
  ...(node.kind === "text" ? [node.text ?? ""] : []),
  ...node.children.flatMap(texts),
];
const labels = () => texts(root.container);
const position = (
  label: string,
  node = root.container,
  x = 0,
  y = 0,
): { x: number; y: number } | null => {
  x += node.x;
  y += node.y;
  if (node.kind === "text" && node.text === label) return { x: x + 1, y: y + 1 };
  for (const child of node.children) {
    const result = position(label, child, x, y);
    if (result) return result;
  }
  return null;
};
const action = (label: string) => {
  const at = position(label);
  assert.ok(at, `Missing ${label}: ${labels().join(" | ")}`);
  return collectHits(root.container).findLast(
    (hit) =>
      hit.focusable &&
      hit.focusScopeActive !== false &&
      hit.onPress &&
      hitRegionContains(hit, at.x, at.y),
  );
};
const press = (label: string) => {
  const hit = action(label);
  assert.ok(hit?.onPress, `Unavailable ${label}`);
  hit.onPress({ x: hit.x + 1, y: hit.y + 1, localX: 1, localY: 1 });
  refresh();
};
const wait = async (condition: () => boolean) => {
  for (let step = 0; step < 400 && !condition(); step++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresh();
  }
  assert.ok(condition(), labels().join(" | "));
};
const request = async () => {
  press("1280 × 800 · Current");
  await wait(() => labels().includes("1024 × 768"));
  press("1024 × 768");
};
try {
  refresh();
  await request();
  assert.equal(modeCalls, 1);
  assert.equal(
    action("125%"),
    undefined,
    "layout changes disabled during outstanding mode request",
  );
  finishMode?.(false);
  await wait(() => labels().some((label) => label.includes("Display service rejected")));
  assert.ok(labels().includes("1280 × 800 · Current"), "rejected mode retains actual resolution");
  await request();
  actual = { ...actual, current: newMode };
  finishMode?.(true);
  await wait(() => labels().includes("Keep"));
  assert.equal(action("125%"), undefined, "layout disabled during mode trial");
  press("Keep");
  await wait(() => labels().some((label) => label.includes("confirmation connection lost")));
  assert.ok(action("Revert"), "failed confirmation keeps recovery action");
  press("Revert");
  await wait(() => labels().some((label) => label.startsWith("Reverting display mode failed")));
  assert.ok(action("Revert"), "rejected revert remains retryable");
  rejectRevert = false;
  stateFailures = 1;
  press("Revert");
  await wait(() => labels().some((label) => label.includes("state read disconnected")));
  await wait(() => labels().includes("1280 × 800 · Current") && !labels().includes("Keep"));
  press("125%");
  await wait(() => labels().includes("Keep"));
  assert.equal(layoutCalls, 1);
  press("Keep");
  await wait(() =>
    labels().some((label) => label.startsWith("Keeping display arrangement failed")),
  );
  assert.ok(action("Revert"));
  press("Revert");
  await wait(() => !labels().includes("Keep"));
  assert.equal(actual.outputs[0]!.scale120, 120);
  press("125%");
  await wait(() => labels().includes("Keep"));
  // Simulate compositor-owned rollback and a transient failure at UI expiry.
  actual = { ...actual, outputs: actual.outputs.map((output) => ({ ...output, scale120: 120 })) };
  stateFailures = 1;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 16_000;
    await wait(() => labels().some((label) => label.includes("state read disconnected")));
    await wait(() => !labels().includes("Keep"));
    assert.ok(action("125%"), "expiry reconciliation retries and unlocks display editing");
  } finally {
    Date.now = realNow;
  }
  console.log(
    "Settings real display controls: busy exclusion, rejection, connection failure and retryable rollback passed",
  );
} finally {
  renderShell(root, null);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}
