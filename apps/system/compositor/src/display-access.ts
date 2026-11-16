/**
 * Who may use the compositor's privileged `org.moire.Display1` methods. Reading the screen is the
 * Screenshot app's alone; changing the display layout or mode is Settings' alone. Anything else
 * on the session bus (a terminal's `busctl`, another app, a user service) is refused.
 *
 * The caller is named by the kernel, never by itself: the bus daemon's pid for the sender's
 * connection, asked at call time, followed up `/proc` to a launch the compositor made itself
 * (sleep-blockers.ts). A launch name alone is not enough here: `moire-screenshot` is found on a
 * `PATH` whose first entry, `~/.local/bin`, any of the user's processes can write. So the
 * compositor pins the bundled apps it trusts: a launch of `moire-screenshot` (or of the launcher's
 * absolute path) always executes the launcher in the compositor's own install tree, and only a
 * launch pinned that way passes the gate. A shadowing file in `~/.local/bin` is never run.
 *
 * Test images only: the guest display scripts (`scripts/guest-display-mode.sh`,
 * `scripts/guest-smoke-display-layout-dbus.sh`) change modes from a root shell. `testControlGate`
 * lets them through while root holds a grant for them, and only in an image that enables it
 * (`moire.testing.displayControl`, off and asserted off outside test images).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesktopCommand } from "@moire/core";
import { DbusRemoteError, type DbusMethod, type SessionBus } from "@moire/dbus";
import {
  busPeerPid,
  procInspector,
  type LaunchRecords,
  type ProcessInspector,
} from "./sleep-blockers";

export const ACCESS_DENIED = "org.freedesktop.DBus.Error.AccessDenied";

/** A bundled app the compositor trusts with a privileged method. */
export type TrustedApp = {
  name: string;
  /** The launcher's file name, as desktop entries invoke it (`moire-screenshot`). */
  command: string;
  /** The launcher in the compositor's own install tree. */
  file: string;
};

/** The install tree the compositor runs from (the session bundle pins `import.meta.url`). */
export function moireRoot(): string {
  return (
    process.env.MOIRE_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
  );
}

export function trustedApps(root = moireRoot()) {
  const app = (name: string, launcher: string): TrustedApp => ({
    name,
    command: path.basename(launcher),
    file: path.join(root, launcher),
  });
  return {
    screenshot: app("Screenshot", "apps/bundled/screenshot/moire-screenshot"),
    settings: app("Settings", "apps/core/settings/moire-settings"),
  };
}

