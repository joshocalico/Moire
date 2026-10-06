/** Private synthetic Unix protocol peer. It authenticates no real account. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os, { endianness } from "node:os";
import path from "node:path";
import { createServer, type Socket } from "node:net";

export const harmlessSession =
  "/nix/store/00000000000000000000000000000000-synthetic-native-oracle/bin/harmless";
export type WireObject = Record<string, unknown>;
function frame(value: WireObject): Buffer {
  const payload = Buffer.from(JSON.stringify(value)),
    header = Buffer.alloc(4);
  if (endianness() === "LE") header.writeUInt32LE(payload.length);
  else header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}
export async function nativeProtocolPeer(
  reply: (request: WireObject, send: (reply: WireObject) => void) => void,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-native-ui-"));
  await fs.chmod(directory, 0o700);
  const socketPath = path.join(directory, "greetd.sock");
  const sockets = new Set<Socket>(),
    requests: WireObject[] = [];
  let failure: unknown;
  let closed = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      closed++;
    });
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        while (buffer.length >= 4) {
          const length = endianness() === "LE" ? buffer.readUInt32LE() : buffer.readUInt32BE();
          assert.ok(length > 0 && length <= 65536);
          if (buffer.length < 4 + length) return;
          const parsed: unknown = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
          buffer = buffer.subarray(4 + length);
          assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
          const request = Object.fromEntries(Object.entries(parsed));
          requests.push(request);
          reply(request, (value) => {
            socket.write(frame(value));
          });
        }
      } catch (error) {
        failure = error;
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    socketPath,
    requests,
    disconnect: () => {
      for (const socket of sockets) socket.destroy();
    },
    assertHealthy: () => {
      if (failure) throw failure;
    },
    closed: () => closed,
    destroy: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}
