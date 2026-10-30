/**
 * The front: moire-dm's only process that reads bytes from the greeter. It runs as the
 * unprivileged `moire-dm-front` account (no supplementary groups), listens on the greeter
 * socket, checks the peer, reassembles and parses Moire protocol frames, and hands the root
 * broker typed, re-encoded requests over fd 3. Replies from the broker are written back as is.
 *
 * It holds no policy: one-request-at-a-time, phases and throttling are the broker's state
 * machine. If the broker goes away the front exits; if the front dies the broker restarts.
 */
import fs from "node:fs";
import net from "node:net";
import {
  ChannelReader,
  decodeBrokerCommand,
  encodeFrontEvent,
  type FrontEvent,
} from "./front-channel";
import { FrameReader, encodeRequestMessage, parseRequest } from "./protocol";

export type FrontOptions = Readonly<{
  socketPath: string;
  /** SO_PEERCRED: is this the greeter account? False closes the connection unread. */
  authorizePeer: (socket: net.Socket) => boolean;
  /** The broker channel (fd 3). */
  broker: net.Socket;
  /** Mode for the socket file; the directory around it limits who can reach it. */
  socketMode?: number;
}>;

export type Front = { close(): void; readonly listening: Promise<void> };

export function runFront(options: FrontOptions): Front {
  const connections = new Map<number, { socket: net.Socket; reader: FrameReader }>();
  let nextConnection = 1;
  const send = (event: FrontEvent) => {
    if (options.broker.destroyed) return;
    const frame = encodeFrontEvent(event);
    options.broker.write(frame, () => frame.fill(0));
  };

  function drop(id: number, notify: FrontEvent["kind"] | null): void {
    const connection = connections.get(id);
    if (!connection) return;
    connections.delete(id);
    connection.reader.wipe();
    connection.socket.destroy();
    if (notify === "violation" || notify === "disconnected") send({ kind: notify, connection: id });
  }

  try {
    fs.unlinkSync(options.socketPath);
  } catch {
    // No stale socket.
  }
  const server = net.createServer((socket) => {
    if (!options.authorizePeer(socket)) {
      socket.destroy();
      return;
    }
    const id = nextConnection++;
    const reader = new FrameReader();
    connections.set(id, { socket, reader });
    socket.on("error", () => {});
    socket.on("close", () => drop(id, "disconnected"));
    socket.on("data", (chunk: Buffer) => {
      for (const event of reader.push(chunk)) {
        if (event.kind === "violation") return drop(id, "violation");
        const parsed = parseRequest(event.message);
        event.message.fill(0);
        if (!parsed.ok) return drop(id, "violation");
        const message = encodeRequestMessage(parsed.request);
        if (parsed.request.type === "answer") parsed.request.response?.fill(0);
        send({ kind: "request", connection: id, message });
        message.fill(0);
      }
    });
    send({ kind: "connected", connection: id });
  });

  const channel = new ChannelReader();
  options.broker.on("data", (chunk: Buffer) => {
    const frames = channel.push(chunk);
    if (!frames) return close();
    for (const raw of frames) {
      const command = decodeBrokerCommand(raw);
      if (!command) return close();
      if (command.kind === "close") drop(command.connection, null);
      else {
        const socket = connections.get(command.connection)?.socket;
        if (socket && !socket.destroyed) {
          const length = Buffer.alloc(4);
          length.writeUInt32LE(command.message.length);
          socket.write(Buffer.concat([length, command.message]));
        }
      }
    }
  });
  options.broker.on("error", () => close());
  options.broker.on("close", () => close());

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    for (const id of connections.keys()) drop(id, null);
    channel.wipe();
    server.close();
    options.broker.destroy();
    try {
      fs.unlinkSync(options.socketPath);
    } catch {
      // Already gone.
    }
  }

  const listening = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      if (options.socketMode !== undefined) fs.chmodSync(options.socketPath, options.socketMode);
      send({ kind: "ready", connection: 0 });
      resolve();
    });
  });
  return { close, listening };
}
