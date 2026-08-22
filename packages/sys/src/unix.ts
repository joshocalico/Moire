/**
 * Send/recv Wayland messages with optional SCM_RIGHTS fds.
 * Node's net.Socket is used only for accept + fd; all I/O is via recvmsg/sendmsg.
 *
 * Scratch msghdr/iovec/buffers are reused per connection — koffi.alloc without
 * free was a multi-GB native leak at ~200Hz pump × N clients.
 */
import fs from "node:fs";
import net from "node:net";
import { EventEmitter } from "node:events";
import koffi from "koffi";
import { assertLinux } from "./platform.js";
import { closeFd, getLibc, peerCredentials } from "./libc.js";

const SOL_SOCKET = 1;
const SCM_RIGHTS = 1;
const CMSG_BUF = 256;
const MSG_DONTWAIT = 0x40;
const RECV_MAX = 8192;
const EINTR = 4;
const EAGAIN = 11;
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

const Iovec = koffi.struct("iovec_wl", {
  iov_base: "void *",
  iov_len: "size_t",
});

const Msghdr = koffi.struct("msghdr_wl", {
  msg_name: "void *",
  msg_namelen: "uint32_t",
  __pad0: "uint32_t",
  msg_iov: "void *",
  msg_iovlen: "size_t",
  msg_control: "void *",
  msg_controllen: "size_t",
  msg_flags: "int",
  __pad1: "int",
});

const Cmsghdr = koffi.struct("cmsghdr_wl", {
  cmsg_len: "size_t",
  cmsg_level: "int",
  cmsg_type: "int",
});

// Glibc keeps epoll_event naturally aligned (16 bytes) on aarch64 but packs it
// to 12 bytes on x86-64. Match the guest ABI or the returned data token is read
// from the wrong offset even though the event mask itself looks valid.
const EpollEventFields = {
  events: "uint32_t",
  data: "uint64_t",
} as const;
const EpollEvent =
  process.arch === "arm64"
    ? koffi.struct("epoll_event_wl", EpollEventFields)
    : koffi.pack("epoll_event_wl", EpollEventFields);
const EpollEvents = koffi.array(EpollEvent, MAX_READY_EVENTS);

type NativeAsyncFunction = ((...args: unknown[]) => unknown) & {
  async: (...args: unknown[]) => void;
};

function socketHandle(sock: net.Socket): { fd?: number; readStop?: () => void } | undefined {
  return (sock as unknown as { _handle?: { fd?: number; readStop?: () => void } })
    ._handle;
}

function socketFd(sock: net.Socket): number {
  const fd = socketHandle(sock)?.fd;
  if (fd === undefined || fd < 0) {
    throw new Error("Unable to get socket fd (Node _handle.fd)");
  }
  return fd;
}

/** Stop libuv from reading — otherwise it steals bytes (and SCM_RIGHTS fds). */
function claimSocketForRecvmsg(sock: net.Socket): void {
  sock.pause();
  socketHandle(sock)?.readStop?.();
}

function alignSizeT(n: number): number {
  const a = 8; // sizeof(size_t) on 64-bit
  return (n + a - 1) & ~(a - 1);
}

function freePtr(ptr: unknown): void {
  if (ptr == null) return;
  try {
    koffi.free(ptr);
  } catch {
    // ok
  }
}

/**
 * One blocking epoll_wait runs on Koffi's worker pool for the entire Wayland
 * server. Socket bytes remain untouched until recvmsg runs on the main thread,
 * preserving SCM_RIGHTS ownership without a 5 ms timer per client.
 */
class ReadinessDispatcher {
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

