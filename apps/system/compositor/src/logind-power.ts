/**
 * The session's view of logind (sleep, power off, lock signals, idle and locked hints, and
 * inhibitors) and of UPower's lid switch, over the system bus.
 *
 * A logind inhibitor is a descriptor: Manager.Inhibit returns one end of a FIFO and the inhibitor
 * lasts until every copy is closed. The system-bus connection negotiates descriptor passing
 * through `@moire/sys/dbus-fds`, and the descriptor arrives close-on-exec, so apps the compositor
 * starts never inherit it. If the compositor dies the kernel closes it and logind lets go.
 */
import fs from "node:fs";
import { SessionBus, type DbusDisposer, type DbusMessage } from "@moire/dbus";
import { dbusUnixFdTransport } from "@moire/sys/dbus-fds";

export const LOGIND_BUS = "org.freedesktop.login1";
const MANAGER_PATH = "/org/freedesktop/login1";
const MANAGER = "org.freedesktop.login1.Manager";
const SESSION = "org.freedesktop.login1.Session";
const UPOWER = "org.freedesktop.UPower";
const UPOWER_PATH = "/org/freedesktop/UPower";
const PROPERTIES = "org.freedesktop.DBus.Properties";
export const SYSTEM_BUS_ADDRESS = "unix:path=/run/dbus/system_bus_socket";

export type LogindEvents = {
  /** PrepareForSleep: true before sleeping, false after waking. */
  prepareForSleep?(sleeping: boolean): void;
  /** The session's Lock (true) or Unlock (false) signal, e.g. from `loginctl lock-session`. */
  sessionLock?(lock: boolean): void;
  /** UPower's LidIsClosed changed. */
  lid?(closed: boolean): void;
};

export type LogindPower = {
  /** This process's logind session object, or null outside a session. */
  readonly session: string | null;
  /** CanSuspend / CanPowerOff / CanReboot answered "yes" (no interactive authorization needed). */
  readonly canSuspend: boolean;
  readonly canPowerOff: boolean;
  readonly canReboot: boolean;
  readonly lid: { present: boolean; closed: boolean };
  suspend(): Promise<void>;
  powerOff(): Promise<void>;
  reboot(): Promise<void>;
  setIdleHint(idle: boolean): Promise<void>;
  setLockedHint(locked: boolean): Promise<void>;
  /** Take a logind inhibitor; it holds until released, or until logind restarts (onLost). */
  inhibit(options: InhibitorOptions): InhibitorHold;
  dispose(): Promise<void>;
};

export type LogindPowerOptions = {
  events: LogindEvents;
  connect?: () => Promise<SessionBus>;
  pid?: number;
  timeoutMs?: number;
};

function objectPath(value: unknown): string {
  if (typeof value !== "string" || !/^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/.test(value))
    throw new Error("Invalid logind object path");
  return value;
}

function variantBoolean(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key] as { signature?: unknown; value?: unknown } | undefined;
  return value?.signature === "b" && value.value === true;
}

