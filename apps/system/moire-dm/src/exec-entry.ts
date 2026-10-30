/**
 * The exec helper: starts as root (child of a session worker), becomes the user, and replaces
 * itself with the session. Reads its ExecPlan from fd 3. Any failure exits 126 before exec;
 * nothing runs as the user unless every step succeeded.
 *
 *   setsid → open VT → TIOCSCTTY, VT as stdin → initgroups → setresgid → setresuid → verify
 *   → chdir(home) → umask → reset signals → close fd 3 → execve(argv, env)
 */
import fs from "node:fs";
import {
  becomeSessionLeader,
  closeDescriptor,
  dropPrivileges,
  execute,
  resetSignals,
  takeTerminal,
} from "@moire/sys/privilege";
import type { ExecPlan } from "./worker";

const PLAN_FD = 3;
const EXIT_SETUP_FAILED = 126;
const MAX_PLAN_BYTES = 256 * 1024;
const SESSION_UMASK = 0o022;
const TTY_PATH = /^\/dev\/tty[1-9][0-9]?$/;

function readPlan(): ExecPlan | null {
  let text: string;
  try {
    const buffer = fs.readFileSync(PLAN_FD);
    if (buffer.length > MAX_PLAN_BYTES) return null;
    text = buffer.toString("utf8");
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const plan = raw as ExecPlan;
  const account = plan?.account;
  const valid =
    !!account &&
    typeof account.name === "string" &&
    Number.isSafeInteger(account.uid) &&
    Number.isSafeInteger(account.gid) &&
    account.uid > 0 &&
    account.gid > 0 &&
    typeof account.home === "string" &&
    Array.isArray(plan.argv) &&
    plan.argv.length > 0 &&
    plan.argv.every((arg) => typeof arg === "string" && !arg.includes("\0")) &&
    plan.argv[0].startsWith("/") &&
    Array.isArray(plan.env) &&
    plan.env.every((entry) => typeof entry === "string" && !entry.includes("\0")) &&
    typeof plan.tty === "string" &&
    TTY_PATH.test(plan.tty);
  return valid ? plan : null;
}

function fail(step: string): never {
  // Step names only; the plan (environment included) is never printed.
  console.error(`moire-dm-exec: ${step} failed`);
  process.exit(EXIT_SETUP_FAILED);
}

const plan = readPlan();
if (!plan) fail("plan");
if (process.getuid?.() !== 0) fail("root");
if (!becomeSessionLeader()) fail("setsid");
let tty: number;
try {
  tty = fs.openSync(plan.tty, fs.constants.O_RDWR);
} catch {
  fail("tty");
}
if (!takeTerminal(tty)) fail("controlling-terminal");
if (tty !== 0) closeDescriptor(tty);
const dropped = dropPrivileges(plan.account);
if (!dropped.ok) fail(dropped.step);
try {
  process.chdir(plan.account.home);
} catch {
  // As login(1) does: a missing or unreadable home still logs in, at /.
  process.chdir("/");
}
process.umask(SESSION_UMASK);
if (!resetSignals()) fail("signals");
closeDescriptor(PLAN_FD);
execute(plan.argv[0], plan.argv, plan.env);
fail("exec");