/** One argument for `parseDesktopCommand`, single-quoted. */
function quote(argument: string): string {
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

/**
 * When `exec` launches one of `apps` (by bare launcher name or by its absolute path), the command
 * to run instead, with the launcher's absolute file, and that file for the launch record.
 * Null for everything else, which is spawned as asked. A trusted launcher that is missing from
 * the install tree is not pinned, so its launches never pass the gate.
 */
export function pinTrustedLaunch(
  exec: string,
  apps: readonly TrustedApp[],
  exists: (file: string) => boolean = (file) => fs.existsSync(file),
): { exec: string; file: string } | null {
  let argv: string[];
  try {
    argv = parseDesktopCommand(exec);
  } catch {
    return null;
  }
  const [first, ...args] = argv;
  const app = apps.find((candidate) =>
    first!.includes("/")
      ? path.isAbsolute(first!) && path.normalize(first!) === candidate.file
      : first === candidate.command,
  );
  if (!app || !exists(app.file)) return null;
  return { exec: [app.file, ...args].map(quote).join(" "), file: app.file };
}

export type LaunchGate = (
  bus: SessionBus,
  sender: string | undefined,
  app: TrustedApp,
) => Promise<boolean>;

/**
 * Whether the sender of a call is `app`: its connection's pid is, or descends from, a pinned
 * launch of that app's launcher, and is still in the session that launch leads (the compositor
 * starts every app with setsid). What the app spawns detached is not the app: Screenshot's "Show
 * in Files" runs `xdg-open`, which runs whatever directory handler the user's mimeapps.list
 * names, in a session of its own. A sender that is gone, unknown, or anything else is not `app`.
 */
export function launchGate(options: {
  launches: LaunchRecords;
  inspector?: ProcessInspector;
  /** The kernel's pid for a bus connection; the bus daemon's answer by default (a smoke seam). */
  peerPid?: (bus: SessionBus, sender: string) => Promise<number>;
}): LaunchGate {
  const inspector = options.inspector ?? procInspector;
  const peerPid = options.peerPid ?? ((bus, sender) => busPeerPid(bus, sender));
  return async (bus, sender, app) => {
    if (!sender) return false;
    const pid = await peerPid(bus, sender).catch(() => Number.NaN);
    if (!Number.isSafeInteger(pid) || pid <= 1) return false;
    const root = options.launches.rootOf(pid, inspector);
    return (
      root !== null &&
      root.file === app.file &&
      inspector.session !== undefined &&
      inspector.session(pid) === root.pid
    );
  };
}

/**
 * `method`, answered only for callers `gate` says are `app`; everyone else gets AccessDenied
 * with `refusal`, before the method runs.
 */
export function restrictTo(
  bus: SessionBus,
  gate: LaunchGate,
  app: TrustedApp,
  refusal: string,
  method: DbusMethod,
): DbusMethod {
  return {
    ...method,
    handler: async (context) => {
      if (!(await gate(bus, context.message.sender, app)))
        throw new DbusRemoteError(ACCESS_DENIED, refusal);
      return method.handler(context);
    },
  };
}

/**
 * Present (root's, read-only) only in a test image: `moire.testing.displayControl`
 * (nix/moire-testing.nix). The shipped image has no such file.
 */
export const TEST_CONTROL_ENABLED = "/etc/moire/testing/display-control";
/**
 * Root writes `<pid> <start time>` here, naming its own process, for the length of one script
 * run; that process's descendants may change the display configuration meanwhile.
 */
export const TEST_CONTROL_GRANT = "/run/moire-test/display-control";
/** A grant left behind (a script killed before its cleanup) is ignored after this long. */
const TEST_GRANT_MAX_AGE_MS = 10 * 60_000;
const MAX_ANCESTORS = 64;

export type FileFacts = {
  uid: number;
  mode: number;
  file: boolean;
  directory: boolean;
  mtimeMs: number;
};

function fileFacts(file: string, follow: boolean): FileFacts | null {
  try {
    const stat = follow ? fs.statSync(file) : fs.lstatSync(file);
    return {
      uid: stat.uid,
      mode: stat.mode,
      file: stat.isFile(),
      directory: stat.isDirectory(),
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

/** Owned by root and writable by nobody else. */
const rootOnly = (facts: FileFacts | null) =>
  facts !== null && facts.uid === 0 && (facts.mode & 0o022) === 0;

/**
 * Test images only. A caller passes when the image enables test control (`TEST_CONTROL_ENABLED`,
 * a root-owned file from the nix store) and the caller descends from the process root named in
 * a fresh, root-owned grant (`TEST_CONTROL_GRANT`, in a root-owned directory), and that process
 * is still the same one (start time) and still root's.
 *
 * No user process can satisfy this: it can't write either file, and it can't make itself a
 * descendant of a root process (an orphan is adopted by init or a subreaper, never by the
 * script). There is no environment variable or argument a caller could set.
 */
export function testControlGate(
  options: {
    enabledFile?: string;
    grantFile?: string;
    inspector?: ProcessInspector;
    peerPid?: (bus: SessionBus, sender: string) => Promise<number>;
    facts?: (file: string, follow: boolean) => FileFacts | null;
    read?: (file: string) => string | null;
    processUid?: (pid: number) => number | null;
    now?: () => number;
  } = {},
): (bus: SessionBus, sender: string | undefined) => Promise<boolean> {
  const enabledFile = options.enabledFile ?? TEST_CONTROL_ENABLED;
  const grantFile = options.grantFile ?? TEST_CONTROL_GRANT;
  const inspector = options.inspector ?? procInspector;
  const peerPid = options.peerPid ?? ((bus, sender) => busPeerPid(bus, sender));
  const facts = options.facts ?? fileFacts;
  const read =
    options.read ??
    ((file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    });
  const processUid =
    options.processUid ??
    ((pid) => {
      try {
        return fs.statSync(`/proc/${pid}`).uid;
      } catch {
        return null;
      }
    });
  const now = options.now ?? Date.now;
  return async (bus, sender) => {
    // The image's switch: the nix store's file behind /etc's link, so following it is right.
    const enabled = facts(enabledFile, true);
    if (!enabled?.file || !rootOnly(enabled)) return false;
    const grant = facts(grantFile, false);
    if (!grant?.file || !rootOnly(grant) || !rootOnly(facts(path.dirname(grantFile), false)))
      return false;
    if (Math.abs(now() - grant.mtimeMs) > TEST_GRANT_MAX_AGE_MS) return false;
    const match = /^([1-9][0-9]{0,9}) ([1-9][0-9]{0,19})\n?$/.exec(read(grantFile) ?? "");
    if (!match || !sender) return false;
    const holder = Number(match[1]);
    if (
      processUid(holder) !== 0 ||
      inspector.startTime === undefined ||
      String(inspector.startTime(holder)) !== match[2]
    )
      return false;
    const pid = await peerPid(bus, sender).catch(() => Number.NaN);
    if (!Number.isSafeInteger(pid) || pid <= 1) return false;
    let current: number | null = pid;
    for (let depth = 0; current !== null && current > 1 && depth < MAX_ANCESTORS; depth++) {
      if (current === holder) return true;
      current = inspector.parent(current);
    }
    return false;
  };
}

/** `gate`, or failing it the test-image grant (`testControlGate`). */
export function orTestControl(
  gate: LaunchGate,
  test: (bus: SessionBus, sender: string | undefined) => Promise<boolean>,
): LaunchGate {
  return async (bus, sender, app) => (await gate(bus, sender, app)) || (await test(bus, sender));
}

export const CAPTURE_REFUSAL = "Screen capture is limited to the Screenshot app";
export const DISPLAY_CONFIG_REFUSAL = "Display configuration is limited to Settings";
