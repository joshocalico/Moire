/** Production session worker entry: real libpam and NSS. Spawned by the daemon, never by hand. */
import { openPam } from "@moire/sys/pam";
import { lookupAccount } from "@moire/sys/privilege";
import { execHelperLauncher, runWorker } from "./worker";

const CHANNEL_FD = 3;

const execEntry = process.env.MOIRE_DM_EXEC_ENTRY;
const sessionPath = process.env.MOIRE_DM_SESSION_PATH;
const hardening = (process.env.MOIRE_DM_NODE_FLAGS ?? "")
  .split(" ")
  .filter((flag) => flag.startsWith("--"));
if (process.getuid?.() !== 0 || !execEntry || !sessionPath) process.exit(1);

process.exitCode = await runWorker({
  pam: openPam(),
  fd: CHANNEL_FD,
  confdir: null,
  path: sessionPath,
  lookupAccount,
  // The broker's V8 hardening flags, for the exec helper too (it runs as root until exec).
  launchSession: execHelperLauncher([...hardening, execEntry]),
});
