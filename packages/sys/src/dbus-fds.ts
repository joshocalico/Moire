/**
 * Descriptor passing for D-Bus connections: the audited native half of `@moire/dbus`'s
 * `DbusUnixFdTransport`. logind's Inhibit and the portal's OpenFile hand over descriptors, which a
 * Node socket cannot carry, so this takes over reading the bus socket with recvmsg and sends
 * descriptor-carrying messages with sendmsg (SCM_RIGHTS).
 *
 * Received descriptors are close-on-exec (MSG_CMSG_CLOEXEC), so an inhibitor held by the
 * compositor never leaks into an app it starts. The structure layouts are LP64 Linux.
 */
import net from "node:net";
import koffi from "koffi";
import { getLibc } from "./libc";
import { assertLinux } from "./platform";
import { LinuxReadinessDispatcher } from "./readiness";

const SOL_SOCKET = 1;
const SCM_RIGHTS = 1;
const MSG_DONTWAIT = 0x40;
const MSG_NOSIGNAL = 0x4000;
const MSG_CTRUNC = 0x8;
const MSG_CMSG_CLOEXEC = 0x40000000;
const EINTR = 4;
const EAGAIN = 11;
const RECV_BYTES = 64 * 1024;
/** dbus-daemon passes at most 16 descriptors per message; leave room for several messages. */
const MAX_FDS = 64;
const CMSG_HEADER = 16;
const CONTROL_BYTES = CMSG_HEADER + MAX_FDS * 4;

