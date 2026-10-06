import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { PNG } from "pngjs";
import {
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type ContextMenuAction,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import {
  StorageControlError,
  parseStorageVolumeId,
  type StorageClient,
  type StorageClientState,
  type StorageActionRequest,
  type StorageOperation,
  type StorageVolume,
} from "@moire/system-management/storage-status";
import { FilesApp } from "./main";
import { RemovableDriveRow } from "./removable-drive-row";
import { createFolderTab, navigateFolderTab, tabDirectory } from "./navigation";
import {
  RemovableDriveController,
  canDriveAction,
  isWithinMount,
  retireDrivePaths,
  storageCaption,
  type DriveAction,
} from "./removable-drives";

const id = parseStorageVolumeId("/org/freedesktop/UDisks2/block_devices/fixture_a");
const otherId = parseStorageVolumeId("/org/freedesktop/UDisks2/block_devices/fixture_b");
function volume(directory?: string, selectedId = id): StorageVolume {
  return {
    id: selectedId,
    label: "Disposable drive with a deliberately long descriptive label",
    device: "/dev/fixture-only",
    sizeBytes: 1024,
    filesystem: "ext4",
    mount: directory ? { kind: "mounted", paths: [directory] } : { kind: "unmounted" },
    canEject: true,
  };
}
function ready(
  volumes: readonly StorageVolume[],
  revision = 1,
  operation: StorageOperation = { kind: "idle" },
  policy: "readonly" | "interactive" = "interactive",
  owner = ":1.123",
): StorageClientState {
  return {
    kind: "ready",
    owner,
    snapshot: { revision, status: { kind: "ready", policy, volumes }, operation },
  };
}
class PrivateStorage implements StorageClient {
  listeners = new Set<(state: StorageClientState) => void>();
  calls: Array<{ action: DriveAction; request: StorageActionRequest }> = [];
  fail: StorageControlError | null = null;
  refreshes = 0;
  disposed = false;
  constructor(public state: StorageClientState) {}
  subscribe(listener: (state: StorageClientState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(state: StorageClientState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  private async action(action: DriveAction, request: StorageActionRequest): Promise<void> {
    this.calls.push({ action, request });
    if (this.fail) throw this.fail;
  }
  mount(request: StorageActionRequest) {
    return this.action("mount", request);
  }
  unmount(request: StorageActionRequest) {
    return this.action("unmount", request);
  }
  eject(request: StorageActionRequest) {
    return this.action("eject", request);
  }
  async refresh() {
    this.refreshes++;
  }
  async dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}

function controllerChecks() {
  return (async () => {
    const client = new PrivateStorage(ready([volume()]));
    const opened: string[] = [],
      lost: string[][] = [];
    let busy = false;
    const controller = new RemovableDriveController(
      client,
      (_, directory) => opened.push(directory),
      (roots) => lost.push([...roots]),
      () => busy,
    );
    const navigation = {
      tabId: "test",
      navigation: createFolderTab("test", "/home/private").navigation,
    };
    await controller.activate(id, navigation, { owner: ":1.123", revision: 1, id });
    assert.deepEqual(client.calls, [
      { action: "mount", request: { owner: ":1.123", revision: 1, id } },
    ]);
    assert.deepEqual(opened, [], "a resolved RPC is not a mounted path witness");
    client.publish(ready([volume("/fixture/mount")], 2, { kind: "pending", id, action: "mount" }));
    assert.deepEqual(opened, [], "pending presentation never opens a path");
    client.publish(ready([volume("/fixture/mount")], 3));
    assert.deepEqual(opened, ["/fixture/mount"]);
    client.publish(ready([volume("/fixture/mount")], 4));
    assert.equal(opened.length, 1, "one intent opens only once");
    await controller.action(id, "unmount", false, { owner: ":1.123", revision: 1, id });
    assert.equal(client.calls.length, 1, "stale visible revision cannot mutate newer status");
    assert.match(controller.error, /status changed/);
    client.publish({ kind: "unavailable", message: "Service owner disappeared" });
    assert.deepEqual(lost, [["/fixture/mount"]]);
    client.publish(ready([volume()], 5));
    await controller.activate(id, navigation);
    client.publish(ready([], 6));
    client.publish(ready([volume("/fixture/late")], 7));
    assert.equal(opened.length, 1, "withdrawn device invalidates delayed mount intent");
    client.publish(ready([volume()], 8));
    await controller.activate(id, navigation);
    client.publish(
      ready([volume("/fixture/new-owner")], 9, { kind: "idle" }, "interactive", ":1.124"),
    );
    assert.equal(opened.length, 1, "old owner's intent never opens new owner's path");
    client.publish(
      ready([volume(), volume(undefined, otherId)], 10, {
        kind: "unknown",
        id,
        action: "mount",
        code: "unknown",
        message: "Outcome is unknown",
      }),
    );
    assert.equal(canDriveAction(client.state, id, "mount"), false);
    assert.equal(
      canDriveAction(client.state, otherId, "mount"),
      true,
      "unknown outcome only blocks its affected identity",
    );
    assert.equal(storageCaption(client.state), "Outcome is unknown");
    const count = client.calls.length;
    await controller.activate(id, navigation);
    assert.equal(client.calls.length, count);
    client.publish(ready([volume()], 11, { kind: "idle" }, "readonly"));
    await controller.activate(id, navigation);
    assert.equal(client.calls.length, count, "read-only unmounted rows cannot dispatch");
    client.publish(ready([volume("/fixture/read-only")], 12, { kind: "idle" }, "readonly"));
    await controller.activate(id, navigation);
    assert.equal(
      opened.at(-1),
      "/fixture/read-only",
      "already mounted read-only drive can be browsed",
    );
    client.publish(ready([volume()], 13));
    client.fail = new StorageControlError(
      "permission",
      "Permission to control this drive was denied",
    );
    await controller.activate(id, navigation);
    assert.match(controller.error, /permission/i);
    client.fail = null;
    client.publish(ready([volume("/fixture/after-error")], 14));
    assert.equal(opened.at(-1), "/fixture/read-only", "a rejected request cannot later navigate");
    busy = true;
    await controller.action(id, "eject");
    assert.equal(client.calls.length, count + 1, "file transfer busy state blocks drive mutation");
    busy = false;
    client.publish(ready([volume()], 15));
    await controller.activate(id, navigation);
    controller.cancelNavigation();
    client.publish(ready([volume("/fixture/cancelled")], 16));
    assert.equal(
      opened.at(-1),
      "/fixture/read-only",
      "explicit tab switch retires the intent permanently",
    );
    controller.dispose();
    controller.dispose();
    assert.equal(client.listeners.size, 0);
    client.publish(ready([], 17));
    assert.equal(lost.at(-1)?.[0], "/fixture/after-error");
    assert.equal(client.disposed, false, "injected transport stays caller-owned");

    const home = "/fixture/home",
      mount = "/fixture/drive";
    let tab = navigateFolderTab(createFolderTab("a", home), path.join(mount, "child"));
    tab = navigateFolderTab(tab, "/fixture/outside");
    const retired = retireDrivePaths(tab, [mount], home);
    assert.deepEqual(retired.navigation.paths, [home, "/fixture/outside"]);
    assert.equal(tabDirectory(retired), "/fixture/outside");
    assert.equal(tabDirectory(retireDrivePaths(createFolderTab("a", mount), [mount], home)), home);
    assert.equal(
      tabDirectory(retireDrivePaths(createFolderTab("a", mount), ["/fixture"], home)),
      "/",
    );
    assert.equal(
      tabDirectory(retireDrivePaths(createFolderTab("a", mount), ["/"], home)),
      mount,
      "no invented accessible root when all paths unavailable",
    );
    assert.equal(isWithinMount("/fixture/drive-else", mount), false);
    console.log(
      "[files/drives] observed-only mount, revisions, disappearance, owner loss, readonly, errors, unknown-ID gate, busy, disposal and history passed",
    );
  })();
}

await controllerChecks();
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-drives-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
process.env.XDG_DATA_HOME = path.join(fixture, ".data");
const output = process.env.MOIRE_DRIVES_CAPTURE;
try {
  await installUiFonts();
  const source = path.join(fixture, "starting-folder"),
    mounted = path.join(fixture, "mounted-folder");
  await fs.mkdir(source);
  await fs.mkdir(mounted);
  await fs.writeFile(path.join(source, "initial.txt"), "private initial data");
  await fs.writeFile(path.join(mounted, "mounted.txt"), "private drive data");
  const config = path.join(fixture, ".config/moire");
  await fs.mkdir(config, { recursive: true });
  const favoritesPath = path.join(config, "files-places.json");
  const favorites = JSON.stringify({
    version: 1,
    favorites: [{ label: "Preserved favorite", path: mounted }],
  });
  await fs.writeFile(favoritesPath, favorites);
  if (output) await fs.mkdir(output, { recursive: true });
  for (const scheme of ["light", "dark"] as const)
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const backend = new HeadlessPlatform();
      await backend.connect();
      const window = new Window({
        title: "Private removable drives",
        width: 1280,
        height: 900,
        decorated: false,
      });
      const client = new PrivateStorage(ready([volume()]));
      let title = "",
        actions: ContextMenuAction[] = [],
        statusChanges = 0;
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", {
          themeFamily: "moire",
          colorScheme: scheme,
          reducedMotion: true,
        }),
      );
      window.setContent((size) => (
        <WidgetThemeProvider theme={theme}>
          <FilesApp
            {...size}
            initialPath={source}
            windowActions={window}
            onQuit={() => {}}
            storageClient={client}
            onStorageChange={() => {
              statusChanges++;
            }}
            onShowContextMenu={(request) => {
              title = request.title;
              actions = request.actions;
              return true;
            }}
          />
        </WidgetThemeProvider>
      ));
      window.mount(backend);
      const native = backend.getWindows()[0];
      assert.ok(native);
      const settle = async () => {
        for (let step = 0; step < 10; step++) {
          await new Promise((done) => setTimeout(done, 10));
          window.tick();
        }
      };
      const key = (code: number, key: string, ctrl = false, alt = false) => {
        const modifiers = { ctrl, alt, shift: false, meta: false };
        native.injectKey({ type: "down", code, key, modifiers, timeMs: Date.now() });
        native.injectKey({ type: "up", code, key, modifiers, timeMs: Date.now() });
        window.tick();
      };
      const context = () => {
        key(139, "ContextMenu");
        return title;
      };
      const waitFolder = async (name: string) => {
        for (let index = 0; index < 50; index++) {
          await settle();
          if (
            context() === name &&
            actions.some((action) => action.id.endsWith("select-all") && !action.disabled)
          )
            return;
        }
        assert.fail(`Expected ${name}; received ${title}`);
      };
      // Search actual dispatched sidebar context targets, rather than assume a row's screen Y.
      const drivePoint = async () => {
        await settle();
        for (let y = 100; y < 850; y += 12) {
          title = "";
          native.injectPointer({ type: "down", button: "right", x: 85, y, timeMs: Date.now() });
          window.tick();
          if (title === volume().label && actions.some((action) => action.id === "drive-open"))
            return { x: 85, y };
        }
        assert.fail("Actual Files sidebar did not expose the live drive row");
      };
      const click = (point: { x: number; y: number }) => {
        native.injectPointer({ type: "down", button: "left", ...point, timeMs: Date.now() });
        native.injectPointer({ type: "up", button: "left", ...point, timeMs: Date.now() });
        window.tick();
      };
      const capture = async (name: string) => {
        if (!output) return;
        assert.ok(native.lastFrame);
        const png = new PNG({ width: window.getWidth(), height: window.getHeight() });
        for (let i = 0; i < native.lastFrame.length; i += 4) {
          png.data[i] = native.lastFrame[i + 2]!;
          png.data[i + 1] = native.lastFrame[i + 1]!;
          png.data[i + 2] = native.lastFrame[i]!;
          png.data[i + 3] = native.lastFrame[i + 3]!;
        }
        await fs.writeFile(
          path.join(output, `${scheme}-${scale}-${name}.png`),
          PNG.sync.write(png),
        );
      };
      try {
        await waitFolder("starting-folder");
        const point = await drivePoint();
        assert.equal(actions.find((action) => action.id === "drive-unmount")?.disabled, true);
        click(point);
        await settle();
        assert.deepEqual(client.calls, [
          { action: "mount", request: { owner: ":1.123", revision: 1, id } },
        ]);
        assert.equal(context(), "starting-folder", "mount RPC alone preserves directory");
        client.publish(ready([volume()], 2, { kind: "pending", id, action: "mount" }));
        await settle();
        assert.equal(context(), "starting-folder");
        client.publish(ready([volume(mounted)], 3));
        await waitFolder("mounted-folder");
        await capture("mounted");
        await drivePoint();
        assert.equal(actions.find((action) => action.id === "drive-unmount")?.disabled, false);
        actions.find((action) => action.id === "drive-unmount")?.onPress?.();
        await settle();
        assert.equal(client.calls.at(-1)?.action, "unmount");
        assert.equal(context(), "mounted-folder", "request doesn't fabricate an unmounted view");
        key(20, "t", true);
        await settle(); // two tabs underneath the same real mount
        client.publish(ready([], 4));
        await waitFolder(path.basename(fixture));
        key(105, "ArrowLeft", false, true);
        await settle();
        assert.equal(
          context(),
          path.basename(fixture),
          "withdrawn mount cannot be resurrected by Back",
        );
        assert.equal(await fs.readFile(favoritesPath, "utf8"), favorites);
        assert.equal(
          await fs.readFile(path.join(mounted, "mounted.txt"), "utf8"),
          "private drive data",
        );
        await capture("withdrawn");
        key(15, "Tab", true);
        await settle();
        assert.equal(context(), path.basename(fixture), "withdrawal also retires the other tab");
        key(15, "Tab", true);

        // Request in one tab, navigate it elsewhere, then receive a late mounted observation.
        client.publish(ready([volume()], 5));
        click(await drivePoint());
        await settle();
        key(15, "Tab", true);
        key(15, "Tab", true); // switch away and back before completion
        client.publish(ready([volume(mounted)], 6));
        await settle();
        assert.equal(
          context(),
          path.basename(fixture),
          "tab switch/back permanently retires mount navigation",
        );
        client.publish(ready([volume()], 7));
        click(await drivePoint());
        await settle();
        key(38, "l", true); // actual PathBar selection entry
        key(30, "a", true);
        for (const text of source) {
          const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
          native.injectKey({
            type: "down",
            code: 20,
            key: text,
            text,
            modifiers,
            timeMs: Date.now(),
          });
          native.injectKey({ type: "up", code: 20, key: text, modifiers, timeMs: Date.now() });
        }
        key(28, "Enter");
        await waitFolder("starting-folder");
        client.publish(ready([volume(mounted)], 8));
        await settle();
        assert.equal(
          context(),
          "starting-folder",
          "late mount never overrides intervening navigation",
        );
        client.publish(ready([volume(mounted)], 9, { kind: "idle" }, "readonly"));
        const mountedPoint = await drivePoint();
        assert.equal(actions.find((action) => action.id === "drive-unmount")?.disabled, true);
        click(mountedPoint);
        await waitFolder("mounted-folder");
        client.publish({ kind: "unavailable", message: "Service disconnected" });
        await waitFolder(path.basename(fixture));
        assert.ok(statusChanges >= 7, "storage changes retire caller-owned native menus");
        if (scheme === "light" && scale === 1) {
          client.publish(ready([], 10));
          await settle();
          const before = client.refreshes;
          for (
            let y = 900 - 30 * scale - 40;
            y < 900 - 30 * scale && client.refreshes === before;
            y += 6
          )
            for (let x = 12; x < 245 && client.refreshes === before; x += 8) click({ x, y });
          await settle();
          assert.equal(
            client.refreshes,
            before + 1,
            "empty Drives section has a reachable refresh action",
          );
        }
        window.destroy();
        assert.equal(client.listeners.size, 0, "Window teardown unsubscribes its drive observer");
        assert.equal(client.disposed, false);
        console.log(
          `[files/drives/window] ${scheme}/${scale} real sidebar pointer, observed mount, menu unmount, two-tab loss/history, intervening navigation, readonly and owner loss passed`,
        );
      } finally {
        window.destroy();
        backend.disconnect();
      }
    }
  for (const scale of [1, 1.5]) {
    setUiScaleFactor(scale);
    const backend = new HeadlessPlatform();
    await backend.connect();
    const window = new Window({ title: "Compact drive row", width: 240, height: 80 });
    let opened = 0,
      menus = 0;
    const theme = createPersonalizedWidgetTheme(
      discoverPersonalization("linux", {
        themeFamily: "moire",
        colorScheme: "dark",
        reducedMotion: true,
      }),
    );
    window.setContent(() => (
      <WidgetThemeProvider theme={theme}>
        <RemovableDriveRow
          width={240}
          height={40}
          volume={volume(mounted)}
          state={ready([volume(mounted)])}
          selected={false}
          busy={false}
          onActivate={() => {
            opened++;
          }}
          onActions={() => {
            menus++;
          }}
        />
      </WidgetThemeProvider>
    ));
    window.mount(backend);
    await Promise.resolve();
    window.tick();
    const native = backend.getWindows()[0];
    assert.ok(native);
    const send = (code: number, key: string) => {
      const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
      native.injectKey({ type: "down", code, key, modifiers, timeMs: 1 });
      native.injectKey({ type: "up", code, key, modifiers, timeMs: 2 });
      window.tick();
    };
    try {
      assert.ok(native.lastFrame);
      const empty = native.lastFrame.slice(60 * 240 * 4, 60 * 240 * 4 + 4);
      for (let y = 40; y < 80; y++)
        for (let x = 0; x < 240; x++) {
          const offset = (y * 240 + x) * 4;
          assert.deepEqual(
            native.lastFrame.slice(offset, offset + 4),
            empty,
            "both measured row text lines remain inside40px at each scale",
          );
        }
      send(15, "Tab");
      send(28, "Enter");
      assert.equal(opened, 1, "compact row keyboard activation opens once");
      send(15, "Tab");
      send(28, "Enter");
      assert.equal(menus, 1, "separate compact drive action is keyboard reachable");
      native.injectPointer({ type: "down", button: "left", x: 224, y: 20, timeMs: 3 });
      native.injectPointer({ type: "up", button: "left", x: 224, y: 20, timeMs: 4 });
      window.tick();
      assert.equal(menus, 2, "compact action hit remains inside allocated row");
      assert.ok(native.lastFrame?.some((byte) => byte !== 0));
      console.log(
        `[files/drives/compact] ${scale} long-label row keyboard + separate pointer action passed`,
      );
    } finally {
      window.destroy();
      backend.disconnect();
    }
  }
} finally {
  setUiScaleFactor(1);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}
