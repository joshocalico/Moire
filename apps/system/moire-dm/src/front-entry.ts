/**
 * Production front entry. The broker spawns it as `moire-dm-front` (uid/gid set by spawn, so
 * no supplementary groups) with fd 3 as the broker channel.
 */
import net from "node:net";
import { peerCredentials } from "@moire/sys/privilege";
import { runFront } from "./front";

const BROKER_FD = 3;
/**
 * Connecting needs write permission on the socket, and the front (no supplementary groups) can't
 * give it the greeter's group. So the socket is open and its directory (0750
 * moire-dm-front:greeter, made by the broker) is the gate; SO_PEERCRED then admits only the
 * greeter's uid.
 */
const SOCKET_MODE = 0o666;

const socketPath = process.env.MOIRE_DM_FRONT_SOCKET;
const greeterUid = Number(process.env.MOIRE_DM_GREETER_UID);
if (process.getuid?.() === 0 || !socketPath || !Number.isSafeInteger(greeterUid)) process.exit(1);

function socketFd(socket: net.Socket): number | null {
  const fd = (socket as unknown as { _handle?: { fd?: number } })._handle?.fd;
  return typeof fd === "number" && fd >= 0 ? fd : null;
}

const broker = new net.Socket({ fd: BROKER_FD, readable: true, writable: true });
const front = runFront({
  socketPath,
  socketMode: SOCKET_MODE,
  broker,
  authorizePeer(socket) {
    const fd = socketFd(socket);
    return fd !== null && peerCredentials(fd)?.uid === greeterUid;
  },
});
broker.on("close", () => process.exit(0));
// The broker stops us with SIGTERM; remove the socket so no greeter connects to a dead end.
process.on("SIGTERM", () => {
  front.close();
  process.exit(0);
});
await front.listening;
