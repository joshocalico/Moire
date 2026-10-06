import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { copyFromDmabuf, type DmabufBuffer, type DmabufReadbackBackend } from "./dmabuf-map";

const ARGB8888 = 0x34325241;
const XRGB8888 = 0x34325258;

function assertRawColor(actual: number, color: number, format: number): void {
  assert.ok(format === ARGB8888 || format === XRGB8888, "supported actual DRM fourcc");
  // drm_fourcc.h defines XRGB8888 as x:R:G:B; x is not an alpha channel.
  assert.equal(
    format === XRGB8888 ? actual & 0xffffff : actual,
    format === XRGB8888 ? color & 0xffffff : color,
  );
}

for (const unused of [0, 0x37, 0xff])
  assertRawColor(((unused << 24) | 0x3167ad) >>> 0, 0xff3167ad, XRGB8888);
assert.throws(() => assertRawColor(0x003167ad, 0xff3167ad, ARGB8888));
assert.throws(() => assertRawColor(0xff3167ac, 0xff3167ad, XRGB8888));

function buffer(overrides: Partial<DmabufBuffer> = {}): DmabufBuffer {
  return {
    kind: "dmabuf",
    width: 2,
    height: 2,
    format: 0x34325241,
    flags: 0,
    planes: [{ fd: 42, offset: 4, stride: 12, modifierHi: 0, modifierLo: 0 }],
    ...overrides,
  };
}

function mapping(byteLength: number) {
  const storage = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(storage);
  const events: string[] = [];
  let failRead = false;
  let failEnd = false;
  let failUnmap = false;
  const backend: DmabufReadbackBackend = {
    mmap(length, protection, flags, fd, offset) {
      assert.equal(length, byteLength);
      assert.equal(protection, 1);
      assert.equal(flags, 1);
      assert.equal(fd, 42);
      assert.equal(offset, 0);
      events.push("map");
      return storage;
    },
    sync(fd, flags) {
      assert.equal(fd, 42);
      assert.ok(flags === 1 || flags === 5);
      events.push(flags === 1 ? "start" : "end");
      if (flags === 5) {
        // A producer may change the shared bytes after CPU access ends.
        bytes.fill(0xa5);
        if (failEnd) throw new Error("fixture END failure");
      }
    },
    nativeView(address, length) {
      assert.equal(address, storage);
      assert.equal(length, byteLength);
      events.push("read");
      if (failRead) throw new Error("fixture mapping read failure");
      return storage;
    },
    munmap(address, length) {
      assert.equal(address, storage);
      assert.equal(length, byteLength);
      events.push("unmap");
      if (failUnmap) throw new Error("fixture unmap failure");
    },
  };
  return {
    bytes,
    events,
    backend,
    failRead() {
      failRead = true;
    },
    failEnd() {
      failEnd = true;
    },
    failUnmap() {
      failUnmap = true;
    },
  };
}

