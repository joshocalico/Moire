/**
 * The real front (same runFront, same fd 3 channel) with a test peer check: every peer is
 * allowed unless the MOIRE_DM_FAKE_DENY file exists, so the smoke can play a stranger.
 */
import fs from "node:fs";
import net from "node:net";
import { runFront } from "./front";

const socketPath = process.env.MOIRE_DM_FRONT_SOCKET;
const deny = process.env.MOIRE_DM_FAKE_DENY;
if (!socketPath || !deny) process.exit(1);
const broker = new net.Socket({ fd: 3, readable: true, writable: true });
broker.on("close", () => process.exit(0));
const front = runFront({ socketPath, broker, authorizePeer: () => !fs.existsSync(deny) });
process.on("SIGTERM", () => {
  front.close();
  process.exit(0);
});
await front.listening;
