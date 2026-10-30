/**
 * libc account lookup, privilege drop and exec for moire-dm's session launcher.
 *
 * Imported only through `@moire/sys/privilege` by the short-lived launcher process that turns a
 * root process into the user's session; not re-exported from the package index. Node's own
 * `child_process` uid/gid options cannot be used for this: libuv calls setgroups(0, NULL), so the
 * session would lose its supplementary groups (wheel, video, audio...), and there is no hook for
 * setsid/TIOCSCTTY or signal-disposition reset between fork and exec.
 */
import koffi from "koffi";
import { bindNativeFunction, type NativeFunction } from "./ffi";

/** Linux asm-generic ioctl: make the given terminal our controlling terminal. */
const TIOCSCTTY = 0x540e;
const SIG_SETMASK = 2;
/** glibc's sigset_t is 1024 bits. */
const SIGSET_BYTES = 128;
/** Every classic signal except SIGKILL (9) and SIGSTOP (19), whose dispositions can't change. */
const RESETTABLE_SIGNALS = Array.from({ length: 31 }, (_, index) => index + 1).filter(
  (signal) => signal !== 9 && signal !== 19,
);
/** getpwnam_r scratch; NSS entries are small, and a lookup that needs more is refused. */
const PASSWD_BUFFER_BYTES = 16384;

export type Account = Readonly<{
  name: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
}>;

export type DropStep = "initgroups" | "setresgid" | "setresuid" | "verify";
export type DropResult = Readonly<{ ok: true }> | Readonly<{ ok: false; step: DropStep }>;

type Bindings = {
  getpwnamR: NativeFunction<
    [name: string, entry: Record<string, unknown>, buffer: Buffer, length: number, out: unknown[]],
    number
  >;
  initgroups: NativeFunction<[user: string, group: number], number>;
  setresgid: NativeFunction<[real: number, effective: number, saved: number], number>;
  setresuid: NativeFunction<[real: number, effective: number, saved: number], number>;
  getresgid: NativeFunction<[real: number[], effective: number[], saved: number[]], number>;
  getresuid: NativeFunction<[real: number[], effective: number[], saved: number[]], number>;
  setsid: NativeFunction<[], number>;
  ioctlInt: NativeFunction<[fd: number, request: number, argument: number], number>;
  dup2: NativeFunction<[from: number, to: number], number>;
  close: NativeFunction<[fd: number], number>;
  signal: NativeFunction<[signal: number, handler: null], unknown>;
  sigprocmask: NativeFunction<[how: number, set: Buffer, old: null], number>;
  execve: NativeFunction<[path: string, argv: (string | null)[], envp: (string | null)[]], number>;
};

// Registered by name for the getpwnam_r declaration below.
koffi.struct("moire_passwd", {
  pw_name: "const char *",
  pw_passwd: "const char *",
  pw_uid: "uint32_t",
  pw_gid: "uint32_t",
  pw_gecos: "const char *",
  pw_dir: "const char *",
  pw_shell: "const char *",
});

let bindings: Bindings | null = null;

function load(): Bindings {
  if (bindings) return bindings;
  const libc = koffi.load("libc.so.6");
  bindings = {
    getpwnamR: bindNativeFunction(
      libc,
      "int getpwnam_r(const char *name, _Out_ moire_passwd *pwd, uint8_t *buf, size_t buflen, _Out_ void **result)",
    ),
    initgroups: bindNativeFunction(libc, "int initgroups(const char *user, uint32_t group)"),
    setresgid: bindNativeFunction(
      libc,
      "int setresgid(uint32_t rgid, uint32_t egid, uint32_t sgid)",
    ),
    setresuid: bindNativeFunction(
      libc,
      "int setresuid(uint32_t ruid, uint32_t euid, uint32_t suid)",
    ),
    getresgid: bindNativeFunction(
      libc,
      "int getresgid(_Out_ uint32_t *rgid, _Out_ uint32_t *egid, _Out_ uint32_t *sgid)",
    ),
    getresuid: bindNativeFunction(
      libc,
      "int getresuid(_Out_ uint32_t *ruid, _Out_ uint32_t *euid, _Out_ uint32_t *suid)",
    ),
    setsid: bindNativeFunction(libc, "int setsid(void)"),
    ioctlInt: bindNativeFunction(libc, "int ioctl(int fd, unsigned long request, int argument)"),
    dup2: bindNativeFunction(libc, "int dup2(int oldfd, int newfd)"),
    close: bindNativeFunction(libc, "int close(int fd)"),
    signal: bindNativeFunction(libc, "void *signal(int signum, void *handler)"),
    sigprocmask: bindNativeFunction(
      libc,
      "int sigprocmask(int how, const uint8_t *set, uint8_t *oldset)",
    ),
    execve: bindNativeFunction(
      libc,
      "int execve(const char *path, const char **argv, const char **envp)",
    ),
  };
  return bindings;
}