export async function connectLogindPower(options: LogindPowerOptions): Promise<LogindPower> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const bus = await (options.connect
    ? options.connect()
    : SessionBus.connect(SYSTEM_BUS_ADDRESS, {
        timeoutMs,
        ...(process.platform === "linux" ? { unixFds: dbusUnixFdTransport } : {}),
      }));
  const disposers: DbusDisposer[] = [];
  const call = (
    destination: string,
    path: string,
    iface: string,
    member: string,
    signature = "",
    body: unknown[] = [],
  ) => bus.call({ destination, path, interface: iface, member, signature, body }, { timeoutMs });
  const subscribe = async (
    sender: string,
    path: string,
    iface: string,
    member: string,
    listener: (message: DbusMessage) => void,
    arg0?: string,
  ) => {
    try {
      disposers.push(
        await bus.subscribeSignal(
          { sender, path, interface: iface, member, ...(arg0 ? { arg0 } : {}) },
          listener,
          { timeoutMs },
        ),
      );
    } catch {
      // A missing daemon leaves that signal unobserved; the rest still works.
    }
  };

  let session: string | null = null;
  try {
    const reply = await call(LOGIND_BUS, MANAGER_PATH, MANAGER, "GetSessionByPID", "u", [
      options.pid ?? process.pid,
    ]);
    session = objectPath(reply.body?.[0]);
  } catch {
    session = null;
  }
  const can = async (member: string) => {
    try {
      return (await call(LOGIND_BUS, MANAGER_PATH, MANAGER, member)).body?.[0] === "yes";
    } catch {
      return false;
    }
  };
  const [canSuspend, canPowerOff, canReboot] = await Promise.all([
    can("CanSuspend"),
    can("CanPowerOff"),
    can("CanReboot"),
  ]);

  await subscribe(LOGIND_BUS, MANAGER_PATH, MANAGER, "PrepareForSleep", (message) => {
    if (message.signature === "b") options.events.prepareForSleep?.(message.body?.[0] === true);
  });
  if (session) {
    const path = session;
    await subscribe(LOGIND_BUS, path, SESSION, "Lock", () => options.events.sessionLock?.(true));
    await subscribe(LOGIND_BUS, path, SESSION, "Unlock", () => options.events.sessionLock?.(false));
  }

  const lid = { present: false, closed: false };
  const readLid = async () => {
    try {
      const reply = await call(UPOWER, UPOWER_PATH, PROPERTIES, "GetAll", "s", [UPOWER]);
      const raw = reply.body?.[0] as Record<string, unknown> | undefined;
      if (reply.signature !== "a{sv}" || !raw || typeof raw !== "object") return;
      const closed = variantBoolean(raw, "LidIsClosed");
      lid.present = variantBoolean(raw, "LidIsPresent");
      if (lid.present && closed !== lid.closed) {
        lid.closed = closed;
        options.events.lid?.(closed);
      }
    } catch {
      lid.present = false;
    }
  };
  await subscribe(
    UPOWER,
    UPOWER_PATH,
    PROPERTIES,
    "PropertiesChanged",
    () => void readLid(),
    UPOWER,
  );
  await readLid();

  const sessionCall = async (member: string, value: boolean) => {
    if (!session) throw new Error("No logind session");
    await call(LOGIND_BUS, session, SESSION, member, "b", [value]);
  };

  // A logind restart drops every inhibitor it held; report each held one as lost.
  const holds = new Set<{ drop(): void }>();
  let logindOwner: string | null | undefined;
  try {
    disposers.push(
      await bus.watchName(
        LOGIND_BUS,
        (owner) => {
          if (logindOwner !== undefined && owner !== logindOwner)
            for (const hold of [...holds]) hold.drop();
          logindOwner = owner;
        },
        { timeoutMs },
      ),
    );
  } catch {
    // Without the watch a restart goes unnoticed; the inhibitors are still released on demand.
  }
  const inhibit = (inhibitor: InhibitorOptions): InhibitorHold => {
    let fd: number | null = null;
    let released = false;
    const entry = {
      drop() {
        if (fd === null) return;
        closeQuietly(fd);
        fd = null;
        holds.delete(entry);
        if (!released) inhibitor.onLost?.();
      },
    };
    const ready = call(LOGIND_BUS, MANAGER_PATH, MANAGER, "Inhibit", "ssss", [
      inhibitor.what,
      "Moire",
      inhibitor.why,
      inhibitor.mode,
    ]).then(
      (reply) => {
        const index = reply.body?.[0];
        const received =
          reply.signature === "h" && typeof index === "number" ? reply.fds?.[index] : undefined;
        for (const other of reply.fds ?? []) if (other !== received) closeQuietly(other);
        if (received === undefined) return false;
        if (released) {
          closeQuietly(received);
          return false;
        }
        fd = received;
        holds.add(entry);
        return true;
      },
      () => false,
    );
    return {
      ready,
      get held() {
        return fd !== null;
      },
      release() {
        released = true;
        entry.drop();
      },
    };
  };
  return {
    session,
    canSuspend,
    canPowerOff,
    canReboot,
    lid,
    async suspend() {
      await call(LOGIND_BUS, MANAGER_PATH, MANAGER, "Suspend", "b", [false]);
    },
    async powerOff() {
      await call(LOGIND_BUS, MANAGER_PATH, MANAGER, "PowerOff", "b", [false]);
    },
    async reboot() {
      await call(LOGIND_BUS, MANAGER_PATH, MANAGER, "Reboot", "b", [false]);
    },
    setIdleHint: (idle) => sessionCall("SetIdleHint", idle),
    setLockedHint: (locked) => sessionCall("SetLockedHint", locked),
    inhibit,
    async dispose() {
      await Promise.allSettled(disposers.map((dispose) => dispose()));
      bus.close();
    },
  };
}

function closeQuietly(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // Already closed.
  }
}

export type InhibitorHold = {
  /** Resolves true once logind granted the inhibitor, false if it was refused or failed. */
  readonly ready: Promise<boolean>;
  readonly held: boolean;
  release(): void;
};

export type InhibitorOptions = {
  /** logind's colon-separated lock types, e.g. "handle-lid-switch:handle-power-key". */
  what: string;
  why: string;
  mode: "block" | "delay";
  /** Called when a held inhibitor goes away without release() (logind restarted). */
  onLost?: () => void;
};
