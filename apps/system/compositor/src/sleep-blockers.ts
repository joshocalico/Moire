/**
 * Who is asking to keep the computer awake. An app's suspend inhibitor only holds off a lid-close
 * suspend when the user has allowed that app (power prefs `sleepBlockers`), so the app has to be
 * named by something it cannot choose: the kernel's pid for its bus connection, followed up the
 * process tree to a launch the compositor made itself, or failing that its executable. The name
 * an app passes to Inhibit is never part of the identity.
 *
 * | Identity         | From                                                                    |
 * | ---------------- | ----------------------------------------------------------------------- |
 * | `launch:<argv0>` | The caller is, or descends from, a process the compositor started       |
 * | `portal:<appid>` | The caller is the portal backend; the frontend derived the app id       |
 * | `exe:<path>`     | Anything else (a user service, a daemonised tool): its executable       |
 *
 * A grant follows the launch, as a permission follows the "responsible process" on macOS: allow
 * a terminal and everything run inside it is allowed.
 */
import fs from "node:fs";
import path from "node:path";
import { parseDesktopCommand } from "@moire/core";
import type { SessionBus } from "@moire/dbus";

export const PORTAL_BACKEND_NAME = "org.freedesktop.impl.portal.desktop.moire";
const BUS = "org.freedesktop.DBus";
const BUS_PATH = "/org/freedesktop/DBus";
/** Longest walk up the process tree; deeper than any real shell-in-terminal nesting. */
const MAX_ANCESTORS = 64;
/** What the portal frontend produces for an app id: a desktop file id or Flatpak/Snap name. */
const PORTAL_APP_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export type AppIdentity = {
  id: string;
  name: string;
  /** Appears to run under X11 (see `runsUnderX11`); a label for Settings, not a decision. */
  x11: boolean;
};

/** The process facts identity needs; `/proc` on Linux, a table in the smokes. */
export type ProcessInspector = {
  parent(pid: number): number | null;
  executable(pid: number): string | null;
};

export const procInspector: ProcessInspector = {
  parent(pid) {
    try {
      // "pid (comm) state ppid …": comm may hold spaces and parentheses, so read past the last ")".
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const parent = Number(fields[1]);
      return Number.isInteger(parent) && parent > 0 ? parent : null;
    } catch {
      return null;
    }
  },
  executable(pid) {
    try {
      const exe = fs.readlinkSync(`/proc/${pid}/exe`);
      // A replaced or unlinked binary cannot be granted by path.
      return path.isAbsolute(exe) && !exe.endsWith(" (deleted)") ? exe : null;
    } catch {
      return null;
    }
  },
};

type Launched = { pid?: number; once(event: "exit" | "error", listener: () => void): unknown };

/** The compositor's own record of what it started: pid to the command it ran. */
export class LaunchRecords {
  private readonly commands = new Map<number, string>();

  /** Remember a child until it exits; returns the child, so it wraps a spawn call. */
  track<Child extends Launched>(child: Child, exec: string): Child {
    const pid = child.pid;
    if (pid === undefined) return child;
    let command: string;
    try {
      command = parseDesktopCommand(exec)[0]!;
    } catch {
      return child;
    }
    this.commands.set(pid, command);
    const forget = () => {
      if (this.commands.get(pid) === command) this.commands.delete(pid);
    };
    child.once("exit", forget);
    child.once("error", forget);
    return child;
  }

  /** The launch `pid` belongs to: itself or its nearest launched ancestor. */
  rootOf(pid: number, inspector: ProcessInspector): { pid: number; command: string } | null {
    let current: number | null = pid;
    for (let depth = 0; current !== null && current > 1 && depth < MAX_ANCESTORS; depth++) {
      const command = this.commands.get(current);
      if (command !== undefined) return { pid: current, command };
      current = inspector.parent(current);
    }
    return null;
  }
}

export type WaylandClientProcess = { pid: number; xwayland: boolean };

/**
 * Whether a launched app looks like an X11 app: Xwayland is running and nothing in the app's
 * process tree has a Wayland connection of its own. It uses only kernel pids (an X window's
 * `_NET_WM_PID` is the app's own claim). A launched process with no window at all reads as X11
 * too, so this errs towards showing the warning.
 */
export function runsUnderX11(
  root: number,
  clients: readonly WaylandClientProcess[],
  launches: LaunchRecords,
  inspector: ProcessInspector,
): boolean {
  if (!clients.some((client) => client.xwayland)) return false;
  return !clients.some(
    (client) => !client.xwayland && launches.rootOf(client.pid, inspector)?.pid === root,
  );
}

export type CallerIdentifier = (
  bus: SessionBus,
  sender: string,
  claimedAppId: string,
) => Promise<AppIdentity | null>;

export type CallerIdentifierOptions = {
  launches: LaunchRecords;
  inspector?: ProcessInspector;
  /** The compositor's Wayland clients by kernel pid. */
  clients?: () => readonly WaylandClientProcess[];
  /** A friendlier name for a launched command (its desktop entry's), if there is one. */
  displayName?: (command: string) => string | null;
  /**
   * The kernel's pid for a bus connection; the bus daemon's answer by default. A seam for hosts
   * whose daemon cannot tell (macOS, where the smokes also run).
   */
  peerPid?: (bus: SessionBus, sender: string) => Promise<number>;
  timeoutMs?: number;
};

/**
 * Identify the sender of an `Idle1.Inhibit` call. Resolves null when the caller cannot be tied
 * to anything stable: the request still counts, but it cannot be put on the allowlist.
 */
export function callerIdentifier(options: CallerIdentifierOptions): CallerIdentifier {
  const inspector = options.inspector ?? procInspector;
  const timeoutMs = options.timeoutMs ?? 2000;
  return async (bus, sender, claimedAppId) => {
    const daemon = (member: string, name: string) =>
      bus.call(
        {
          destination: BUS,
          path: BUS_PATH,
          interface: BUS,
          member,
          signature: "s",
          body: [name],
        },
        { timeoutMs },
      );
    // The portal backend forwards for other apps. It gets no pid from the frontend, only the app
    // id the frontend worked out (Flatpak or Snap metadata, or the caller's systemd scope), so
    // that id is the identity; with none, the app stays unidentified.
    const portal = await daemon("GetNameOwner", PORTAL_BACKEND_NAME).then(
      (reply) => reply.body?.[0],
      () => null,
    );
    if (portal === sender)
      return PORTAL_APP_ID.test(claimedAppId)
        ? { id: `portal:${claimedAppId}`, name: claimedAppId, x11: false }
        : null;

    const pid = options.peerPid
      ? await options.peerPid(bus, sender)
      : Number((await daemon("GetConnectionUnixProcessID", sender)).body?.[0]);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const root = options.launches.rootOf(pid, inspector);
    if (root) {
      const fallback = path.basename(root.command) || root.command;
      return {
        id: `launch:${root.command}`,
        name: options.displayName?.(root.command) ?? fallback,
        x11: runsUnderX11(root.pid, options.clients?.() ?? [], options.launches, inspector),
      };
    }
    const exe = inspector.executable(pid);
    return exe ? { id: `exe:${exe}`, name: path.basename(exe), x11: false } : null;
  };
}