const warnings: string[] = [];
const previousWarn = console.warn;
console.warn = (message: unknown) => warnings.push(String(message));
try {
  const linear = mapping(28);
  linear.bytes.set([0xff, 0x00, 0x80, 0xff], 4);
  linear.bytes[27] = 0x77;
  const expected = linear.bytes.slice(4);
  const destination = new Uint8Array(24);
  const result = copyFromDmabuf(buffer(), null, destination, linear.backend);
  assert.equal(result.pixels, destination, "reuse caller storage");
  assert.equal(result.stride, 12);
  assert.deepEqual(result.pixels, expected, "copy offset and padded rows before END");
  assert.deepEqual(linear.events, ["map", "start", "read", "end", "unmap"]);
  assert.equal(warnings.length, 0);

  const black = mapping(28);
  assert.deepEqual(
    copyFromDmabuf(buffer(), null, undefined, black.backend).pixels,
    new Uint8Array(24),
  );
  assert.deepEqual(black.events, ["map", "start", "read", "end", "unmap"]);
  assert.equal(warnings.length, 0, "valid transparent/black pixels are a successful readback");

  const lateColor = mapping(4 + 8192);
  lateColor.bytes[4 + 6000] = 0x7e;
  const large = buffer({ width: 1, height: 2048, planes: [{ ...buffer().planes[0], stride: 4 }] });
  assert.equal(copyFromDmabuf(large, null, undefined, lateColor.backend).pixels[6000], 0x7e);
  assert.equal(warnings.length, 0, "a zero first 4096 bytes cannot invalidate later rows");

  const gbmPixels = new Uint8Array(24);
  const unused = mapping(28);
  const gbmResult = { pixels: gbmPixels, stride: 12 };
  assert.equal(
    copyFromDmabuf(buffer(), { mapImport: () => gbmResult }, undefined, unused.backend),
    gbmResult,
    "successful GBM readback is authoritative even when every pixel is zero",
  );
  assert.deepEqual(unused.events, [], "GBM success never falls through to raw mmap");

  for (const modifier of [0x100000000000001n, 0xffffffffffffffffn]) {
    const tiled = mapping(28);
    const originalPlane = buffer().planes[0];
    const nonLinear = buffer({
      planes: [
        {
          ...originalPlane,
          modifierHi: Number(modifier >> 32n),
          modifierLo: Number(modifier & 0xffffffffn),
        },
      ],
    });
    const previous = new Uint8Array(24).fill(0x37);
    assert.throws(
      () => copyFromDmabuf(nonLinear, null, previous, tiled.backend),
      /readback unavailable/,
    );
    assert.deepEqual(
      previous,
      new Uint8Array(24).fill(0x37),
      "unavailable modifier preserves last-good storage",
    );
    assert.deepEqual(
      tiled.events,
      [],
      "nonlinear and unknown modifiers must not be interpreted as linear memory",
    );
  }

  const brokenRead = mapping(28);
  brokenRead.failRead();
  assert.throws(
    () => copyFromDmabuf(buffer(), null, undefined, brokenRead.backend),
    /readback unavailable/,
  );
  assert.deepEqual(
    brokenRead.events,
    ["map", "start", "read", "end", "unmap"],
    "END and unmap run after a read exception",
  );

  const brokenEnd = mapping(28);
  brokenEnd.failEnd();
  const retained = new Uint8Array(24).fill(0x37);
  assert.throws(
    () => copyFromDmabuf(buffer(), null, retained, brokenEnd.backend),
    /readback unavailable/,
  );
  assert.deepEqual(
    retained,
    new Uint8Array(24).fill(0x37),
    "END failure cannot publish partially copied bytes",
  );
  assert.deepEqual(
    brokenEnd.events,
    ["map", "start", "read", "end", "unmap"],
    "unmap runs after an END exception",
  );

  const brokenUnmap = mapping(28);
  brokenUnmap.failUnmap();
  assert.throws(
    () => copyFromDmabuf(buffer(), null, retained, brokenUnmap.backend),
    /readback unavailable/,
  );
  assert.deepEqual(retained, new Uint8Array(24).fill(0x37));
  assert.deepEqual(brokenUnmap.events, ["map", "start", "read", "end", "unmap"]);

  assert.throws(
    () =>
      copyFromDmabuf(
        buffer(),
        {
          mapImport(_args, destination) {
            assert.equal(destination, undefined, "GBM never receives mutable last-good storage");
            throw new Error("fixture GBM cleanup failure");
          },
        },
        retained,
      ),
    /GBM cleanup failure/,
  );
  assert.deepEqual(retained, new Uint8Array(24).fill(0x37));
} finally {
  console.warn = previousWarn;
}

console.log(
  "dma-buf CPU readback ordering, cleanup, modifiers, offsets, and valid black content passed",
);

