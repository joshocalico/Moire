/**
 * Verify the session user's own password with pam_unix's setuid helper, `unix_chkpwd`, the same
 * check pam_unix runs for unprivileged callers. The helper only verifies the caller's own
 * account; the password goes on its stdin (NUL-terminated), never in argv or the environment.
 *
 * The checker is the compositor's lock screen's. The management service uses only the `passwd`
 * changer and the throttle below, for changing one's own password; administrator actions are
 * authorized by polkit's prompt (docs/polkit-agent.md). Nothing here logs; callers must not log
 * passwords either.
 */
import { spawn } from "node:child_process";

/** NixOS's setuid wrapper (security.wrappers.unix_chkpwd). */
export const UNIX_CHKPWD = "/run/wrappers/bin/unix_chkpwd";
const PAM_SUCCESS = 0;
const PAM_AUTH_ERR = 7;

export type PasswordVerdict = "ok" | "wrong" | "unavailable";
/**
 * A password is a string (from D-Bus) or UTF-8 bytes. Bytes are never copied into a string, so a
 * caller that owns a zeroable buffer (the lock screen) can wipe it once the check has finished.
 */
export type PasswordChecker = (
  username: string,
  password: string | Uint8Array,
) => Promise<PasswordVerdict>;

export function createUnixPasswordChecker(
  options: { helper?: string; timeoutMs?: number } = {},
): PasswordChecker {
  const helper = options.helper ?? UNIX_CHKPWD;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return (username, password) =>
    new Promise<PasswordVerdict>((resolve) => {
      const hasNul = typeof password === "string" ? password.includes("\0") : password.includes(0);
      if (!/^[a-z_][a-z0-9_.-]{0,31}\$?$/.test(username) || hasNul) {
        resolve("wrong");
        return;
      }
      let settled = false;
      const finish = (verdict: PasswordVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(verdict);
      };
      // An empty environment: nothing about this request is inherited or exported.
      const child = spawn(helper, [username, "nonull"], {
        stdio: ["pipe", "ignore", "ignore"],
        env: {},
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish("unavailable");
      }, timeoutMs);
      timer.unref();
      child.once("error", () => finish("unavailable"));
      child.once("exit", (code) =>
        finish(code === PAM_SUCCESS ? "ok" : code === PAM_AUTH_ERR ? "wrong" : "unavailable"),
      );
      child.stdin.once("error", () => {});
      // One NUL-terminated copy for the pipe, wiped once written.
      const length = typeof password === "string" ? Buffer.byteLength(password) : password.length;
      const secret = Buffer.alloc(length + 1);
      if (typeof password === "string") secret.write(password, "utf8");
      else secret.set(password);
      child.stdin.end(secret, () => secret.fill(0));
    });
}

/**
 * Slow repeated guessing through the session service: every failure costs a delay, and five in
 * a row lock verification for a minute. Shared by every caller, so changing D-Bus connection
 * does not reset it.
 */
export function createPasswordThrottle(
  options: { now?: () => number; failureDelayMs?: number; limit?: number; lockoutMs?: number } = {},
) {
  const now = options.now ?? Date.now;
  const failureDelayMs = options.failureDelayMs ?? 2000;
  const limit = options.limit ?? 5;
  const lockoutMs = options.lockoutMs ?? 60_000;
  let failures = 0;
  let lockedUntil = 0;
  let busy = false;
  return {
    /** When checks are allowed again after a lockout (ms on the `now` clock), or null. */
    retryAt(): number | null {
      return now() < lockedUntil ? lockedUntil : null;
    },
    /** Run one check; a `wrong` verdict counts towards the lockout. */
    async run<V extends string>(check: () => Promise<V>): Promise<V | "rate_limited"> {
      if (busy || now() < lockedUntil) return "rate_limited";
      busy = true;
      try {
        const verdict = await check();
        if (verdict === "ok") failures = 0;
        else if (verdict === "wrong") {
          failures++;
          if (failures >= limit) {
            failures = 0;
            lockedUntil = now() + lockoutMs;
          }
          await new Promise((resolve) => setTimeout(resolve, failureDelayMs));
        }
        return verdict;
      } finally {
        busy = false;
      }
    },
  };
}
export type PasswordThrottle = ReturnType<typeof createPasswordThrottle>;

/** NixOS's setuid wrapper for shadow's passwd (PAM service `passwd`). */
export const PASSWD = "/run/wrappers/bin/passwd";
export type PasswordChangeVerdict = "ok" | "wrong" | "rejected" | "unavailable";
export type OwnPasswordChanger = (current: string, next: string) => Promise<PasswordChangeVerdict>;

/**
 * Change the session user's own password with `passwd`, which checks the current password
 * through PAM itself. No polkit grant is involved, so no other process can skip that check.
 * PAM's text conversation prompts on stderr and reads one answer per read(2), so each answer is
 * written only after its prompt arrives. Answers go on stdin; argv holds no secret.
 */
export function createPasswdChanger(
  options: { helper?: string; timeoutMs?: number } = {},
): OwnPasswordChanger {
  const helper = options.helper ?? PASSWD;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return (current, next) =>
    new Promise<PasswordChangeVerdict>((resolve) => {
      if (/[\0\n\r]/.test(current) || /[\0\n\r]/.test(next)) {
        resolve("rejected");
        return;
      }
      const answers = [current, next, next];
      let prompts = 0;
      let pending = "";
      let settled = false;
      const finish = (verdict: PasswordChangeVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        answers.fill("");
        resolve(verdict);
      };
      const child = spawn(helper, [], {
        stdio: ["pipe", "ignore", "pipe"],
        // C locale for English prompts; nothing else is inherited.
        env: { LC_ALL: "C", LANG: "C" },
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish("unavailable");
      }, timeoutMs);
      timer.unref();
      child.once("error", () => finish("unavailable"));
      child.stdin.once("error", () => {});
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        // Only prompts are inspected; nothing from passwd is logged.
        pending = (pending + chunk).slice(-512);
        if (!/password: ?$/i.test(pending)) return;
        pending = "";
        const answer = answers[prompts++];
        if (answer === undefined) {
          // A fourth prompt means PAM rejected the new password and is asking again.
          child.kill("SIGKILL");
          finish("rejected");
          return;
        }
        child.stdin.write(`${answer}\n`);
        if (prompts === answers.length) child.stdin.end();
      });
      child.once("close", (code) => {
        if (code === 0 && prompts === answers.length) finish("ok");
        // Exiting before the new-password prompt means PAM refused the current password.
        else if (prompts === 1) finish("wrong");
        else if (prompts > 1) finish("rejected");
        else finish("unavailable");
      });
    });
}
