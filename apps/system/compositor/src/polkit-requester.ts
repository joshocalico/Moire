/**
 * Who asked for an authorization, for the secure prompt's "Requested by" line.
 *
 * Everything here starts from the pid polkit reports (`polkit.subject-pid`), which the kernel
 * gave polkitd, and from `/proc`. It is advisory: a pid can be reused, and the requester may be
 * a child of the app shown. `_NET_WM_PID`, which an X client sets itself, is never consulted.
 */
import fs from "node:fs";
import path from "node:path";
import type { SecurePromptRequester } from "@moire/core";
import { procInspector, type ProcessInspector, type WaylandClientProcess } from "./sleep-blockers";

export type RequesterInfo = {
  requester: SecurePromptRequester;
  /** `/proc/<pid>/exe`, for the cancel cool-down key. Null when it cannot be read. */
  executable: string | null;
};
export type RequesterResolver = (pid: number) => RequesterInfo | null;

/** Longest walk up the process tree, as in sleep-blockers.ts. */
const MAX_ANCESTORS = 64;
const MAX_MAPS_BYTES = 1024 * 1024;

function label(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "")
    .trim()
    .slice(0, 64);
}

/** Whether the process has an X client library mapped. Unreadable for other users' processes. */
export function mapsXClientLibrary(pid: number, procRoot = "/proc"): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(path.join(procRoot, String(pid), "maps"), "r");
    const buffer = Buffer.alloc(MAX_MAPS_BYTES);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (read <= 0) break;
      length += read;
    }
    return /\/lib(?:xcb|X11)\.so/.test(buffer.toString("latin1", 0, length));
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export function createRequesterResolver(options: {
  /** The compositor's Wayland clients by the kernel's peer pid (`conn.peerPid`). */
  clients: () => readonly WaylandClientProcess[];
  /** The compositor's own launch a process belongs to, with the name it shows for that app. */
  launchOf?: (pid: number) => { pid: number; name: string } | null;
  inspector?: ProcessInspector;
  xClient?: (pid: number) => boolean;
}): RequesterResolver {
  const inspector = options.inspector ?? procInspector;
  const xClient = options.xClient ?? mapsXClientLibrary;
  const programOf = (pid: number, executable = inspector.executable(pid)) =>
    label(executable ? path.basename(executable) : "");
  const nameOf = (pid: number) => {
    const launch = options.launchOf?.(pid);
    return (launch?.pid === pid ? label(launch.name) : "") || programOf(pid);
  };

  return (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 1) return null;
    const executable = inspector.executable(pid);
    // Neither a parent nor an executable: the process is gone.
    if (executable === null && inspector.parent(pid) === null) return null;
    const clients = options.clients();
    const wayland = (candidate: number) =>
      clients.some((client) => client.pid === candidate && !client.xwayland);
    const name = nameOf(pid) || `Process ${pid}`;
    if (wayland(pid)) return { requester: { name, pid, x11: false }, executable };

    // The nearest ancestor with a Wayland connection is the app the user sees ("Terminal").
    let via = "";
    let ancestor = inspector.parent(pid);
    for (let depth = 0; ancestor !== null && ancestor > 1 && depth < MAX_ANCESTORS; depth++) {
      if (wayland(ancestor)) {
        via = nameOf(ancestor);
        break;
      }
      ancestor = inspector.parent(ancestor);
    }
    // Failing that, the launch it descends from (a windowless service the compositor started).
    const launch = options.launchOf?.(pid);
    if (!via && launch && launch.pid !== pid) via = label(launch.name);
    // No Wayland connection of its own or above it, Xwayland is up, and it links an X library:
    // one of the X apps, which are a single trust zone (docs/polkit-agent.md, "Xwayland").
    const x11 =
      (ancestor === null || ancestor <= 1 || !wayland(ancestor)) &&
      clients.some((client) => client.xwayland) &&
      xClient(pid);
    return { requester: { name, pid, ...(via ? { via } : {}), x11 }, executable };
  };
}
