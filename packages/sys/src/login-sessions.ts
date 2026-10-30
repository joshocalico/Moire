/**
 * Read-only logind session listing through libsystemd's sd-login (no D-Bus, no CLI).
 *
 * moire-dm uses it at start-up: after a restart it must find sessions it started before and
 * wait for them instead of drawing a greeter over a live desktop. Imported only through
 * `@moire/sys/login-sessions`.
 */
import koffi from "koffi";
import { bindNativeFunction, type NativeFunction } from "./ffi";

const POINTER_SIZE = 8;
/** A seat with more sessions than this is not a desktop seat we understand. */
const MAX_SESSIONS = 256;

export type LoginSession = Readonly<{
  id: string;
  /** "user", "greeter", "lock-screen", "background", ... */
  sessionClass: string | null;
  /** The PAM service that opened it. */
  service: string | null;
  /** "online", "active" or "closing". */
  state: string | null;
  /** The PID that called pam_open_session (for moire-dm, the session worker). */
  leader: number | null;
}>;

export type SeatSessions =
  | Readonly<{ ok: true; sessions: readonly LoginSession[] }>
  | Readonly<{ ok: false }>;

type Bindings = {
  seatSessions: NativeFunction<
    [seat: string, sessions: unknown[], uids: null, count: null],
    number
  >;
  sessionString: Record<
    "class" | "service" | "state",
    NativeFunction<[session: string, value: unknown[]], number>
  >;
  /** sd_session_get_leader exists since systemd 254; null on older libsystemd. */
  leader: NativeFunction<[session: string, pid: number[]], number> | null;
  free: NativeFunction<[pointer: unknown], void>;
};

let bindings: Bindings | null = null;

function load(): Bindings {
  if (bindings) return bindings;
  const systemd = koffi.load("libsystemd.so.0");
  const libc = koffi.load("libc.so.6");
  const getter = (name: string) =>
    bindNativeFunction<(session: string, value: unknown[]) => number>(
      systemd,
      `int ${name}(const char *session, _Out_ void **value)`,
    );
  bindings = {
    seatSessions: bindNativeFunction(
      systemd,
      "int sd_seat_get_sessions(const char *seat, _Out_ void **sessions, void *uids, void *n)",
    ),
    sessionString: {
      class: getter("sd_session_get_class"),
      service: getter("sd_session_get_service"),
      state: getter("sd_session_get_state"),
    },
    leader: optional(() =>
      bindNativeFunction(
        systemd,
        "int sd_session_get_leader(const char *session, _Out_ int *leader)",
      ),
    ),
    free: bindNativeFunction(libc, "void free(void *ptr)"),
  };
  return bindings;
}

function optional<T>(bind: () => T): T | null {
  try {
    return bind();
  } catch {
    return null;
  }
}

/** A malloc()ed C string from sd-login, decoded and freed. */
function takeString(native: Bindings, pointer: unknown): string | null {
  if (pointer === null) return null;
  const value = koffi.decode(pointer, "char", -1) as string;
  native.free(pointer);
  return value;
}

function read(
  native: Bindings,
  session: string,
  field: keyof Bindings["sessionString"],
): string | null {
  const out: unknown[] = [null];
  return native.sessionString[field](session, out) >= 0 ? takeString(native, out[0]) : null;
}

/** Every session logind knows on `seat`, or `ok: false` when logind can't be asked. */
export function listSeatSessions(seat: string): SeatSessions {
  let native: Bindings;
  try {
    native = load();
  } catch {
    return { ok: false };
  }
  const list: unknown[] = [null];
  const count = native.seatSessions(seat, list, null, null);
  if (count < 0) return { ok: false };
  const ids: string[] = [];
  if (list[0] !== null) {
    for (let index = 0; index < MAX_SESSIONS; index++) {
      const pointer = koffi.decode(list[0], index * POINTER_SIZE, "void *");
      if (pointer === null) break;
      const id = takeString(native, pointer);
      if (id) ids.push(id);
    }
    native.free(list[0]);
  }
  return {
    ok: true,
    sessions: ids.map((id) => {
      const leader = [0];
      return {
        id,
        sessionClass: read(native, id, "class"),
        service: read(native, id, "service"),
        state: read(native, id, "state"),
        leader:
          native.leader && native.leader(id, leader) >= 0 && leader[0]! > 0 ? leader[0]! : null,
      };
    }),
  };
}
