/**
 * moire-dm broker entry (root, one per seat). Only images built with
 * `moire.dm.backend = "moire-dm"` run it.
 *
 * Paths come from the systemd unit's fixed environment (set by the Nix wrapper), never from
 * the greeter. The broker reads no greeter bytes: it starts the unprivileged front, which owns
 * the greeter socket.
 */
import fs from "node:fs";
import path from "node:path";
import { publishStageHandoff, readBootFrame, requestBootRelease } from "@moire/sys/boot-handoff";
import { listSeatSessions } from "@moire/sys/login-sessions";
import { lookupAccount } from "@moire/sys/privilege";
import { AUTOLOGIN_PATH, loadAutologin } from "./autologin-file";
import { parseConfig, type Autologin, type DmConfig } from "./config";
import { createDaemon } from "./daemon";
import { processFrontLauncher, processWorkerLauncher } from "./process-launcher";
import { SEAT, seatSnapshot } from "./seat";
import type { LogEntry } from "./state";

const CONFIG_PATH = "/etc/moire-dm/config.json";
const RUNTIME_DIR = "/run/moire-dm";
/**
 * On tmpfs: present once the first broker of this boot has decided about automatic login, so a
 * restart, a crash or a logout never signs anyone in again until the next boot.
 */
const AUTOLOGIN_MARKER = `${RUNTIME_DIR}/autologin-attempted`;
/** Root-only files until something is deliberately handed to another account. */
const PRIVATE_UMASK = 0o077;
/** The front's socket directory: the front owns it, only the greeter group may enter. */
const FRONT_DIR_MODE = 0o750;
/**
 * V8 hardening the unit starts the broker with, passed on to the front, workers and exec helper.
 * --jitless was verified with koffi (PAM conversation callbacks, execve) on Linux. --jitless
 * already turns WebAssembly off; --no-expose-wasm says so explicitly, which also stops V8 warning
 * that it overrode the default ("disabling flag --expose_wasm due to conflicting flags").
 */
const HARDENING_FLAGS = new Set([
  "--jitless",
  "--no-expose-wasm",
  "--disallow-code-generation-from-strings",
  "--disable-proto=throw",
]);
const nodeFlags = process.execArgv.filter((flag) => HARDENING_FLAGS.has(flag));

function fatal(message: string): never {
  console.error(`moire-dm: ${message}`);
  process.exit(1);
}

function log(entry: LogEntry): void {
  const fields = [`code=${entry.code}`];
  if (entry.user) fields.push(`user=${entry.user}`);
  if (entry.detail) fields.push(`detail=${entry.detail}`);
  console.log(`moire-dm: ${fields.join(" ")}`);
}

/**
 * Automatic login is decided once per boot, by the first broker: the marker is written before the
 * state is even read, so "off at boot, turned on later, then a restart" stays off too.
 */
function bootAutologin(config: DmConfig, writerUid: number): Autologin {
  if (fs.existsSync(AUTOLOGIN_MARKER)) return { kind: "disabled" };
  fs.writeFileSync(AUTOLOGIN_MARKER, "");
  return loadAutologin(config, AUTOLOGIN_PATH, writerUid);
}

if (process.getuid?.() !== 0) fatal("must run as root");
const workerEntry = process.env.MOIRE_DM_WORKER_ENTRY;
const execEntry = process.env.MOIRE_DM_EXEC_ENTRY;
const frontEntry = process.env.MOIRE_DM_FRONT_ENTRY;
if (!workerEntry || !execEntry || !frontEntry) fatal("entries are not configured");
process.umask(PRIVATE_UMASK);

let config: DmConfig | null = null;
try {
  config = parseConfig(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch {
  // Reported below.
}
if (!config) fatal("configuration is missing or invalid");
const greeter = lookupAccount(config.greeter.user);
const frontAccount = lookupAccount(config.frontUser);
if (!greeter || greeter.uid === 0) fatal("greeter account is missing");
if (!frontAccount || frontAccount.uid === 0) fatal("front account is missing");
const settingsWriter = lookupAccount("moire-dm-settings");

fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o755 });
const frontDir = path.dirname(config.socket);
fs.mkdirSync(frontDir, { recursive: true });
fs.chownSync(frontDir, frontAccount.uid, greeter.gid);
fs.chmodSync(frontDir, FRONT_DIR_MODE);

const libraryPath: Record<string, string> = process.env.LD_LIBRARY_PATH
  ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH }
  : {};
const daemon = createDaemon({
  config,
  launchFront: processFrontLauncher({
    entry: [...nodeFlags, frontEntry],
    uid: frontAccount.uid,
    gid: frontAccount.gid,
    env: {
      MOIRE_DM_FRONT_SOCKET: config.socket,
      MOIRE_DM_GREETER_UID: String(greeter.uid),
      ...libraryPath,
    },
  }),
  launchWorker: processWorkerLauncher({
    entry: [...nodeFlags, workerEntry],
    env: {
      MOIRE_DM_EXEC_ENTRY: execEntry,
      MOIRE_DM_NODE_FLAGS: nodeFlags.join(" "),
      MOIRE_DM_SESSION_PATH: config.path,
      ...libraryPath,
    },
  }),
  autologin: () => bootAutologin(config, settingsWriter?.uid ?? 0),
  // The boot stage drops master and leaves its frame up; republished as a stage handoff (as the
  // greeter does at login), the desktop seeds its first modeset with it, so there is no blank.
  async releaseBootDisplay() {
    try {
      const release = await requestBootRelease(3000);
      if (!release) return;
      const frame = readBootFrame(release, release.width, release.height);
      const { frame: _name, ...clock } = release;
      const published = frame ? publishStageHandoff(clock, frame) : false;
      log({ code: "boot-display-released", detail: published ? "frame" : "no-frame" });
    } catch {
      // No boot stage to release: the desktop opens the display as after a logout.
    }
  },
  observeSeat: () => seatSnapshot(listSeatSessions(SEAT)),
  signalLeader(pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  },
  log,
  onExit: (status) => process.exit(status),
});
process.on("SIGTERM", () => daemon.shutdown());
process.on("SIGINT", () => daemon.shutdown());
await daemon.start();
