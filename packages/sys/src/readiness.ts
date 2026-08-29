import koffi from "koffi";
import { closeFd, getLibc } from "./libc";

const ENOENT = 2;
const EBADF = 9;
const EPOLL_CLOEXEC = 0x80000;
const EPOLL_CTL_ADD = 1;
const EPOLL_CTL_DEL = 2;
const EPOLLIN = 0x001;
const EPOLLERR = 0x008;
const EPOLLHUP = 0x010;
const EPOLLRDHUP = 0x2000;
const EFD_CLOEXEC = 0x80000;
const EFD_NONBLOCK = 0x800;
const READINESS_EVENTS = EPOLLIN | EPOLLERR | EPOLLHUP | EPOLLRDHUP;
const MAX_READY_EVENTS = 64;

const EpollEventFields = {
  events: "uint32_t",
  data: "uint64_t",
} as const;
const EpollEvent =
  process.arch === "arm64"
    ? koffi.struct("epoll_event_moire", EpollEventFields)
    : koffi.pack("epoll_event_moire", EpollEventFields);
const EpollEvents = koffi.array(EpollEvent, MAX_READY_EVENTS);

type NativeAsyncFunction = ((...args: unknown[]) => unknown) & {
  async: (...args: unknown[]) => void;
};

function freePtr(ptr: unknown): void {
  if (ptr == null) return;
  try {
    koffi.free(ptr);
  } catch {
    // best effort
  }
}

/** One architecture-aware Linux readiness queue backed by epoll + eventfd. */
export class LinuxReadinessDispatcher {
  private readonly epollFd: number;
  private readonly wakeFd: number;
  private readonly events = koffi.alloc(EpollEvents, 1);
  private readonly epollCtl: NativeAsyncFunction;
  private readonly epollWait: NativeAsyncFunction;
  private readonly write: NativeAsyncFunction;
  private readonly handlers = new Map<number, () => void>();
  private waiting = false;
  private stopped = false;
  private disposed = false;
  private reportedReady = false;

  constructor(private readonly label = "readiness") {
    const libc = getLibc();
    const epollCreate = libc.func("int epoll_create1(int flags)");
    const eventfd = libc.func("int eventfd(unsigned int initval, int flags)");
    this.epollCtl = libc.func(
      "int epoll_ctl(int epfd, int op, int fd, void *event)",
    ) as NativeAsyncFunction;
    this.epollWait = libc.func(
      "int epoll_wait(int epfd, void *events, int maxevents, int timeout)",
    ) as NativeAsyncFunction;
    this.write = libc.func(
      "long write(int fd, const void *buf, size_t count)",
    ) as NativeAsyncFunction;
    this.epollFd = Number(epollCreate(EPOLL_CLOEXEC));
    if (this.epollFd < 0) throw new Error("epoll_create1 failed");
    this.wakeFd = Number(eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK));
    if (this.wakeFd < 0) {
      closeFd(this.epollFd);
      throw new Error("eventfd failed for readiness dispatcher");
    }
    try {
      this.control(EPOLL_CTL_ADD, this.wakeFd);
    } catch (error) {
      closeFd(this.wakeFd);
      closeFd(this.epollFd);
      throw error;
    }
    this.wait();
  }

  add(fd: number, handler: () => void): void {
    if (this.stopped) throw new Error(`${this.label} dispatcher is stopped`);
    this.handlers.set(fd, handler);
    try {
      this.control(EPOLL_CTL_ADD, fd);
    } catch (error) {
      this.handlers.delete(fd);
      throw error;
    }
  }

  remove(fd: number): void {
    if (!this.handlers.delete(fd) || this.disposed) return;
    try {
      const result = Number(this.epollCtl(this.epollFd, EPOLL_CTL_DEL, fd, null));
      const errno = result === 0 ? 0 : koffi.errno();
      if (result !== 0 && !this.stopped && errno !== ENOENT && errno !== EBADF) {
        console.warn(`[${this.label}] epoll_ctl DEL fd=${fd} returned ${result}`);
      }
    } catch {
      // Closing a descriptor removes it from epoll automatically.
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.handlers.clear();
    if (!this.waiting) {
      this.dispose();
      return;
    }
    const value = koffi.alloc("uint64_t", 1);
    try {
      koffi.encode(value, "uint64_t", 1n);
      this.write(this.wakeFd, value, 8);
    } finally {
      koffi.free(value);
    }
  }

  private control(operation: number, fd: number): void {
    const event = koffi.alloc(EpollEvent, 1);
    try {
      koffi.encode(event, EpollEvent, {
        events: READINESS_EVENTS,
        data: BigInt(fd),
      });
      const result = Number(this.epollCtl(this.epollFd, operation, fd, event));
      if (result !== 0) {
        throw new Error(`epoll_ctl operation=${operation} fd=${fd} failed (${result})`);
      }
    } finally {
      koffi.free(event);
    }
  }

  private wait(): void {
    if (this.waiting || this.stopped || this.disposed) return;
    this.waiting = true;
    this.epollWait.async(
      this.epollFd,
      this.events,
      MAX_READY_EVENTS,
      -1,
      (error: unknown, result: unknown) => {
        this.waiting = false;
        if (this.stopped) {
          this.dispose();
          return;
        }
        if (error || Number(result) < 0) {
          console.error(`[${this.label}] epoll_wait failed:`, error ?? result);
          setTimeout(() => this.wait(), 25).unref?.();
          return;
        }
        const count = Math.min(MAX_READY_EVENTS, Number(result));
        const ready = koffi.decode(this.events, EpollEvents) as Array<{
          events: number;
          data: bigint | number;
        }>;
        if (!this.reportedReady) {
          this.reportedReady = true;
          console.log(`[${this.label}] epoll readiness active`);
        }
        for (let index = 0; index < count; index++) {
          const fd = Number(ready[index]!.data);
          if (fd === this.wakeFd) continue;
          try {
            this.handlers.get(fd)?.();
          } catch (dispatchError) {
            console.error(`[${this.label}] readiness dispatch fd=${fd}:`, dispatchError);
          }
        }
        this.wait();
      },
    );
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    freePtr(this.events);
    closeFd(this.wakeFd);
    closeFd(this.epollFd);
  }
}
