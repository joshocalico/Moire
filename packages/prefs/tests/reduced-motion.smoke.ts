/* eslint-disable import/no-relative-parent-imports -- Exercise real workspace consumers in isolated preference fixtures. */
/** Real preference files/watchers and independent Application processes, all disposable. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SETTINGS,
  createPrefsWatcher,
  loadSettings,
  saveSettings,
  settingsPath,
  updateSettings,
} from "../src/index";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-motion-prefs-"));
const previousConfig = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = path.join(directory, "config");
const children: ChildProcess[] = [];
function child(label: string) {
  const home = path.join(directory, label);
  fs.mkdirSync(home);
  const processChild = fork(
    fileURLToPath(new URL("./application.child.tsx", import.meta.url)),
    [],
    {
      execArgv: process.execArgv,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        MOIRE_SESSION: "1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  children.push(processChild);
  let output = "";
  processChild.stdout?.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  processChild.stderr?.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  const messages: Record<string, unknown>[] = [];
  const listeners = new Set<() => void>();
  processChild.on("message", (message: unknown) => {
    if (isRecord(message)) messages.push(message);
    for (const listener of listeners) listener();
  });
  processChild.on("exit", () => {
    for (const listener of listeners) listener();
  });
  let serial = 0;
  const wait = (predicate: (message: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`${label} IPC deadline: ${output}`));
      }, 8000);
      function check() {
        const match = messages.find(predicate);
        if (match) {
          clearTimeout(timeout);
          listeners.delete(check);
          resolve(match);
        } else if (processChild.exitCode !== null || processChild.signalCode !== null) {
          clearTimeout(timeout);
          listeners.delete(check);
          reject(new Error(`${label} exited early: ${output}`));
        }
      }
      listeners.add(check);
      check();
    });
  const command = (kind: string, value?: boolean) => {
    const id = ++serial;
    processChild.send({ kind, id, value });
    return wait((message) => message.kind === "response" && message.id === id);
  };
  const profile = (value: boolean, after = messages.length) =>
    wait(
      (message) =>
        messages.indexOf(message) >= after &&
        message.kind === "profile" &&
        message.reduced === value,
    );
  return { command, profile, messages, processChild, output: () => output };
}

try {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  // Legacy file has every existing valid field and no reducedMotion key.
  const legacy = {
    ...DEFAULT_SETTINGS,
    dark: false,
    themeFamily: "cupertino",
    uiScale: 1.4,
    notifications: false,
    volume: 0.32,
    showDesktopIcons: false,
    displayMode: "1280x800@60000",
    displayOutputs: {
      "edid:fixture": {
        x: 120,
        y: 80,
        scale120: 180,
        primary: true,
        mode: "1280x800@60000",
      },
    },
    wallpaper: { mode: "image", path: "/fixture/botanical.png", preset: "fixture" },
  };
  const { reducedMotion: _legacyMotion, ...legacyFile } = legacy;
  fs.writeFileSync(settingsPath(), JSON.stringify(legacyFile));
  assert.equal(loadSettings().reducedMotion, false);
  updateSettings({ reducedMotion: true });
  assert.deepEqual(loadSettings(), { ...legacy, reducedMotion: true });
  updateSettings({ notifications: true });
  assert.deepEqual(loadSettings(), { ...legacy, notifications: true, reducedMotion: true });
  const validProfile = loadSettings();
  for (const value of [null, 1, "true", "false", [], {}]) {
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...validProfile, reducedMotion: value }));
    assert.equal(
      loadSettings().reducedMotion,
      false,
      `invalid reducedMotion ${JSON.stringify(value)}`,
    );
    assert.equal(loadSettings().volume, 0.32, "one bad field erased valid unrelated values");
  }
  for (const value of [null, [], "true", 4]) {
    fs.writeFileSync(settingsPath(), JSON.stringify(value));
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  }
  fs.writeFileSync(settingsPath(), '{"reducedMotion":true,"volume":1e400,"uiScale":1e400}');
  assert.equal(loadSettings().volume, DEFAULT_SETTINGS.volume);
  assert.equal(loadSettings().uiScale, DEFAULT_SETTINGS.uiScale);
  fs.writeFileSync(settingsPath(), "{broken");
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  saveSettings({ ...validProfile, reducedMotion: false });
  let notifications = 0;
  const watcher = createPrefsWatcher(() => {
    notifications++;
  });
  const before = fs.statSync(settingsPath());
  updateSettings({ reducedMotion: true });
  // Preserve mtime to prove atomic replacement inode distinguishes motion-only changes.
  fs.utimesSync(settingsPath(), before.atime, before.mtime);
  assert.equal(watcher.poll(), true);
  assert.equal(notifications, 1);
  assert.equal(watcher.poll(), false, "duplicate preference observation notified again");
  watcher.stop();
  saveSettings({ ...validProfile, reducedMotion: false });

  const first = child("first");
  const second = child("second");
  for (const app of [first, second]) {
    const initial = await app.profile(false, 0);
    assert.equal(initial.accent, "#123456");
    assert.equal(initial.fontScale, 1.15);
    assert.ok(typeof initial.normalMs === "number" && initial.normalMs > 0);
  }
  const firstAt = first.messages.length,
    secondAt = second.messages.length;
  assert.equal((await first.command("save", true)).ok, true);
  for (const [app, index] of [
    [first, firstAt],
    [second, secondAt],
  ] as const) {
    const changed = await app.profile(true, index);
    assert.equal(changed.normalMs, 0, "actual Window theme did not reduce motion");
    assert.equal(changed.fontScale, 1.15, "saving motion replaced unrelated application override");
  }
  assert.equal(loadSettings().reducedMotion, true);
  const third = child("restart");
  assert.equal(
    (await third.profile(true, 0)).normalMs,
    0,
    "restarted Application forgot preference",
  );

  const positions = [first, second, third].map((app) => app.messages.length);
  assert.equal((await second.command("save", false)).ok, true);
  for (const [index, app] of [first, second, third].entries()) {
    const changed = await app.profile(false, positions[index]);
    assert.ok(
      typeof changed.normalMs === "number" && changed.normalMs > 0,
      "writer retained a sticky local override instead of consuming later profile changes",
    );
  }
  const current = loadSettings();
  assert.equal(current.reducedMotion, false);
  assert.equal(current.displayMode, validProfile.displayMode);
  assert.deepEqual(current.displayOutputs, validProfile.displayOutputs);
  assert.deepEqual(current.wallpaper, validProfile.wallpaper);
  assert.equal(current.volume, validProfile.volume);

  // A real invalid config destination rejects the async public API without changing profile.
  fs.renameSync(path.dirname(settingsPath()), path.join(directory, "saved-settings"));
  fs.writeFileSync(path.dirname(settingsPath()), "not a directory");
  const failure = await first.command("save", true);
  assert.equal(failure.ok, false);
  assert.equal(typeof failure.error, "string");
  const failedProfile = await first.command("query");
  assert.ok(isRecord(failedProfile.profile));
  assert.equal(failedProfile.profile.reducedMotion, false);
  fs.unlinkSync(path.dirname(settingsPath()));
  fs.renameSync(path.join(directory, "saved-settings"), path.dirname(settingsPath()));
  for (const app of [first, second, third]) {
    const exited = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Application did not exit: ${app.output()}`)),
        3000,
      );
      app.processChild.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Application exit ${code}: ${app.output()}`));
      });
    });
    assert.equal((await app.command("quit")).ok, true);
    await exited;
  }
  console.log(
    "[reduced-motion] legacy fields, malformed boundaries, atomic watcher, 3 independent real Applications, live changes/restart/theme and async save failure passed; isolated HOME/XDG only",
  );
} finally {
  for (const processChild of children) {
    if (processChild.exitCode === null && processChild.signalCode === null) {
      processChild.disconnect?.();
      processChild.kill("SIGTERM");
    }
  }
  if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousConfig;
  fs.rmSync(directory, { recursive: true, force: true });
}
