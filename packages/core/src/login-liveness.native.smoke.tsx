/** Device-free Linux reproduction: real pipe -> evdev -> Wayland -> Window -> SHM/frame ack.
 * Only device capabilities and physical output presentation are substituted.
 * The fixture uses public text, no greetd/PAM, seat, GPU or credential tracing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import React, { useState } from "react";
import { Application, Window, Surface, TextField, Label } from "@moire/ui";
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
import { CompositorServer, ClientSession } from "./server";

assert.equal(process.platform, "linux", "Real Linux pipe, recvmsg, memfd and epoll are required");
assert.notEqual(process.getuid?.(), 0, "The device-free fixture also runs as an ordinary user");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-login-liveness-"));
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
  changes: 0,
  frames: 0,
  callbacks: 0,
  submitted: "",
  sourceMatchesPrompt: false,
  outputMatchesPrompt: false,
  asynchronousRedraw: false,
};
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
        timer = setTimeout(() => reject(new Error(`${stage}: ${JSON.stringify(stats)}`)), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const mapped = deferred();
const submitted = deferred();
const prompted = deferred();
const asynchronousPrompted = deferred();
let asynchronousPrompt = false;
let asynchronousPixels: string | undefined;
let promptPixels: string | undefined;
let value = "";
let lastPixels = "";
let connection: WaylandClientConn | undefined;
let connectionClosed: Promise<void> | undefined;
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
const fullRaster = RetainedSoftwareRenderer.prototype.render;
function fullPixels(frame: Parameters<RetainedSoftwareRenderer["render"]>[0]) {
  return sha(
    fullRaster.call(new RetainedSoftwareRenderer(), { ...frame, damage: undefined }).pixels,
  );
}
const scene = RetainedSceneRenderer.prototype.render;
const presentation = RetainedSceneRenderer.prototype.renderPresentation;
RetainedSceneRenderer.prototype.render = function (root, viewport) {
  const frame = scene.call(this, root, viewport);
  if (nodes(root).some((node) => node.text === "Response prompt")) promptPixels = fullPixels(frame);
  if (nodes(root).some((node) => node.text === "Asynchronous response"))
    asynchronousPixels = fullPixels(frame);
  return frame;
};
RetainedSceneRenderer.prototype.renderPresentation = function (root, viewport) {
  const frame = presentation.call(this, root, viewport);
  if (frame && nodes(root).some((node) => node.text === "Response prompt"))
    promptPixels = fullPixels(frame);
  if (frame && nodes(root).some((node) => node.text === "Asynchronous response"))
    asynchronousPixels = fullPixels(frame);
  return frame;
};

class OutputBoundary extends CompositorServer {
  session: ClientSession | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  private pixels: Uint8Array | undefined;
  override getKmsSize() {
    return { width: 640, height: 420 };
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
        stats.sourceMatchesPrompt ||= sha(content.pixels) === promptPixels;
        stats.outputMatchesPrompt ||= lastPixels === promptPixels;
        stats.callbacks += surface.frameCallbacks.length;
        this.session?.finishSurfaceFrame(surface);
        mapped.resolve();
        if (lastPixels === promptPixels) prompted.resolve();
        if (lastPixels === asynchronousPixels) {
          stats.asynchronousRedraw = true;
          asynchronousPrompted.resolve();
        }
      }
    }, 100);
  }
  activate(keyboard: EvdevKeyboard) {
    this.startKeyboardInput(keyboard);
  }
}
const server = new OutputBoundary(directory, "liveness", {
  mode: "greeter",
  clientPid: process.pid,
  devices: {
    open() {
      throw new Error("No devices in liveness reproduction");
    },
    close() {},
  },
});
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
  width: 640,
  height: 420,
  decorated: false,
  title: "Liveness fixture",
});
function Fixture() {
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState(false);
  return (
    <Surface width={640} height={420}>
      <TextField
        width={500}
        height={40}
        autoFocus
        value={draft}
        onChange={(next) => {
          value = next;
          stats.changes++;
          setDraft(next);
        }}
        onSubmit={(next) => {
          stats.submitted = next;
          submitted.resolve();
          // Authentication replies update the view without a following input event.
          queueMicrotask(() => {
            setPrompt(true);
          });
        }}
      />
      <Label
        y={70}
        text={
          asynchronousPrompt ? "Asynchronous response" : prompt ? "Response prompt" : "Username"
        }
      />
    </Surface>
  );
}
window.setContent(() => <Fixture />);
app.addWindow(window);
let run: Promise<void> | undefined;
try {
  socket.start();
  server.activate(keyboard);
  run = app.run();
  await deadline(mapped.promise, "initial native mapping");
  const before = lastPixels;
  const codes = [50, 24, 23, 19, 18, 12, 25, 30, 50, 12, 20, 18, 31, 20, 28];
  // A real evdev batch is larger than the reader's eight-event scratch buffer.
  const bytes = Buffer.alloc(codes.length * 2 * 24);
  let index = 0;
  for (const code of codes)
    for (const state of [1, 0]) {
      const at = index++ * 24;
      bytes.writeBigInt64LE(1n, at);
      bytes.writeBigInt64LE(BigInt(index * 1000), at + 8);
      bytes.writeUInt16LE(1, at + 16);
      bytes.writeUInt16LE(code, at + 18);
      bytes.writeInt32LE(state, at + 20);
    }
  assert.equal(fs.writeSync(writeFd, bytes), bytes.length);
  await deadline(submitted.promise, "input dispatch and submission");
  assert.equal(value, "moire-pam-test");
  assert.equal(stats.submitted, value);
  assert.equal(stats.keys, codes.length * 2);
  await deadline(prompted.promise, "latest prompt SHM commit and frame acknowledgment");
  assert.notEqual(lastPixels, before);
  // The native greeter reads a controller snapshot during reconciliation and
  // requests redraw after an external asynchronous reply, without React state.
  setTimeout(() => {
    asynchronousPrompt = true;
    window.requestRedraw();
  }, 150);
  await deadline(asynchronousPrompted.promise, "external asynchronous controller redraw");
  console.log(
    JSON.stringify({
      suite: "native login liveness",
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
