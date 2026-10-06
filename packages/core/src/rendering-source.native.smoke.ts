/** Linux memfd/mmap production SHM/commit handlers. No Unix socket, output, device or hardware claim. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeHeader } from "@moire/protocol";
import {
  wlCompositor,
  wlDisplay,
  wlRegistry,
  wlShm,
  wlShmPool,
  wlSurface,
} from "@moire/protocol/generated";
import {
  moireSurfaceStateManagerV1 as manager,
  moireSurfaceStateV1 as observation,
} from "@moire/protocol/surface-state";
import { createMemfd, truncateFd } from "@moire/sys";
if (process.platform !== "linux") {
  console.log(
    "SKIP rendering source native SHM failure oracle: Linux memfd/mmap required; portable missing-buffer handler oracle remains separate",
  );
} else {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-source-commit-"));
  const previous = process.env.HOME;
  process.env.HOME = directory;
  const { CompositorServer, ClientSession } = await import("./server");
  class Connection extends EventEmitter {
    readonly peerPid = null;
    readonly sent: Buffer[] = [];
    send(data: Buffer, fds: number[] = []) {
      assert.equal(fds.length, 0);
      this.sent.push(Buffer.from(data));
      return true;
    }
    close() {
      this.emit("close");
    }
    rendering() {
      const message = this.sent
        .filter((data) => {
          const h = decodeHeader(data);
          return h.objectId === 14 && h.opcode === observation.events.rendering.opcode;
        })
        .at(-1);
      assert.ok(message);
      return observation.events.rendering.decode(message);
    }
  }
  const server = new CompositorServer(directory);
  const conn = new Connection();
  const session = new ClientSession(server, conn, 1);
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  let delivered: number | null = null;
  try {
    conn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
    const globals = conn.sent
      .filter((data) => decodeHeader(data).objectId === 2)
      .map((data) => wlRegistry.events.global.decode(data));
    for (const [name, id] of [
      ["wl_compositor", 3],
      ["wl_shm", 5],
      [manager.name, 7],
    ] as const) {
      const global = globals.find((item) => item.interfaceValue === name);
      assert.ok(global);
      conn.emit(
        "message",
        wlRegistry.requests.bind.encode(2, global.name, name, global.version, id),
      );
    }
    conn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
    conn.emit("message", manager.requests.getSurfaceState.encode(7, 14, 10));
    const bytes = Buffer.alloc(64, 255);
    const fd = createMemfd("moire-source-commit", 1);
    delivered = fd;
    truncateFd(fd, bytes.length);
    fs.writeSync(fd, bytes, 0, bytes.length, 0);
    conn.emit("message", wlShm.requests.createPool.encode(5, 20, fd, bytes.length));
    conn.emit("message", wlShmPool.requests.createBuffer.encode(20, 21, 0, 4, 4, 16, 1));
    const commit = (token: number) => {
      conn.emit("message", observation.requests.submission.encode(14, token));
      conn.emit("message", wlSurface.requests.commit.encode(10));
    };
    conn.emit("message", wlSurface.requests.attach.encode(10, 21, 0, 0));
    commit(11);
    const surface = session.surfaceById(10);
    assert.ok(surface?.content);
    const lastGood = surface.content;
    const revision = surface.revision;
    assert.equal(conn.rendering().token, 11);
    assert.deepEqual(lastGood.pixels, new Uint8Array(bytes));
    // Invalid extent is rejected by copyFromPool before any native view outside its mapping.
    conn.emit("message", wlShmPool.requests.createBuffer.encode(20, 22, bytes.length, 4, 4, 16, 1));
    conn.emit("message", wlSurface.requests.attach.encode(10, 22, 0, 0));
    commit(77);
    assert.equal(surface.content, lastGood);
    assert.equal(surface.revision, revision);
    assert.equal(conn.rendering().token, 0);
    assert.equal(conn.rendering().rendering, 0);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.[1]), /invalid pool copy/);
    commit(78);
    assert.equal(
      conn.rendering().token,
      0,
      "failed latest attach stays unknown on idle commit; old display is not certified as requested pixels",
    );
    conn.emit("message", wlSurface.requests.attach.encode(10, 99999, 0, 0));
    commit(79);
    assert.equal(surface.content, lastGood);
    assert.equal(conn.rendering().token, 0);
    assert.equal(errors.length, 2);
    conn.emit("message", wlSurface.requests.attach.encode(10, 21, 0, 0));
    commit(80);
    assert.notEqual(surface.content, lastGood);
    assert.equal(surface.revision, revision + 1);
    assert.equal(
      conn.rendering().token,
      80,
      "successful new snapshot restores token correlation without certifying output",
    );
    assert.equal(conn.rendering().rendering, 0);
    console.log(
      "Linux actual memfd/mmap + Server/ClientSession SHM handlers: failed/missing attach preserves last-good display but revokes token; idle distinction and successful new source correlation PASS (no Unix/output/hardware claim)",
    );
  } finally {
    console.error = originalError;
    session.destroy();
    await server.stop();
    const closedFd = delivered;
    if (closedFd !== null) assert.throws(() => fs.fstatSync(closedFd), { code: "EBADF" });
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
