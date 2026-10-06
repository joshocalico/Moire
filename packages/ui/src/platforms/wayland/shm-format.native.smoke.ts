import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createElement } from "react";
import {
  Rect,
  createShellRoot,
  renderShell,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
  type RetainedSceneFrame,
} from "@moire/react-host";
import {
  MessageBuilder,
  MessageReader,
  decodeHeader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import {
  wlBuffer,
  wlCallback,
  wlCompositor,
  wlShm,
  wlShmPool,
  wlSurface,
  xdgSurface,
} from "@moire/protocol/generated";
import type { PlatformWindowOpts } from "#ui/platform";
import { Window } from "#ui/window";
import { WaylandPlatform, WaylandWindow } from "./index";
import { classifyShmFrame } from "./shm-format";

assert.equal(
  process.platform,
  "linux",
  "This test uses real Linux memfd/mmap; no display or devices",
);
type WireBuffer = Readonly<{
  id: number;
  pool: number;
  width: number;
  height: number;
  stride: number;
  format: number;
}>;

/** Only the socket/compositor is replaced. All SHM allocations, copies, roles,
 * commits, wl_buffer recreation and release handlers are production code. */
class RecordedWindow extends WaylandWindow {
  readonly scenes: RetainedSceneFrame[] = [];
  override presentScene(scene: RetainedSceneFrame): boolean {
    this.scenes.push(scene);
    return super.presentScene(scene);
  }
}
class ShmWirePlatform extends WaylandPlatform {
  readonly messages: EncodedWaylandMessage[] = [];
  readonly handlersForTest = new Map<number, Parameters<WaylandPlatform["setHandler"]>[1]>();
  readonly pools = new Map<number, { fd: number; size: number }>();
  readonly buffers = new Map<number, WireBuffer>();
  readonly destroyed = new Set<number>();
  readonly surfaces = new Set<number>();
  readonly attachments: Array<{
    buffer: WireBuffer;
    pixelsSha256: string;
    opaquePixels: number;
    translucentPixels: number;
  }> = [];
  readonly nativeWindows: RecordedWindow[] = [];
  override async connect(): Promise<void> {
    throw new Error("No display/socket in native SHM fixture");
  }
  override getCompositorId(): number {
    return 100;
  }
  override getWmBaseId(): number {
    return 101;
  }
  override getShmId(): number {
    return 102;
  }
  override getDecoManagerId(): number {
    return 0;
  }
  override createWindow(opts: PlatformWindowOpts): WaylandWindow {
    const window = new RecordedWindow(this, opts);
    window.create();
    window.setPresentationMode("shm");
    this.nativeWindows.push(window);
    return window;
  }
  override renderClientFrame(): never {
    throw new Error("SHM proof must not call an EGL upload/readback API");
  }
  override renderClientComposition(): never {
    throw new Error("SHM proof must not call an EGL composition/readback API");
  }
  override sendMessage(message: EncodedWaylandMessage, fds: number[] = []): void {
    assert.equal(fds.length, 0);
    this.messages.push(message);
    const { objectId, opcode } = decodeHeader(message.data);
    const reader = new MessageReader(message.data, message.fds);
    if (objectId === 100 && opcode === wlCompositor.requests.createSurface.opcode) {
      this.surfaces.add(reader.newId());
    } else if (objectId === 102 && opcode === wlShm.requests.createPool.opcode) {
      const pool = reader.newId();
      this.pools.set(pool, { fd: reader.fd(), size: reader.int() });
    } else if (this.pools.has(objectId) && opcode === wlShmPool.requests.createBuffer.opcode) {
      const id = reader.newId();
      assert.equal(reader.int(), 0);
      this.buffers.set(
        id,
        Object.freeze({
          id,
          pool: objectId,
          width: reader.int(),
          height: reader.int(),
          stride: reader.int(),
          format: reader.uint(),
        }),
      );
    } else if (this.buffers.has(objectId) && opcode === wlBuffer.requests.destroy.opcode) {
      this.destroyed.add(objectId);
    } else if (this.surfaces.has(objectId) && opcode === wlSurface.requests.attach.opcode) {
      const buffer = this.buffers.get(reader.object());
      assert.ok(buffer);
      const data = this.pixels(buffer);
      let opaquePixels = 0;
      for (let alpha = 3; alpha < data.length; alpha += 4) if (data[alpha] === 255) opaquePixels++;
      this.attachments.push({
        buffer,
        pixelsSha256: createHash("sha256").update(data).digest("hex"),
        opaquePixels,
        translucentPixels: buffer.width * buffer.height - opaquePixels,
      });
    }
  }
  override setHandler(id: number, handler: Parameters<WaylandPlatform["setHandler"]>[1]): void {
    this.handlersForTest.set(id, handler);
  }
  override clearHandler(id: number): void {
    this.handlersForTest.delete(id);
  }
  requests(id: number, opcode: number): EncodedWaylandMessage[] {
    return this.messages.filter((message) => {
      const h = decodeHeader(message.data);
      return h.objectId === id && h.opcode === opcode;
    });
  }
  request(id: number, opcode: number): EncodedWaylandMessage {
    const message = this.requests(id, opcode).at(-1);
    assert.ok(message);
    return message;
  }
  dispatch(id: number, opcode: number, builder = new MessageBuilder()): void {
    const handler = this.handlersForTest.get(id);
    assert.ok(handler);
    const message = builder.build(id, opcode);
    handler(opcode, new MessageReader(message.data, []));
  }
  configure(window: WaylandWindow): void {
    const id = window.getXdgSurfaceId();
    this.dispatch(id, xdgSurface.events.configure.opcode, new MessageBuilder().uint(1));
    assert.ok(window);
  }
  frameDone(surface: number): void {
    const callback = new MessageReader(
      this.request(surface, wlSurface.requests.frame.opcode).data,
      [],
    ).newId();
    this.dispatch(callback, wlCallback.events.done.opcode, new MessageBuilder().uint(42));
  }
  surface(): number {
    return new MessageReader(
      this.request(100, wlCompositor.requests.createSurface.opcode).data,
      [],
    ).newId();
  }
  attached(surface: number): WireBuffer {
    const id = new MessageReader(
      this.request(surface, wlSurface.requests.attach.opcode).data,
      [],
    ).object();
    const buffer = this.buffers.get(id);
    assert.ok(buffer);
    return buffer;
  }
  pixels(buffer: WireBuffer): Uint8Array {
    const pool = this.pools.get(buffer.pool);
    assert.ok(pool);
    const bytes = Buffer.alloc(buffer.stride * buffer.height);
    assert.equal(fs.readSync(pool.fd, bytes, 0, bytes.length, 0), bytes.length);
    return new Uint8Array(bytes);
  }
  release(buffer: WireBuffer): void {
    this.dispatch(buffer.id, wlBuffer.events.release.opcode);
  }
}
const options = {
  title: "SHM opacity fixture",
  appId: "moire.shm-opacity-fixture",
  width: 3,
  height: 2,
  decorated: false,
};
function pixels(width: number, height: number, alpha = 255): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let at = 0; at < data.length; at += 4) data.set([at % 251, 47, 83, alpha], at);
  return data;
}
const platform = new ShmWirePlatform();
const window = platform.createWindow(options);
platform.configure(window);
const surface = platform.surface();
try {
  const opaque = pixels(3, 2);
  const transparent = opaque.slice();
  transparent[23] = 0;
  window.present(opaque, 3, 2);
  const first = platform.attached(surface);
  assert.equal(first.format, wlShm.enums.format.xrgb8888);
  assert.deepEqual(platform.pixels(first), opaque);
  const initialHandler = platform.handlersForTest.get(first.id);
  assert.ok(initialHandler);
  const gatedMessages = platform.messages.length;
  window.present(transparent, 3, 2);
  assert.equal(
    platform.messages.length,
    gatedMessages,
    "frame backpressure coalesces without copying/scanning or changing buffers",
  );
  assert.deepEqual(platform.pixels(first), opaque);
  platform.frameDone(surface);
  window.present(transparent, 3, 2, [{ x: 0, y: 0, width: 1, height: 1 }]);
  const second = platform.attached(surface);
  assert.equal(
    second.format,
    wlShm.enums.format.argb8888,
    "alpha outside damage still forces ARGB",
  );
  assert.notEqual(second.pool, first.pool, "busy memory cannot be repurposed");
  assert.deepEqual(
    platform.pixels(first),
    opaque,
    "producer's busy opaque pixels remain unchanged",
  );
  assert.deepEqual(platform.pixels(second), transparent);
  assert.ok(!platform.destroyed.has(first.id));
  platform.frameDone(surface);
  platform.release(first);
  window.present(opaque, 3, 2);
  assert.equal(platform.attached(surface).id, first.id, "same-size/format idle buffer is reused");
  assert.equal(platform.buffers.size, 2);
  platform.frameDone(surface);
  platform.release(first);
  window.present(transparent, 3, 2);
  const changed = platform.attached(surface);
  assert.notEqual(changed.id, first.id, "same geometry/changed format recreates actual wl_buffer");
  assert.equal(changed.pool, first.pool, "storage is reused after release");
  assert.equal(changed.format, wlShm.enums.format.argb8888);
  assert.equal(
    first.format,
    wlShm.enums.format.xrgb8888,
    "original protocol object's format stays immutable",
  );
  assert.ok(platform.destroyed.has(first.id));
  assert.ok(!platform.handlersForTest.has(first.id));
  assert.deepEqual(platform.pixels(changed), transparent);
  const changedHandler = platform.handlersForTest.get(changed.id);
  assert.ok(changedHandler);
  initialHandler(
    wlBuffer.events.release.opcode,
    new MessageReader(new MessageBuilder().build(first.id, 0).data, []),
  );
  platform.frameDone(surface);
  window.present(opaque, 3, 2);
  const third = platform.attached(surface);
  assert.notEqual(third.pool, changed.pool, "late old release cannot mark new busy buffer free");
  platform.frameDone(surface);
  platform.release(changed);
  window.present(pixels(4, 1), 4, 1);
  const resized = platform.attached(surface);
  assert.equal(resized.pool, first.pool);
  assert.equal(resized.width, 4);
  assert.equal(resized.height, 1);
  assert.equal(resized.stride, 16);
  assert.equal(resized.format, wlShm.enums.format.xrgb8888);
  assert.ok(platform.destroyed.has(changed.id));
  assert.deepEqual(platform.pixels(resized), pixels(4, 1));
  changedHandler(
    wlBuffer.events.release.opcode,
    new MessageReader(new MessageBuilder().build(changed.id, 0).data, []),
  );
  platform.frameDone(surface);
  window.present(pixels(4, 1, 127), 4, 1);
  const afterLateRelease = platform.attached(surface);
  assert.notEqual(
    afterLateRelease.pool,
    resized.pool,
    "queued release from a recreated buffer cannot free its newer busy replacement",
  );
  assert.deepEqual(platform.pixels(resized), pixels(4, 1));
  platform.frameDone(surface);
  platform.release(afterLateRelease);
  platform.release(resized);
  const beforeInvalid = platform.messages.length;
  for (const [data, width, height] of [
    [opaque.subarray(0, 23), 3, 2],
    [new Uint8Array(0), 0, 0],
    [opaque, 1.5, 4],
    [opaque, 0x20000000, 1],
  ] as const) {
    assert.throws(() => window.present(data, width, height), RangeError);
    assert.equal(
      platform.messages.length,
      beforeInvalid,
      "invalid frame sends no protocol mutation",
    );
  }
  window.present(pixels(5, 4, 254), 5, 4);
  const larger = platform.attached(surface);
  assert.notEqual(larger.pool, resized.pool, "larger frames allocate sufficient new storage");
  assert.equal(larger.format, wlShm.enums.format.argb8888);
  assert.deepEqual(platform.pixels(larger), pixels(5, 4, 254));
} finally {
  window.destroy();
}
assert.equal(platform.handlersForTest.size, 0);
for (const { fd } of platform.pools.values())
  assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });

