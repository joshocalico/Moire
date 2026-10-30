/**
 * The session side of the lock screen: who is locked, how their password is checked, and the
 * lock state on D-Bus (`org.moire.Lock1` on the compositor's `org.moire.Display1` name).
 *
 * The password is checked with pam_unix's `unix_chkpwd` for the session user only, through the
 * shared checker the management service also uses (stdin only, never argv or the environment)
 * and its throttle: a failure costs 2 s and five in a row lock checks for a minute. The checker
 * runs as a child process, so the compositor's frame loop never waits on it.
 */
import fs from "node:fs";
import os from "node:os";
import type { LockAuthenticator, LockAuthResult } from "@moire/core";
import type { SessionBus } from "@moire/dbus";
import {
  createPasswordThrottle,
  createUnixPasswordChecker,
  type PasswordChecker,
  type PasswordThrottle,
} from "@moire/system-management/password-check";

export const LOCK_PATH = "/org/moire/Lock1";
export const LOCK_INTERFACE = "org.moire.Lock1";

export type LockUser = { name: string; username: string };

/** The session user, with the GECOS full name from the passwd database when there is one. */
export function lockUser(passwd = "/etc/passwd"): LockUser {
  const info = os.userInfo();
  let name = "";
  try {
    for (const line of fs.readFileSync(passwd, "utf8").split("\n")) {
      const fields = line.split(":");
      if (fields[0] !== info.username || Number(fields[2]) !== info.uid) continue;
      name = (fields[4] ?? "").split(",")[0]!.trim();
      break;
    }
  } catch {
    // No readable passwd (NSS-only accounts): the username stands in.
  }
  return { name: name.slice(0, 128), username: info.username };
}

/**
 * Check the session user's password, throttled. Never logs; the checker wipes its own copy of
 * the bytes once written to the helper, and the lock wipes `secret` after the verdict.
 */
export function createLockAuthenticator(options: {
  username: string;
  checker?: PasswordChecker;
  throttle?: PasswordThrottle;
  now?: () => number;
}): LockAuthenticator {
  const checker = options.checker ?? createUnixPasswordChecker();
  const throttle = options.throttle ?? createPasswordThrottle();
  const now = options.now ?? Date.now;
  return async (secret): Promise<LockAuthResult> => {
    const verdict = await throttle.run(() => checker(options.username, secret));
    if (verdict !== "rate_limited") return { verdict };
    const retryAt = throttle.retryAt();
    return { verdict, retryInMs: retryAt === null ? 1000 : Math.max(1000, retryAt - now()) };
  };
}

export type LockStatusTarget = {
  readonly locked: boolean;
  lockSession(reason: "dbus"): Promise<boolean>;
  onLockChanged(listener: (locked: boolean) => void): () => void;
};

/**
 * `GetLocked() → b`, `Lock() → b` (true once a locked frame is on screen) and the
 * `LockedChanged(b)` signal. There is deliberately no Unlock: only the password, or logind's
 * Unlock for the session, ends a lock.
 */
export function exportLockStatus(bus: SessionBus, target: LockStatusTarget): () => void {
  const unexport = bus.exportObject(LOCK_PATH, {
    name: LOCK_INTERFACE,
    methods: {
      GetLocked: {
        inSignature: "",
        outSignature: "b",
        handler: () => ({ body: [target.locked] }),
      },
      Lock: {
        inSignature: "",
        outSignature: "b",
        handler: async () => ({ body: [await target.lockSession("dbus")] }),
      },
    },
  });
  const unlisten = target.onLockChanged((locked) =>
    bus.emitSignal({
      path: LOCK_PATH,
      interface: LOCK_INTERFACE,
      member: "LockedChanged",
      signature: "b",
      body: [locked],
    }),
  );
  return () => {
    unlisten();
    unexport();
  };
}
