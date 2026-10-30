/**
 * The environment a session starts with. Built from scratch, never from moire-dm's own
 * process.env, so nothing of the root daemon (NODE_OPTIONS, NOTIFY_SOCKET, INVOCATION_ID,
 * LD_LIBRARY_PATH...) leaks into a user's session.
 *
 * Precedence, lowest first: fixed defaults, the PAM environment (pam_env, pam_systemd's
 * XDG_RUNTIME_DIR / XDG_SESSION_ID), then identity and session variables moire-dm owns, which
 * PAM modules may not override.
 */
import type { SessionSpec } from "./worker-channel";

export type EnvironmentAccount = Readonly<{
  name: string;
  uid: number;
  home: string;
  shell: string;
}>;

const MAX_ENTRIES = 256;
const MAX_ENTRY_BYTES = 8192;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** PAM may not set these; they would let a module redirect what the session loads. */
const FORBIDDEN_FROM_PAM = new Set(["LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "NODE_OPTIONS"]);

export type EnvironmentInput = Readonly<{
  account: EnvironmentAccount;
  session: SessionSpec;
  sessionClass: "user" | "greeter";
  vt: number;
  /** System PATH for sessions, from the trusted daemon configuration. */
  path: string;
  pamEnvironment: readonly string[];
  greeterSocket: string | null;
}>;

function split(entry: string): [string, string] | null {
  const equals = entry.indexOf("=");
  if (equals < 1 || entry.length > MAX_ENTRY_BYTES || entry.includes("\0")) return null;
  const name = entry.slice(0, equals);
  return NAME.test(name) ? [name, entry.slice(equals + 1)] : null;
}

export function sessionEnvironment(input: EnvironmentInput): string[] {
  const env = new Map<string, string>([
    ["PATH", input.path],
    ["LANG", "C.UTF-8"],
  ]);
  for (const entry of input.pamEnvironment.slice(0, MAX_ENTRIES)) {
    const pair = split(entry);
    if (pair && !FORBIDDEN_FROM_PAM.has(pair[0])) env.set(pair[0], pair[1]);
  }
  const owned: [string, string][] = [
    ["HOME", input.account.home],
    ["USER", input.account.name],
    ["LOGNAME", input.account.name],
    ["SHELL", input.account.shell],
    ["XDG_SEAT", "seat0"],
    ["XDG_VTNR", String(input.vt)],
    ["XDG_SESSION_TYPE", "wayland"],
    ["XDG_SESSION_CLASS", input.sessionClass],
    ["XDG_SESSION_DESKTOP", input.session.desktop],
    ["XDG_CURRENT_DESKTOP", input.session.desktop],
  ];
  // The greeter picks its client by which variable is set: MOIRE_DM_SOCK here, GREETD_SOCK
  // under greetd.
  if (input.sessionClass === "greeter" && input.greeterSocket)
    owned.push(["MOIRE_DM_SOCK", input.greeterSocket]);
  for (const [name, value] of owned) env.set(name, value);
  return [...env].map(([name, value]) => `${name}=${value}`);
}