// Opt-in native GBM mapping and canonical snapshot oracle. This does not qualify hardware.
// The default boundary test opens no devices.
if (process.env.MOIRE_TEST_GBM_BLACK === "1") {
  const {
    EglOutputScaler,
    GbmDevice,
    openPath,
    closeFd,
    O_RDWR,
    O_CLOEXEC,
    socketpairUnixStream,
    WaylandClientConn,
  } = await import("@moire/sys");
  const { decodeHeader } = await import("@moire/protocol");
  const {
    wlDisplay,
    wlRegistry,
    wlCompositor,
    wlSurface,
    wlBuffer,
    zwpLinuxDmabufV1: dmabuf,
    zwpLinuxBufferParamsV1: params,
  } = await import("@moire/protocol/generated");
  const { CompositorServer, ClientSession } = await import("./server");
  const renderNode = process.env.MOIRE_RENDER_NODE ?? "/dev/dri/card0";
  const fd = openPath(renderNode, O_RDWR | O_CLOEXEC);
  const openImporter = () => {
    // Match production's independently opened import-device ownership. Keep
    // raw and server imports separate from the producer and from one another.
    // The native shared-file control corrupted the next colored frame before
    // mapping; GEM-handle alias destruction is inferred, not instrumented.
    const importFd = openPath(renderNode, O_RDWR | O_CLOEXEC);
    try {
      return new GbmDevice(importFd, importFd);
    } catch (error) {
      closeFd(importFd);
      throw error;
    }
  };
  try {
    const scaler = new EglOutputScaler(fd);
    try {
      const importer = openImporter();
      try {
        const serverImporter = openImporter();
        try {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-map-oracle-"));
          const previousHome = process.env.HOME;
          const previousConfig = process.env.XDG_CONFIG_HOME;
          process.env.HOME = directory;
          process.env.XDG_CONFIG_HOME = path.join(directory, "config");
          class CpuServer extends CompositorServer {
            override getGbm() {
              return serverImporter;
            }
          }
          const server = new CpuServer(directory);
          const [clientFd, serverFd] = socketpairUnixStream();
          const client = new WaylandClientConn(
            new net.Socket({ fd: clientFd, readable: true, writable: true }),
          );
          const receiver = new WaylandClientConn(
            new net.Socket({ fd: serverFd, readable: true, writable: true }),
          );
          const session = new ClientSession(server, receiver, 1);
          const deliveredFds: number[] = [];
          receiver.on("message", (chunk: { fds: number[] }) => deliveredFds.push(...chunk.fds));
          const received: Buffer[] = [];
          const errors: unknown[] = [];
          let incoming = Buffer.alloc(0);
          client.on("message", (chunk: { data: Buffer }) => {
            incoming = Buffer.concat([incoming, chunk.data]);
            while (incoming.length >= 8) {
              const header = decodeHeader(incoming);
              assert.ok(header.size >= 8);
              if (incoming.length < header.size) break;
              received.push(Buffer.from(incoming.subarray(0, header.size)));
              incoming = incoming.subarray(header.size);
            }
          });
          client.on("error", (error: unknown) => errors.push(error));
          receiver.on("error", (error: unknown) => errors.push(error));
          const wait = async (predicate: () => boolean) => {
            const deadline = performance.now() + 3000;
            while (!predicate()) {
              assert.deepEqual(errors, [], "socket transport errors");
              assert.ok(performance.now() < deadline, "native protocol fixture timed out");
              await new Promise<void>((resolve) => setTimeout(resolve, 5));
            }
          };
          const send = (message: { data: Buffer; fds: number[] }) =>
            assert.equal(client.send(message.data, message.fds), true);
          try {
            send(wlDisplay.requests.getRegistry.encode(1, 2));
            send(wlDisplay.requests.sync.encode(1, 99));
            await wait(() => received.some((data) => decodeHeader(data).objectId === 99));
            const globals = received.flatMap((data) =>
              decodeHeader(data).objectId === 2 ? [wlRegistry.events.global.decode(data)] : [],
            );
            for (const [name, id] of [
              [wlCompositor.name, 3],
              [dmabuf.name, 4],
            ] as const) {
              const global = globals.find((item) => item.interfaceValue === name);
              assert.ok(global);
              send(
                wlRegistry.requests.bind.encode(
                  2,
                  global.name,
                  name,
                  Math.min(global.version, 3),
                  id,
                ),
              );
            }
            send(wlCompositor.requests.createSurface.encode(3, 10));
            for (const color of [0x00000000, 0xff000000, 0xff3167ad, 0x00000000, 0xff000000]) {
              const frame = scaler.renderClientComposition("black-readback", {
                width: 128,
                height: 32,
                clearColor: color,
                layers: [],
              });
              assert.ok(frame, "fixture GBM frame allocation");
              assert.equal(
                frame.format,
                color >>> 24 === 255 ? XRGB8888 : ARGB8888,
                "draw-derived actual allocation fourcc",
              );
              try {
                const mapped = importer.mapImport({ ...frame, offset: 0 });
                assert.ok(mapped, "valid all-zero GBM mapping must succeed");
                for (let y = 0; y < frame.height; y++) {
                  const row: DataView = new DataView(
                    mapped.pixels.buffer,
                    mapped.pixels.byteOffset + y * mapped.stride,
                  );
                  for (let x = 0; x < frame.width; x++) {
                    assertRawColor(row.getUint32(x * 4, true), color, frame.format);
                  }
                }
                const owned = scaler.snapshotDmabuf({
                  width: frame.width,
                  height: frame.height,
                  format: frame.format,
                  plane: {
                    fd: frame.fd,
                    offset: 0,
                    stride: frame.stride,
                    modifier: frame.modifier,
                  },
                });
                try {
                  const pixels = owned.readbackPixels();
                  assert.equal(pixels.length, frame.width * frame.height * 4);
                  for (let i = 0; i < pixels.length; i += 4)
                    assert.deepEqual(
                      Array.from(pixels.subarray(i, i + 4)),
                      [color & 255, (color >>> 8) & 255, (color >>> 16) & 255, color >>> 24],
                      "canonical owned BGRA snapshot",
                    );
                } finally {
                  owned.destroy();
                }
                // SCM_RIGHTS gives the real handler its own fd; no borrowed producer descriptor.
                send(dmabuf.requests.createParams.encode(4, 20));
                send(
                  params.requests.add.encode(
                    20,
                    frame.fd,
                    0,
                    0,
                    frame.stride,
                    Number(frame.modifier >> 32n),
                    Number(frame.modifier & 0xffffffffn),
                  ),
                );
                send(
                  params.requests.createImmed.encode(
                    20,
                    21,
                    frame.width,
                    frame.height,
                    frame.format,
                    0,
                  ),
                );
                send(params.requests.destroy.encode(20));
                const previousRevision = session.surfaceById(10)?.revision ?? 0;
                send(wlSurface.requests.attach.encode(10, 21, 0, 0));
                send(wlSurface.requests.commit.encode(10));
                await wait(() => (session.surfaceById(10)?.revision ?? 0) > previousRevision);
                const surface = session.surfaceById(10);
                assert.ok(surface?.content);
                assert.equal(surface.content.storage, "cpu", "actual no-renderer GBM fallback");
                for (let y = 0; y < frame.height; y++) {
                  const row: DataView = new DataView(
                    surface.content.pixels.buffer,
                    surface.content.pixels.byteOffset + y * surface.content.stride,
                  );
                  for (let x = 0; x < frame.width; x++)
                    assert.equal(
                      row.getUint32(x * 4, true),
                      color,
                      "canonical CPU fallback BGRA including opaque XRGB alpha",
                    );
                }
                send(wlBuffer.requests.destroy.encode(21));
                send(wlDisplay.requests.sync.encode(1, 98));
                const previousReplies = received.filter(
                  (data) => decodeHeader(data).objectId === 98,
                ).length;
                await wait(
                  () =>
                    received.filter((data) => decodeHeader(data).objectId === 98).length >
                    previousReplies,
                );
                assert.ok(deliveredFds.length > 0, "actual SCM_RIGHTS descriptor delivery");
                assert.throws(
                  () => fs.fstatSync(deliveredFds[deliveredFds.length - 1]!),
                  { code: "EBADF" },
                  "wl_buffer destruction closes the compositor's independently received fd",
                );
              } finally {
                // GBM caches imports by fd. Retire before the producer can close/reuse
                // that descriptor while rotating ARGB/XRGB target pools, as the server
                // does for its separately owned fd in closeDmabufPlanes.
                importer.releaseImport(frame.fd);
                scaler.releaseClientFrame(frame.id);
              }
            }
            assert.equal(deliveredFds.length, 5, "one transferred native descriptor per scene");
            console.log(
              `Actual GBM fourcc/raw RGB/ARGB, owned BGRA and Server CPU fallback alpha passed for repeated transparent/black/color scenes on ${scaler.info.glRenderer}; no hardware or scanout qualification`,
            );
          } finally {
            session.destroy();
            receiver.close();
            client.close();
            server.stop();
            if (previousHome === undefined) delete process.env.HOME;
            else process.env.HOME = previousHome;
            if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = previousConfig;
            fs.rmSync(directory, { recursive: true, force: true });
          }
        } finally {
          serverImporter.destroy();
        }
      } finally {
        importer.destroy();
      }
    } finally {
      scaler.destroy();
    }
  } finally {
    closeFd(fd);
  }
}
