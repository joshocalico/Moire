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
import { getLibc, peerCredentials } from "./libc.js";

const SOL_SOCKET = 1;
const SCM_RIGHTS = 1;
const CMSG_BUF = 256;
const MSG_DONTWAIT = 0x40;
const RECV_MAX = 8192;

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

export type WaylandChunk = {
  data: Buffer;
  fds: number[];
};

export class WaylandSocketServer extends EventEmitter {
  private server: net.Server | null = null;
  readonly path: string;

  constructor(socketPath: string) {
    super();
    this.path = socketPath;
  }

  start(): void {
    assertLinux("Wayland socket");
    try {
      fs.unlinkSync(this.path);
    } catch {
      // ok
    }
    this.server = net.createServer((sock) => {
      try {
        const conn = new WaylandClientConn(sock);
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

  constructor(sock: net.Socket) {
    super();
    this.sock = sock;
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
    const timer = setInterval(() => this.pump(), 5);
    sock.on("close", () => {
      clearInterval(timer);
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
    if (n < 0) return null;
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
