import koffi from "koffi";
import { assertLinux } from "./platform";
import { bindNativeFunction } from "./ffi";
import { getLibc } from "./libc";
import { LinuxReadinessDispatcher } from "./readiness";

/** Descriptors belong to the seat backend; consumers must never close them directly. */
export interface SeatDeviceAccess {
  open(path: string): number;
  close(fd: number): void;
}
export interface SeatBackend {
  open(path: string): { id: number; fd: number };
  close(id: number): void;
  closeSeat(): void;
}

/** Ownership accounting is independent of the native transport. */
export class SeatDeviceLeases implements SeatDeviceAccess {
  private state: "inactive" | "active" | "closed" = "inactive";
  private readonly devices = new Map<number, number>();
  constructor(private readonly backend: SeatBackend) {}
  get active(): boolean {
    return this.state === "active";
  }
  enable(): void {
    if (this.state === "closed") throw new Error("Seat is closed");
    this.state = "active";
  }
  disable(): void {
    if (this.state !== "closed") this.state = "inactive";
  }
  open(path: string): number {
    if (!this.active) throw new Error("Seat is not active");
    const { id, fd } = this.backend.open(path);
    if (id < 0 || fd < 0 || this.devices.has(fd)) throw new Error("Invalid seat descriptor lease");
    this.devices.set(fd, id);
    return fd;
  }
  close(fd: number): void {
    const id = this.devices.get(fd);
    if (id === undefined) throw new Error("Descriptor is not owned by this seat");
    this.backend.close(id);
    this.devices.delete(fd);
  }
  shutdown(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    const errors: unknown[] = [];
    for (const fd of this.devices.keys()) {
      try {
        this.close(fd);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.backend.closeSeat();
    } catch (error) {
      errors.push(error);
    }
    this.devices.clear();
    if (errors.length) throw new AggregateError(errors, "Seat release failed");
  }
}

export type LogindSeat = SeatDeviceLeases & {
  acknowledgeDisable(): void;
  setGraphics(enabled: boolean): void;
};

/** Open only the logind backend, in the caller's actual greetd PAM session. */
export async function openLogindSeat(onRevoked: () => void): Promise<LogindSeat> {
  assertLinux("logind seat");
  if (process.env.LIBSEAT_BACKEND !== "logind") throw new Error("Explicit logind backend required");
  const library = koffi.load("libseat.so.1");
  const callback = koffi.proto("void moire_seat_callback(void *seat, void *userdata)");
  const listener = koffi.struct("moire_seat_listener", {
    enable_seat: koffi.pointer(callback),
    disable_seat: koffi.pointer(callback),
  });
  void listener;
  const openSeat = bindNativeFunction<(listener: unknown, userdata: unknown) => unknown>(
    library,
    "void *libseat_open_seat(const moire_seat_listener *listener, void *userdata)",
  );
  const closeSeat = bindNativeFunction<(seat: unknown) => number>(
    library,
    "int libseat_close_seat(void *seat)",
  );
  const openDevice = bindNativeFunction<(seat: unknown, path: string, fd: number[]) => number>(
    library,
    "int libseat_open_device(void *seat, const char *path, _Out_ int *fd)",
  );
  const closeDevice = bindNativeFunction<(seat: unknown, id: number) => number>(
    library,
    "int libseat_close_device(void *seat, int id)",
  );
  const disableSeat = bindNativeFunction<(seat: unknown) => number>(
    library,
    "int libseat_disable_seat(void *seat)",
  );
  const getFd = bindNativeFunction<(seat: unknown) => number>(
    library,
    "int libseat_get_fd(void *seat)",
  );
  const dispatch = bindNativeFunction<(seat: unknown, timeout: number) => number>(
    library,
    "int libseat_dispatch(void *seat, int timeout)",
  );
  const fcntl = bindNativeFunction<(fd: number, operation: number, value: number) => number>(
    getLibc(),
    "int fcntl(int fd, int operation, int value)",
  );
  const ttyName = bindNativeFunction<(fd: number) => string | null>(
    getLibc(),
    "const char *ttyname(int fd)",
  );
  const ttyIoctl = bindNativeFunction<(fd: number, operation: number, value: number) => number>(
    getLibc(),
    "int ioctl(int fd, unsigned long operation, unsigned long value)",
  );
  let pointer: unknown = null;
  let readiness: LinuxReadinessDispatcher | undefined;
  let revoked = false;
  const leases = new SeatDeviceLeases({
    open(path) {
      const result = [-1];
      const id = openDevice(pointer, path, result);
      if (id < 0 || result[0]! < 0) throw new Error("logind device acquisition failed");
      const fd = result[0]!;
      const flags = fcntl(fd, 3, 0);
      if (flags < 0 || fcntl(fd, 4, flags | 0x800) < 0 || fcntl(fd, 2, 1) < 0) {
        closeDevice(pointer, id);
        throw new Error("Cannot configure seat descriptor");
      }
      return { id, fd };
    },
    close(id) {
      if (closeDevice(pointer, id) !== 0) throw new Error("logind device release failed");
    },
    closeSeat() {
      readiness?.stop();
      if (pointer !== null && closeSeat(pointer) !== 0)
        throw new Error("logind seat release failed");
      pointer = null;
      koffi.unregister(enabled);
      koffi.unregister(disabled);
    },
  });
  const notifyRevoked = () => {
    leases.disable();
    if (!revoked) {
      revoked = true;
      queueMicrotask(onRevoked);
    }
  };
  const enabled = koffi.register(() => {
    // Never resume revoked descriptors; retire this owner and let greetd start a fresh one.
    if (revoked) return;
    leases.enable();
  }, koffi.pointer(callback));
  const disabled = koffi.register(notifyRevoked, koffi.pointer(callback));
  const seat = Object.assign(leases, {
    setGraphics(enabled: boolean) {
      if (ttyName(0) !== "/dev/tty1" || ttyIoctl(0, 0x4b3a, enabled ? 1 : 0) !== 0)
        throw new Error("Cannot change owned greetd terminal mode");
    },
    acknowledgeDisable() {
      if (pointer !== null && disableSeat(pointer) !== 0)
        throw new Error("Seat disable acknowledgement failed");
    },
  });
  try {
    pointer = openSeat({ enable_seat: enabled, disable_seat: disabled }, null);
    if (pointer === null) throw new Error("Cannot acquire logind seat");
    const fd = getFd(pointer);
    if (fd < 0) throw new Error("Seat event descriptor unavailable");
    readiness = new LinuxReadinessDispatcher("logind-seat");
    readiness.add(fd, () => {
      if (dispatch(pointer, 0) < 0) notifyRevoked();
    });
    if (dispatch(pointer, 0) < 0) throw new Error("Initial seat dispatch failed");
    const deadline = Date.now() + 3000;
    while (!seat.active && !revoked && Date.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    if (!seat.active) throw new Error("logind seat did not become active");
    return seat;
  } catch (error) {
    seat.shutdown();
    throw error;
  }
}