/** NSS lookup by name (files, systemd-userdb...). Null when absent or unreadable. */
export function lookupAccount(name: string): Account | null {
  const native = load();
  const entry: Record<string, unknown> = {};
  const scratch = Buffer.alloc(PASSWD_BUFFER_BYTES);
  const out: unknown[] = [null];
  const status = native.getpwnamR(name, entry, scratch, scratch.byteLength, out);
  if (status !== 0 || out[0] === null) return null;
  const { pw_name, pw_uid, pw_gid, pw_dir, pw_shell } = entry;
  if (
    typeof pw_name !== "string" ||
    typeof pw_uid !== "number" ||
    typeof pw_gid !== "number" ||
    typeof pw_dir !== "string" ||
    typeof pw_shell !== "string"
  )
    return null;
  return { name: pw_name, uid: pw_uid, gid: pw_gid, home: pw_dir, shell: pw_shell };
}

function ids(read: Bindings["getresuid"]): [number, number, number] | null {
  const real = [0];
  const effective = [0];
  const saved = [0];
  if (read(real, effective, saved) !== 0) return null;
  return [real[0]!, effective[0]!, saved[0]!];
}

/**
 * initgroups → setresgid → setresuid, then prove the drop is irreversible.
 * Order matters: groups and gid can only be changed while still uid 0, and setresuid (unlike
 * setuid in some edge cases) clears the saved set-user-ID too, so root can't be regained.
 */
export function dropPrivileges(account: Account): DropResult {
  const native = load();
  if (account.uid === 0 || account.gid === 0) return { ok: false, step: "verify" };
  if (native.initgroups(account.name, account.gid) !== 0) return { ok: false, step: "initgroups" };
  if (native.setresgid(account.gid, account.gid, account.gid) !== 0)
    return { ok: false, step: "setresgid" };
  if (native.setresuid(account.uid, account.uid, account.uid) !== 0)
    return { ok: false, step: "setresuid" };
  const uids = ids(native.getresuid);
  const gids = ids(native.getresgid);
  if (
    !uids ||
    !gids ||
    uids.some((id) => id !== account.uid) ||
    gids.some((id) => id !== account.gid) ||
    // Regaining root must fail; success here would mean the drop was not real.
    native.setresuid(0, 0, 0) === 0
  )
    return { ok: false, step: "verify" };
  return { ok: true };
}

/** setsid(): a new session and process group, detached from moire-dm's terminal. */
export function becomeSessionLeader(): boolean {
  return load().setsid() >= 0;
}

/** Make `fd` (an open VT) the controlling terminal and the session's stdin. */
export function takeTerminal(fd: number): boolean {
  const native = load();
  return native.ioctlInt(fd, TIOCSCTTY, 0) === 0 && native.dup2(fd, 0) === 0;
}

export function closeDescriptor(fd: number): void {
  load().close(fd);
}

/**
 * Node ignores SIGPIPE and may block signals; ignored dispositions and the mask survive execve,
 * so a session started straight from Node would inherit them. Reset both to the defaults.
 */
export function resetSignals(): boolean {
  const native = load();
  for (const signal of RESETTABLE_SIGNALS) native.signal(signal, null);
  return native.sigprocmask(SIG_SETMASK, Buffer.alloc(SIGSET_BYTES), null) === 0;
}

/**
 * execve() with an explicit environment; no PATH search, no shell. Returns only on failure,
 * in which case the caller must exit rather than continue as the user in a half-built state.
 */
export function execute(path: string, argv: readonly string[], env: readonly string[]): void {
  load().execve(path, [...argv, null], [...env, null]);
}

/** SO_PEERCRED for the daemon's greeter socket, without pulling in the rest of @moire/sys. */
export { peerCredentials, type PeerCredentials } from "./libc";
