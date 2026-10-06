/** Production frame gate used by retained EGL/KMS composition; no GPU/scanout claim. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeHeader, type EncodedWaylandMessage } from "@moire/protocol";
import {
  wlCallback,
  wlCompositor,
  wlDisplay,
  wlRegistry,
  wlSurface,
} from "@moire/protocol/generated";
import { ClientSession, CompositorServer } from "./server";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-frame-commit-"));
class Connection extends EventEmitter {
  readonly peerPid = null;
  readonly sent: Buffer[] = [];
  send(data: Buffer, fds: number[] = []) {
    assert.equal(fds.length, 0);
    this.sent.push(Buffer.from(data));
    return true;
  }
  request(message: EncodedWaylandMessage) {
    this.emit("message", message);
  }
  close() {
    this.emit("close");
  }
  completed() {
    return this.sent.flatMap((data) => {
      const header = decodeHeader(data);
      return header.objectId >= 20 && header.opcode === wlCallback.events.done.opcode
        ? [header.objectId]
        : [];
    });
  }
}
const server = new CompositorServer(directory, "frame-commit", {
  mode: "greeter",
  clientPid: process.pid,
  devices: {
    open() {
      throw new Error("Frame scheduling proof must acquire no devices");
    },
    close() {},
  },
});
const conn = new Connection();
const session = new ClientSession(server, conn, 1);
try {
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  const global = conn.sent
    .filter((data) => decodeHeader(data).objectId === 2)
    .map((data) => wlRegistry.events.global.decode(data))
    .find((item) => item.interfaceValue === "wl_compositor");
  assert.ok(global);
  conn.request(wlRegistry.requests.bind.encode(2, global.name, "wl_compositor", 4, 3));
  conn.request(wlCompositor.requests.createSurface.encode(3, 10));
  const surface = session.surfaceById(10);
  assert.ok(surface);
  // Output work may occur between separate request packets. A frame request
  // belongs to the NEXT commit; repainting the old scene must not unlock it.
  conn.request(wlSurface.requests.frame.encode(10, 20));
  session.finishSurfaceFrame(surface);
  assert.deepEqual(
    conn.completed(),
    [],
    "Output of the old scene must not acknowledge an uncommitted frame",
  );
  conn.request(wlSurface.requests.commit.encode(10));
  session.finishSurfaceFrame(surface);
  session.finishSurfaceFrame(surface);
  assert.deepEqual(conn.completed(), [20], "Committed callback completes exactly once");

  conn.request(wlSurface.requests.frame.encode(10, 21));
  conn.request(wlSurface.requests.commit.encode(10));
  conn.request(wlSurface.requests.frame.encode(10, 22));
  conn.request(wlSurface.requests.frame.encode(10, 23));
  session.finishSurfaceFrame(surface);
  assert.deepEqual(
    conn.completed(),
    [20, 21],
    "Output acknowledges committed callbacks while retaining the next commit's pending callbacks",
  );
  conn.request(wlSurface.requests.commit.encode(10));
  session.finishSurfaceFrame(surface);
  assert.deepEqual(
    conn.completed(),
    [20, 21, 22, 23],
    "Pending callbacks activate at commit and preserve request order",
  );

  conn.request(wlSurface.requests.frame.encode(10, 24));
  conn.request(wlSurface.requests.destroy.encode(10));
  assert.deepEqual(
    conn.completed(),
    [20, 21, 22, 23],
    "Destroying a surface never acknowledges uncommitted drawing",
  );
  assert.equal(session.surfaceById(10), null);
  console.log(
    JSON.stringify({
      suite: "production composition frame-commit gate",
      cases: 4,
      deviceAccess: 0,
      physicalPresentation: false,
      actualExitCode: 0,
    }),
  );
} finally {
  conn.close();
  server.stop();
  fs.rmSync(directory, { recursive: true, force: true });
}