  constructor() {
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
      throw new Error("eventfd failed for Wayland readiness dispatcher");
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
    if (this.stopped) throw new Error("Wayland readiness dispatcher is stopped");
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
      if (
        result !== 0 &&
        !this.stopped &&
        errno !== ENOENT &&
        errno !== EBADF
      ) {
        console.warn(`[wayland] epoll_ctl DEL fd=${fd} returned ${result}`);
      }
    } catch {
      // The socket may already be gone; removing a closed fd is harmless.
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
          console.error("[wayland] epoll_wait failed:", error ?? result);
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
          console.log(
            `[wayland] epoll readiness active events=${count} fds=${ready
              .slice(0, count)
              .map((event) => Number(event.data))
              .join(",")}`,
          );
        }
        for (let index = 0; index < count; index++) {
          const fd = Number(ready[index]!.data);
          if (fd === this.wakeFd) continue;
          try {
            this.handlers.get(fd)?.();
          } catch (dispatchError) {
            console.error(`[wayland] readiness dispatch fd=${fd}:`, dispatchError);
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

export type WaylandChunk = {
  data: Buffer;
  fds: number[];
};

export class WaylandSocketServer extends EventEmitter {
  private server: net.Server | null = null;
  private readiness: ReadinessDispatcher | null = null;
  readonly path: string;

  constructor(socketPath: string) {
    super();
    this.path = socketPath;
  }

  start(): void {
    assertLinux("Wayland socket");
    this.readiness = new ReadinessDispatcher();
    try {
      fs.unlinkSync(this.path);
    } catch {
      // ok
    }
    this.server = net.createServer((sock) => {
      try {
        const conn = new WaylandClientConn(sock, this.readiness!);
        this.emit("connection", conn);
      } catch (err) {
        console.error("[wayland] accept failed", err);
        sock.destroy();
      }
    });
    this.server.listen(this.path);
    try {
      fs.chmodSync(this.path, 0o700);
    } catch {
      // ok
    }
  }

  stop(): void {
    try {
      this.server?.close();
    } catch {
      // ok
    }
    this.server = null;
    this.readiness?.stop();
    this.readiness = null;
    try {
      fs.unlinkSync(this.path);
    } catch {
      // ok
    }
  }
}

export class WaylandClientConn extends EventEmitter {
  private readonly sock: net.Socket;
  private readonly fd: number;
  private readonly readiness: ReadinessDispatcher;
  private readonly ownsReadiness: boolean;
  /** Peer process id from SO_PEERCRED (Linux), if available. */
  readonly peerPid: number | null;
  private reading = false;
  private readonly recvmsg: (sockfd: number, msg: unknown, flags: number) => number | bigint;
  private readonly sendmsg: (sockfd: number, msg: unknown, flags: number) => number | bigint;

  /** Fixed-size recvmsg scratch — allocated once per connection. */
  private readonly recvDataPtr = koffi.alloc("uint8_t", RECV_MAX);
  private readonly recvIov = koffi.alloc(Iovec, 1);
  private readonly recvControl = koffi.alloc("uint8_t", CMSG_BUF);
  private readonly recvMsg = koffi.alloc(Msghdr, 1);

  /** Growable sendmsg scratch. */
  private sendDataPtr: unknown = null;
  private sendDataCap = 0;
  private readonly sendIov = koffi.alloc(Iovec, 1);
  private readonly sendMsg = koffi.alloc(Msghdr, 1);
  private sendControl: unknown = null;
  private sendControlCap = 0;
  private disposed = false;
  private closeEmitted = false;

  constructor(sock: net.Socket, readiness?: ReadinessDispatcher) {
    super();
    this.sock = sock;
    this.readiness = readiness ?? new ReadinessDispatcher();
    this.ownsReadiness = readiness == null;
    this.fd = socketFd(sock);
    this.peerPid = peerCredentials(this.fd)?.pid ?? null;
    const libc = getLibc();
    this.recvmsg = libc.func(
      "long recvmsg(int sockfd, void *msg, int flags)",
    ) as (sockfd: number, msg: unknown, flags: number) => number | bigint;
    this.sendmsg = libc.func(
      "long sendmsg(int sockfd, void *msg, int flags)",
    ) as (sockfd: number, msg: unknown, flags: number) => number | bigint;
    claimSocketForRecvmsg(sock);
    this.readiness.add(this.fd, () => this.pump());
    sock.on("close", () => {
      this.readiness.remove(this.fd);
      if (this.ownsReadiness) this.readiness.stop();
      // Let ClientSession tear down (may still send) before freeing scratch.
      this.notifyClose();
      this.freeScratch();
    });
    sock.on("error", (err) => this.emit("error", err));
  }

  private notifyClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.emit("close");
  }

  private freeScratch(): void {
    if (this.disposed) return;
    this.disposed = true;
    freePtr(this.sendDataPtr);
    this.sendDataPtr = null;
    this.sendDataCap = 0;
    freePtr(this.sendControl);
    this.sendControl = null;
    this.sendControlCap = 0;
    freePtr(this.recvDataPtr);
    freePtr(this.recvIov);
    freePtr(this.recvControl);
    freePtr(this.recvMsg);
    freePtr(this.sendIov);
    freePtr(this.sendMsg);
  }

  private ensureSendData(n: number): unknown {
    const need = Math.max(n, 1);
    if (this.sendDataPtr && need <= this.sendDataCap) return this.sendDataPtr;
    freePtr(this.sendDataPtr);
    const cap = Math.max(need, 4096);
    this.sendDataPtr = koffi.alloc("uint8_t", cap);
    this.sendDataCap = cap;
    return this.sendDataPtr;
  }

  private ensureSendControl(n: number): unknown {
    if (this.sendControl && n <= this.sendControlCap) return this.sendControl;
    freePtr(this.sendControl);
    this.sendControl = koffi.alloc("uint8_t", n);
    this.sendControlCap = n;
    return this.sendControl;
  }

  private pump(): void {
    if (this.reading || this.disposed) return;
    this.reading = true;
    try {
      for (;;) {
        if (this.disposed) break;
        const chunk = this.recvmsgOnce();
        if (!chunk) break;
        if (chunk.data.length === 0 && chunk.fds.length === 0) {
          this.notifyClose();
          this.sock.destroy();
          break;
        }
        this.emit("message", chunk);
      }
    } finally {
      this.reading = false;
    }
  }

  private recvmsgOnce(): WaylandChunk | null {
    if (this.disposed) return null;
    koffi.encode(this.recvIov, Iovec, {
      iov_base: this.recvDataPtr,
      iov_len: BigInt(RECV_MAX),
    });
    koffi.encode(this.recvMsg, Msghdr, {
      msg_name: null,
      msg_namelen: 0,
      __pad0: 0,
      msg_iov: this.recvIov,
      msg_iovlen: 1n,
      msg_control: this.recvControl,
      msg_controllen: BigInt(CMSG_BUF),
      msg_flags: 0,
      __pad1: 0,
    });

    const n = Number(this.recvmsg(this.fd, this.recvMsg, MSG_DONTWAIT));
    if (n < 0) {
      const errno = koffi.errno();
      if (errno === EINTR || errno === EAGAIN) return null;
      return { data: Buffer.alloc(0), fds: [] };
    }
    if (n === 0) return { data: Buffer.alloc(0), fds: [] };

    // Copy out of the reusable native buffer into a JS Buffer for the demuxer.
    const view = new Uint8Array(
      koffi.view(this.recvDataPtr, n) as ArrayBuffer,
    );
    const data = Buffer.from(view);

    const fds: number[] = [];
    const msgDecoded = koffi.decode(this.recvMsg, Msghdr) as {
      msg_controllen: bigint | number;
    };
    const controllen = Number(msgDecoded.msg_controllen);
    if (controllen >= 16) {
      const hdr = koffi.decode(this.recvControl, Cmsghdr) as {
        cmsg_len: bigint | number;
        cmsg_level: number;
        cmsg_type: number;
      };
      if (hdr.cmsg_level === SOL_SOCKET && hdr.cmsg_type === SCM_RIGHTS) {
        const cmsgLen = Number(hdr.cmsg_len);
        const ctrlView = new Uint8Array(
          koffi.view(this.recvControl, controllen) as ArrayBuffer,
        );
        const ctrlBytes = Buffer.from(ctrlView);
        for (let off = 16; off + 4 <= Math.min(cmsgLen, controllen); off += 4) {
          fds.push(ctrlBytes.readInt32LE(off));
        }
      }
    }

    return { data, fds };
  }

  /** Send a Wayland message, optionally with SCM_RIGHTS fds. */
  send(data: Buffer, fds: number[] = []): boolean {
    if (this.disposed || this.closeEmitted) return false;
    const dataPtr = this.ensureSendData(data.length);
    if (data.length > 0) {
      const dest = new Uint8Array(
        koffi.view(dataPtr, data.length) as ArrayBuffer,
      );
      dest.set(data);
    }
    koffi.encode(this.sendIov, Iovec, {
      iov_base: dataPtr,
      iov_len: BigInt(data.length),
    });

    let control: unknown = null;
    let controllen = 0n;
    if (fds.length > 0) {
      const hdrSize = 16; // sizeof(cmsghdr) on 64-bit
      const dataBytes = fds.length * 4;
      const cmsgLen = hdrSize + dataBytes;
      const bufSize = alignSizeT(cmsgLen);
      control = this.ensureSendControl(bufSize);
      const bytes = Buffer.alloc(bufSize);
      bytes.writeBigUInt64LE(BigInt(cmsgLen), 0); // cmsg_len
      bytes.writeInt32LE(SOL_SOCKET, 8);
      bytes.writeInt32LE(SCM_RIGHTS, 12);
      for (let i = 0; i < fds.length; i++) {
        bytes.writeInt32LE(fds[i]!, 16 + i * 4);
      }
      const dest = new Uint8Array(
        koffi.view(control, bufSize) as ArrayBuffer,
      );
      dest.set(bytes);
      controllen = BigInt(bufSize);
    }

    koffi.encode(this.sendMsg, Msghdr, {
      msg_name: null,
      msg_namelen: 0,
      __pad0: 0,
      msg_iov: this.sendIov,
      msg_iovlen: 1n,
      msg_control: control,
      msg_controllen: controllen,
      msg_flags: 0,
      __pad1: 0,
    });

    const n = Number(this.sendmsg(this.fd, this.sendMsg, 0));
    if (n < 0) {
      // A peer can disappear between the compositor choosing recipients and
      // the syscall. Treat that as a client disconnect, never a compositor
      // failure. notifyClose is guarded because destroy() causes a later
      // net.Socket close event too.
      this.notifyClose();
      this.sock.destroy();
      return false;
    }
    return true;
  }

  close(): void {
    this.sock.destroy();
  }
}