const Iovec = koffi.struct("iovec_dbus", { iov_base: "void *", iov_len: "size_t" });
const Msghdr = koffi.struct("msghdr_dbus", {
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

type MsgFunction = (sockfd: number, msg: unknown, flags: number) => number | bigint;
let calls: { recvmsg: MsgFunction; sendmsg: MsgFunction } | null = null;
function msgCalls() {
  if (calls) return calls;
  const libc = getLibc();
  calls = {
    recvmsg: libc.func("long recvmsg(int sockfd, void *msg, int flags)") as MsgFunction,
    sendmsg: libc.func("long sendmsg(int sockfd, void *msg, int flags)") as MsgFunction,
  };
  return calls;
}

type SocketHandle = { fd?: number; readStop?: () => void };
function socketHandle(socket: net.Socket): SocketHandle | undefined {
  return (socket as unknown as { _handle?: SocketHandle })._handle;
}

/** Parse every SCM_RIGHTS block in a control buffer. */
function controlFds(control: Buffer): number[] {
  const fds: number[] = [];
  for (let offset = 0; offset + CMSG_HEADER <= control.length;) {
    const length = Number(control.readBigUInt64LE(offset));
    if (length < CMSG_HEADER || offset + length > control.length) break;
    if (
      control.readInt32LE(offset + 8) === SOL_SOCKET &&
      control.readInt32LE(offset + 12) === SCM_RIGHTS
    )
      for (let at = offset + CMSG_HEADER; at + 4 <= offset + length; at += 4)
        fds.push(control.readInt32LE(at));
    offset += (length + 7) & ~7;
  }
  return fds;
}

/**
 * A `DbusUnixFdTransport` for Linux. Pass it as `SessionBus.connect(address, { unixFds })`.
 * Called once the bus has authenticated: from then on libuv no longer reads the socket (it would
 * read past, and so drop, attached descriptors); recvmsg does, whenever epoll reports it readable.
 */
export function dbusUnixFdTransport(
  socket: net.Socket,
  receive: (data: Buffer, fds: number[]) => void,
): { send(data: Buffer, fds: readonly number[]): number } {
  assertLinux("D-Bus descriptor passing");
  const fd = socketHandle(socket)?.fd;
  if (fd === undefined || fd < 0) throw new Error("D-Bus socket has no descriptor");
  const { recvmsg, sendmsg } = msgCalls();
  const readiness = new LinuxReadinessDispatcher("dbus");
  const recvData = koffi.alloc("uint8_t", RECV_BYTES);
  const recvIov = koffi.alloc(Iovec, 1);
  const recvControl = koffi.alloc("uint8_t", CONTROL_BYTES);
  const recvMsg = koffi.alloc(Msghdr, 1);
  let closed = false;

  socket.pause();
  socketHandle(socket)?.readStop?.();

  const release = () => {
    if (closed) return;
    closed = true;
    readiness.remove(fd);
    readiness.stop();
    for (const pointer of [recvData, recvIov, recvControl, recvMsg]) koffi.free(pointer);
  };
  /** One recvmsg; null when there is nothing more to read now. */
  const readOnce = (): { data: Buffer; fds: number[] } | "eof" | null => {
    koffi.encode(recvIov, Iovec, { iov_base: recvData, iov_len: BigInt(RECV_BYTES) });
    koffi.encode(recvMsg, Msghdr, {
      msg_name: null,
      msg_namelen: 0,
      __pad0: 0,
      msg_iov: recvIov,
      msg_iovlen: 1n,
      msg_control: recvControl,
      msg_controllen: BigInt(CONTROL_BYTES),
      msg_flags: 0,
      __pad1: 0,
    });
    const count = Number(recvmsg(fd, recvMsg, MSG_DONTWAIT | MSG_CMSG_CLOEXEC));
    if (count < 0) {
      const errno = koffi.errno();
      return errno === EINTR || errno === EAGAIN ? null : "eof";
    }
    const header = koffi.decode(recvMsg, Msghdr) as {
      msg_controllen: bigint | number;
      msg_flags: number;
    };
    const controlLength = Math.min(Number(header.msg_controllen), CONTROL_BYTES);
    const fds =
      controlLength >= CMSG_HEADER
        ? controlFds(Buffer.from(koffi.view(recvControl, controlLength) as ArrayBuffer))
        : [];
    if (count === 0 && fds.length === 0) return "eof";
    // Truncated control data means descriptors were dropped: the stream can no longer be trusted.
    if (header.msg_flags & MSG_CTRUNC) {
      receive(Buffer.alloc(0), fds);
      return "eof";
    }
    const data =
      count > 0 ? Buffer.from(koffi.view(recvData, count) as ArrayBuffer) : Buffer.alloc(0);
    return { data, fds };
  };
  let pumping = false;
  const pump = () => {
    if (pumping || closed) return;
    pumping = true;
    try {
      for (;;) {
        const chunk = readOnce();
        if (chunk === null) break;
        if (chunk === "eof") {
          socket.destroy();
          break;
        }
        receive(chunk.data, chunk.fds);
      }
    } finally {
      pumping = false;
    }
  };
  socket.once("close", release);
  readiness.add(fd, pump);
  // Anything already queued before epoll registration is read now.
  queueMicrotask(pump);

  return {
    send(data, fds) {
      if (closed) throw new Error("D-Bus socket closed");
      if (fds.length > MAX_FDS) throw new Error("Too many descriptors for one D-Bus message");
      const dataPointer = koffi.alloc("uint8_t", Math.max(data.length, 1));
      const iov = koffi.alloc(Iovec, 1);
      const controlLength = (CMSG_HEADER + fds.length * 4 + 7) & ~7;
      const control = koffi.alloc("uint8_t", controlLength);
      const msg = koffi.alloc(Msghdr, 1);
      try {
        new Uint8Array(koffi.view(dataPointer, data.length) as ArrayBuffer).set(data);
        const header = Buffer.alloc(controlLength);
        header.writeBigUInt64LE(BigInt(CMSG_HEADER + fds.length * 4), 0);
        header.writeInt32LE(SOL_SOCKET, 8);
        header.writeInt32LE(SCM_RIGHTS, 12);
        fds.forEach((value, index) => header.writeInt32LE(value, CMSG_HEADER + index * 4));
        new Uint8Array(koffi.view(control, controlLength) as ArrayBuffer).set(header);
        koffi.encode(iov, Iovec, { iov_base: dataPointer, iov_len: BigInt(data.length) });
        koffi.encode(msg, Msghdr, {
          msg_name: null,
          msg_namelen: 0,
          __pad0: 0,
          msg_iov: iov,
          msg_iovlen: 1n,
          msg_control: fds.length ? control : null,
          msg_controllen: fds.length ? BigInt(controlLength) : 0n,
          msg_flags: 0,
          __pad1: 0,
        });
        const written = Number(sendmsg(fd, msg, MSG_DONTWAIT | MSG_NOSIGNAL));
        if (written >= 0) return written;
        const errno = koffi.errno();
        if (errno === EAGAIN || errno === EINTR) return 0;
        throw new Error(`D-Bus sendmsg failed (errno ${errno})`);
      } finally {
        for (const pointer of [dataPointer, iov, control, msg]) koffi.free(pointer);
      }
    },
  };
}