// Public Window's actual React retained/software renderer feeds the same native SHM path.
const publicPlatform = new ShmWirePlatform();
const publicWindow = new Window({ ...options, width: 12, height: 8 });
try {
  publicWindow.setContent(
    createElement(Rect, { x: 0, y: 0, width: 12, height: 8, fill: 0xff112233 }),
  );
  publicWindow.mount(publicPlatform);
  const native = publicPlatform.nativeWindows[0];
  assert.ok(native);
  publicPlatform.configure(native);
  await new Promise<void>((resolve) => setImmediate(resolve));
  publicWindow.tick();
  const publicSurface = publicPlatform.surface();
  const opaque = publicPlatform.attached(publicSurface);
  assert.equal(opaque.format, wlShm.enums.format.xrgb8888);
  assert.ok(publicPlatform.pixels(opaque).every((byte, i) => i % 4 !== 3 || byte === 255));
  publicPlatform.frameDone(publicSurface);
  publicPlatform.release(opaque);
  publicWindow.setContent(
    createElement(Rect, { x: 0, y: 0, width: 6, height: 8, fill: 0xff112233 }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  publicWindow.tick();
  const partial = publicPlatform.attached(publicSurface);
  if (partial.format !== wlShm.enums.format.argb8888) {
    const fresh = createShellRoot();
    renderShell(fresh, createElement(Rect, { x: 0, y: 0, width: 6, height: 8, fill: 0xff112233 }));
    const scene = new RetainedSceneRenderer().render(fresh.container, { width: 12, height: 8 });
    const pixels = new RetainedSoftwareRenderer().render(scene).pixels;
    const summary = (frame: RetainedSceneFrame) => ({
      clearColor: frame.clearColor,
      damage: frame.damage,
      layers: frame.layers.map((layer) => ({
        id: layer.id,
        destination: layer.destination,
        clip: layer.clip,
        opacity: layer.opacity,
        sourceSize: [layer.sourceWidth, layer.sourceHeight],
        rgba: [...layer.pixels].slice(0, 16),
      })),
    });
    console.log(
      JSON.stringify(
        {
          fixture: "public React alpha comparison",
          publicScenes: native.scenes.map(summary),
          publicPixels: [...publicPlatform.pixels(partial)].slice(0, 96),
          freshScene: summary(scene),
          freshPixels: [...pixels].slice(0, 96),
          freshBoxes: fresh.container.children.map((node) => ({
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            fill: node.fill,
          })),
        },
        null,
        2,
      ),
    );
    renderShell(fresh, null);
  }
  assert.equal(partial.format, wlShm.enums.format.argb8888);
  assert.ok(publicPlatform.pixels(partial).some((byte, i) => i % 4 === 3 && byte !== 255));
  publicPlatform.frameDone(publicSurface);
  publicPlatform.release(partial);
  publicWindow.setContent(
    createElement(Rect, { x: 0, y: 0, width: 12, height: 8, fill: 0xff445566 }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  publicWindow.tick();
  const restored = publicPlatform.attached(publicSurface);
  assert.equal(restored.format, wlShm.enums.format.xrgb8888);
  assert.equal(restored.pool, opaque.pool);
} finally {
  publicWindow.destroy();
}
assert.equal(publicPlatform.handlersForTest.size, 0);
for (const { fd } of publicPlatform.pools.values())
  assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });
console.log(
  JSON.stringify({
    scope: "native memfd/wire transport fixture; no real socket/display",
    directAttachments: platform.attachments,
    publicAttachments: publicPlatform.attachments,
    destroyedBuffers: [...platform.destroyed],
    frameGateAndBusyBytes: "asserted",
    allProducerFdsClosed: true,
  }),
);

for (const [width, height] of [
  [1280, 800],
  [1920, 1200],
] as const) {
  const frame = pixels(width, height);
  const iterations = 20;
  const start = performance.now();
  for (let i = 0; i < iterations; i++)
    assert.equal(classifyShmFrame(frame, width, height).format, wlShm.enums.format.xrgb8888);
  console.log(
    `[wayland/shm-format] full-alpha scan ${width}x${height}: ${(performance.now() - start).toFixed(3)}ms/${iterations} frames; CPU wall time only`,
  );
}
console.log(
  "[wayland/shm-format] production native memfd bytes, wl_buffer format/reuse/busy/release, invalid frames and public React Window transitions passed; no display/GPU readback",
);
