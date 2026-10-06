/** Device-free Linux reproduction: real pipe -> evdev -> Wayland -> Window -> SHM/frame ack.
 * Only device capabilities and physical output presentation are substituted.
 * The fixture uses public text, no greetd/PAM, seat, GPU or credential tracing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import React from "react";
import { Application, Window } from "@moire/ui";
import {
  closeFd,
  createPipe,
  createXkbKeymapMemfd,
  EvdevKeyboard,
  LinuxReadinessDispatcher,
  WaylandSocketServer,
  type WaylandClientConn,
} from "@moire/sys";
import { RetainedSceneRenderer, RetainedSoftwareRenderer, type SceneNode } from "@moire/react-host";
// oxlint-disable-next-line import/no-relative-parent-imports -- Exercise the real compositor wire session.
import { CompositorServer, ClientSession } from "../src/server";
// oxlint-disable-next-line import/no-relative-parent-imports -- Use the production shell without adding a runtime core dependency.
import { createShell } from "../../shell/src/controller";
// oxlint-disable-next-line import/no-relative-parent-imports -- This Linux fixture uses the actual Files view.
import { FilesApp } from "../../../apps/bundled/files/src/main";
// oxlint-disable-next-line import/no-relative-parent-imports -- Observe the actual native platform boundary.
import { WaylandPlatform } from "../../ui/src/platforms/wayland/index";

assert.equal(process.platform, "linux", "Real Linux pipe, recvmsg, memfd and epoll are required");
assert.notEqual(process.getuid?.(), 0, "The device-free fixture also runs as an ordinary user");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-files-interaction-"));
const previousRuntime = process.env.XDG_RUNTIME_DIR;
const previousDisplay = process.env.WAYLAND_DISPLAY;
const previousConfig = process.env.XDG_CONFIG_HOME;
process.env.XDG_RUNTIME_DIR = directory;
process.env.XDG_CONFIG_HOME = directory;
process.env.WAYLAND_DISPLAY = "liveness";
const map = createXkbKeymapMemfd();
const stats = {
  reads: 0,
  keys: 0,
  frames: 0,
  callbacks: 0,
  sourceMatchesDirectory: false,
  outputMatchesDirectory: false,
  focusedAltUpDelivered: false,
  directoryActionApplied: false,
};
const rootDirectory = path.join(directory, "root");
const childDirectory = path.join(rootDirectory, "Child");
fs.mkdirSync(childDirectory, { recursive: true });
fs.writeFileSync(path.join(rootDirectory, "visible-after-up.txt"), "Public test content");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function deadline(promise: Promise<void>, stage: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage}: ${JSON.stringify(stats)}`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const mapped = deferred();
const navigated = deferred();
let directoryPixels: string | undefined;
let lastPixels = "";
let connection: WaylandClientConn | undefined;
let connectionClosed: Promise<void> | undefined;
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
const fullRaster = RetainedSoftwareRenderer.prototype.render;
function fullPixels(frame: Parameters<RetainedSoftwareRenderer["render"]>[0]) {
  return sha(
    fullRaster.call(new RetainedSoftwareRenderer(), {
      ...frame,
      damage: undefined,
    }).pixels,
  );
}
const scene = RetainedSceneRenderer.prototype.render;
const presentation = RetainedSceneRenderer.prototype.renderPresentation;
RetainedSceneRenderer.prototype.render = function (root, viewport) {
  const frame = scene.call(this, root, viewport);
  if (nodes(root).some((node) => node.text === "visible-after-up.txt")) {
    stats.directoryActionApplied = true;
    directoryPixels = fullPixels(frame);
  }
  return frame;
};
RetainedSceneRenderer.prototype.renderPresentation = function (root, viewport) {
  const frame = presentation.call(this, root, viewport);
  if (frame && nodes(root).some((node) => node.text === "visible-after-up.txt")) {
    stats.directoryActionApplied = true;
    directoryPixels = fullPixels(frame);
  }
  return frame;
};

class OutputBoundary extends CompositorServer {
  session: ClientSession | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  private pixels: Uint8Array | undefined;
  override getKmsSize() {
    return { width: 1280, height: 800 };
  }
  override getKeymap() {
    return map;
  }
  override markDirty() {
    if (this.timer) return;
    // Keep a frame pending across several input packets, as a busy output does.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const surface of this.session?.surfaces() ?? []) {
        if (!surface.mapped || !surface.content) continue;
        stats.frames++;
        const content = surface.content;
        this.pixels ??= new Uint8Array(content.pixels.length);
        // Honor the retained compositor's source-damage contract. A copied
        // SHM source is not proof that changed pixels reached the output.
        for (const rect of surface.damage) {
          const left = Math.max(0, Math.floor(rect.x));
          const top = Math.max(0, Math.floor(rect.y));
          const right = Math.min(content.width, Math.ceil(rect.x + rect.width));
          const bottom = Math.min(content.height, Math.ceil(rect.y + rect.height));
          for (let row = top; row < bottom; row++) {
            const start = row * content.stride + left * 4;
            this.pixels.set(
              content.pixels.subarray(start, row * content.stride + right * 4),
              start,
            );
          }
        }
        lastPixels = sha(this.pixels);
        stats.sourceMatchesDirectory ||= sha(content.pixels) === directoryPixels;
        stats.outputMatchesDirectory ||= lastPixels === directoryPixels;
        stats.callbacks += surface.frameCallbacks.length;
        this.session?.finishSurfaceFrame(surface);
        mapped.resolve();
        if (lastPixels === directoryPixels) navigated.resolve();
      }
    }, 100);
  }
  activate(keyboard: EvdevKeyboard) {
    this.startKeyboardInput(keyboard);
  }
}
const server = new OutputBoundary(directory, "liveness", {
  mode: "desktop",
  devices: {
    open() {
      throw new Error("No devices in liveness reproduction");
    },
    close() {},
  },
});
const shell = createShell(() => ({}));
shell.setPrimaryOutput({ x: 0, y: 0, width: 1280, height: 800 });
server.setShell(shell);
const originalCreateWindow = WaylandPlatform.prototype.createWindow;
WaylandPlatform.prototype.createWindow = function (options) {
  const target = originalCreateWindow.call(this, options);
  target.onKey((event) => {
    if (event.code === 103 && event.type === "down") {
      stats.focusedAltUpDelivered = event.key === "ArrowUp" && event.modifiers.alt;
      console.log(
        JSON.stringify({
          stage: "native-client-key",
          code: event.code,
          key: event.key,
          modifiers: event.modifiers,
        }),
      );
    }
  });
  return target;
};
const socket = new WaylandSocketServer(path.join(directory, "liveness"));
socket.on("connection", (conn: WaylandClientConn) => {
  assert.equal(connection, undefined);
  connection = conn;
  connectionClosed = new Promise<void>((resolve) => conn.once("close", resolve));
  server.session = new ClientSession(server, conn, 1);
});
const readiness = new LinuxReadinessDispatcher("login-liveness-input");
const [readFd, writeFd] = createPipe(0x800 | 0x80000);
const unused = () => {
  throw new Error("Fixture must not acquire native input capabilities");
};
const io: NonNullable<ConstructorParameters<typeof EvdevKeyboard>[1]> = {
  open: () => readFd,
  identity: () => "owned-pipe",
  close: closeFd,
  read(fd, bytes) {
    stats.reads++;
    return fs.readSync(fd, bytes, 0, bytes.length, null);
  },
  keyBits: unused,
  eventBits: unused,
  heldKeyBits: unused,
  grab: unused,
};
class PipeKeyboard extends EvdevKeyboard {
  override start() {
    super.start(["owned-pipe"], { exclusive: false });
  }
}
const keyboard = new PipeKeyboard(readiness, io);
keyboard.on("key", () => {
  stats.keys++;
});
const app = new Application({
  platform: "wayland",
  personalization: {
    source: "application",
    themeFamily: "moire",
    colorScheme: "dark",
    reducedMotion: true,
  },
});
const window = new Window({
  width: 1020,
  height: 600,
  decorated: false,
  title: "Native Files interaction",
});
window.setContent((size) => <FilesApp {...size} initialPath={childDirectory} onQuit={() => {}} />);
app.addWindow(window);
let run: Promise<void> | undefined;
try {
  socket.start();
  server.activate(keyboard);
  run = app.run();
  await deadline(mapped.promise, "initial native mapping");
  const before = lastPixels;
  const edges = [
    [56, 1],
    [103, 1],
    [103, 0],
    [56, 0],
  ] as const;
  // Deliver actual evdev records through the pipe reader.
  const bytes = Buffer.alloc(edges.length * 24);
  let index = 0;
  for (const [code, state] of edges) {
    const at = index++ * 24;
    bytes.writeBigInt64LE(1n, at);
    bytes.writeBigInt64LE(BigInt(index * 1000), at + 8);
    bytes.writeUInt16LE(1, at + 16);
    bytes.writeUInt16LE(code, at + 18);
    bytes.writeInt32LE(state, at + 20);
  }
  assert.equal(fs.writeSync(writeFd, bytes), bytes.length);
  await deadline(navigated.promise, "Alt+Up dispatch and visible parent directory");
  assert.equal(stats.focusedAltUpDelivered, true);
  assert.equal(stats.directoryActionApplied, true);
  assert.equal(stats.sourceMatchesDirectory, true);
  assert.equal(stats.outputMatchesDirectory, true);
  assert.notEqual(lastPixels, before);
  console.log(
    JSON.stringify({
      suite: "native Files interaction",
      ...stats,
      deviceAccess: 0,
      nativeTransport: true,
      physicalPresentation: false,
      actualExitCode: 0,
      actualUid: process.getuid?.(),
    }),
  );
} finally {
  app.quit();
  window.destroy();
  if (run) await run;
  if (server.timer) clearTimeout(server.timer);
  server.stop();
  connection?.close();
  if (connectionClosed) await connectionClosed;
  socket.stop();
  readiness.stop();
  closeFd(writeFd);
  closeFd(map.fd);
  // Socket close listeners retire their own shared-pump registrations on the
  // following loop turn. Drain that teardown before propagating assertions.
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  WaylandPlatform.prototype.createWindow = originalCreateWindow;
  RetainedSceneRenderer.prototype.render = scene;
  RetainedSceneRenderer.prototype.renderPresentation = presentation;
  for (const [key, previous] of Object.entries({
    XDG_RUNTIME_DIR: previousRuntime,
    WAYLAND_DISPLAY: previousDisplay,
    XDG_CONFIG_HOME: previousConfig,
  })) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
