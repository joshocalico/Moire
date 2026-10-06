/* eslint-disable import/no-relative-parent-imports -- Exercise production Settings/Greeter consumers against disposable preference files. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import {
  collectHits,
  createShellRoot,
  renderShell,
  type SceneNode,
} from "../../react-host/src/index";
import { Application } from "../../ui/src/application";
import { installUiFonts } from "../../ui/src/font/index";
import { SettingsApp } from "../../../apps/core/settings/src/main";
import { GreeterApp } from "../../../apps/system/greeter/src/view";
import { greeterHarness } from "../../../apps/system/greeter/src/testing";
import { loadSettings, settingsPath, updateSettings } from "../src/index";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-motion-consumers-"));
const keys = ["HOME", "XDG_CONFIG_HOME", "PATH", "MOIRE_SETTINGS_TAB"];
const original = keys.map((key) => [key, process.env[key]] as const);
process.env.HOME = directory;
process.env.XDG_CONFIG_HOME = path.join(directory, "config");
process.env.MOIRE_SETTINGS_TAB = "0";
const app = new Application({ platform: "headless" });
const root = createShellRoot();
const texts = (node: SceneNode): string[] => [
  ...(node.kind === "text" ? [node.text ?? ""] : []),
  ...node.children.flatMap(texts),
];
let pending: Promise<void> | null = null;
let settingsWrites = 0;
const refresh = () =>
  renderShell(
    root,
    <SettingsApp
      width={640}
      height={1000}
      initial={loadSettings()}
      reducedMotion={loadSettings().reducedMotion}
      display={null}
      onQuit={() => {}}
      onReducedMotionChange={(value) => {
        settingsWrites++;
        pending = app.setSessionReducedMotion(value);
        return pending;
      }}
    />,
  );
function action(node: SceneNode, label: string): ReturnType<typeof collectHits>[number] | null {
  for (const child of node.children) {
    const found = action(child, label);
    if (found) return found;
  }
  if (!texts(node).includes(label)) return null;
  return collectHits(node).find((hit) => hit.focusable && hit.onPress) ?? null;
}
function press(label: string) {
  const hit = action(root.container, label);
  assert.ok(hit?.onPress, `Missing active ${label}: ${texts(root.container).join(" | ")}`);
  hit.onPress({ x: hit.x + 1, y: hit.y + 1, localX: 1, localY: 1 });
  refresh();
}
async function settled() {
  await pending?.catch(() => {});
  await Promise.resolve();
  await Promise.resolve();
  refresh();
}
try {
  await installUiFonts();
  // Settings appearance apply may call optional host tools: none can resolve here.
  process.env.PATH = path.join(directory, "no-host-tools");
  updateSettings({ reducedMotion: false, volume: 0.31 });
  refresh();
  press("Reduce motion");
  await settled();
  assert.equal(settingsWrites, 1);
  assert.equal(loadSettings().reducedMotion, true);
  assert.ok(texts(root.container).includes("Motion preference saved"));
  assert.equal(loadSettings().volume, 0.31, "motion-only save changed audio preference");
  // A separate consumer changes fields after Settings mounted. Appearance must not save its stale snapshot.
  updateSettings({ reducedMotion: false, notifications: false, uiScale: 1.5 });
  refresh();
  press("Light");
  assert.equal(loadSettings().dark, false);
  assert.equal(loadSettings().reducedMotion, false);
  assert.equal(loadSettings().notifications, false);
  assert.equal(loadSettings().uiScale, 1.5);
  // Actual filesystem failure reaches the existing Settings notice, not an optimistic saved state.
  const config = path.dirname(settingsPath());
  fs.renameSync(config, path.join(directory, "held"));
  fs.writeFileSync(config, "not a directory");
  press("Reduce motion");
  await settled();
  assert.ok(
    texts(root.container).some((text) => text.startsWith("Could not save motion preference:")),
  );
  fs.unlinkSync(config);
  fs.renameSync(path.join(directory, "held"), config);
  renderShell(root, null);

  let reduced = loadSettings().reducedMotion;
  let busy = false;
  let notice = "";
  let saves = 0;
  const greeter = await greeterHarness((size, window) => (
    <GreeterApp
      {...size}
      username="fixture"
      now={new Date("2026-10-03T12:34:00Z")}
      reducedMotion={reduced}
      reducedMotionBusy={busy}
      reducedMotionStatus={notice}
      onContinue={async () => {}}
      onReducedMotionChange={(value) => {
        if (busy) return;
        busy = true;
        saves++;
        window.requestRedraw();
        pending = app
          .setSessionReducedMotion(value)
          .then(() => {
            reduced = value;
            notice = "Motion preference saved for Moire apps.";
          })
          .catch((error: unknown) => {
            notice = `Could not save motion preference: ${error instanceof Error ? error.message : String(error)}`;
          })
          .finally(() => {
            busy = false;
            window.requestRedraw();
          });
      }}
    />
  ));
  try {
    greeter.key(15, "Tab");
    greeter.key(28, "Enter");
    await greeter.settle();
    greeter.key(57, " ");
    await pending;
    await greeter.settle();
    assert.equal(saves, 1, "keyboard checkbox did not reach the real persistent API");
    assert.equal(loadSettings().reducedMotion, true);
    const successPixels = greeter.native.lastFrame?.slice();
    assert.ok(successPixels);
    fs.renameSync(config, path.join(directory, "held"));
    fs.writeFileSync(config, "not a directory");
    greeter.key(57, " ");
    await pending;
    await greeter.settle();
    assert.equal(reduced, true, "failed write optimistically changed checkbox value");
    assert.ok(notice.startsWith("Could not save motion preference:"));
    assert.notDeepEqual(
      greeter.native.lastFrame,
      successPixels,
      "actual Window pixels did not change when the save error replaced success feedback",
    );
    assert.ok(
      greeter.native.presentedFrames > 0,
      "preference feedback never rendered through actual Window",
    );
    fs.unlinkSync(config);
    fs.renameSync(path.join(directory, "held"), config);
  } finally {
    greeter.destroy();
  }
  console.log(
    "[reduced-motion/consumers] production Settings switch/async error/stale appearance patch and actual Window greeter keyboard save/error passed; no host tools or services",
  );
} finally {
  renderShell(root, null);
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
