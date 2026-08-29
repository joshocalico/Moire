import koffi from "koffi";
import { bindNativeFunction, type NativeFunction, type NativeInteger } from "./ffi";

let libc: ReturnType<typeof koffi.load> | null = null;

export function getLibc() {
  if (!libc) {
    libc = koffi.load("libc.so.6");
  }
  return libc;
}

export const O_RDWR = 0x2;
export const O_CLOEXEC = 0x80000;

type LibcBindings = {
  open: NativeFunction<[pathname: string, flags: number], number>;
  close: NativeFunction<[fd: number], number>;
  mmap: NativeFunction<
    [address: null, length: number, protection: number, flags: number, fd: number, offset: number],
    unknown
  >;
  munmap: NativeFunction<[address: unknown, length: number], number>;
  socketpair: NativeFunction<
    [domain: number, type: number, protocol: number, sockets: unknown],
    number
  >;
  fcntl: NativeFunction<[fd: number, command: number, argument: number], number>;
  getsockopt: NativeFunction<
    [socket: number, level: number, option: number, value: unknown, length: unknown],
    number
  >;
  memcpy: NativeFunction<[destination: unknown, source: Uint8Array, length: number], unknown>;
  pipe2: NativeFunction<[pipeFds: Buffer, flags: number], number>;
  ioctl: NativeFunction<[fd: number, request: number, argument: unknown], number>;
  memfdCreate: NativeFunction<[name: string, flags: number], number>;
  ftruncate: NativeFunction<[fd: number, length: number], number>;
  write: NativeFunction<[fd: number, buffer: Uint8Array, count: number], NativeInteger>;
  lseek: NativeFunction<[fd: number, offset: number, whence: number], NativeInteger>;
};

let libcBindings: LibcBindings | null = null;

function getLibcBindings(): LibcBindings {
  if (libcBindings) return libcBindings;
  const library = getLibc();
  libcBindings = {
    open: bindNativeFunction<(pathname: string, flags: number) => number>(
      library,
      "int open(const char *pathname, int flags)",
    ),
    close: bindNativeFunction<(fd: number) => number>(library, "int close(int fd)"),
    mmap: bindNativeFunction<
      (
        address: null,
        length: number,
        protection: number,
        flags: number,
        fd: number,
        offset: number,
      ) => unknown
    >(library, "void *mmap(void *addr, size_t length, int prot, int flags, int fd, long offset)"),
    munmap: bindNativeFunction<(address: unknown, length: number) => number>(
      library,
      "int munmap(void *addr, size_t length)",
    ),
    socketpair: bindNativeFunction<
      (domain: number, type: number, protocol: number, sockets: unknown) => number
    >(library, "int socketpair(int domain, int type, int protocol, _Out_ int *sv)"),
    fcntl: bindNativeFunction<(fd: number, command: number, argument: number) => number>(
      library,
      "int fcntl(int fd, int cmd, int arg)",
    ),
    getsockopt: bindNativeFunction<
      (socket: number, level: number, option: number, value: unknown, length: unknown) => number
    >(
      library,
      "int getsockopt(int sockfd, int level, int optname, _Out_ void *optval, _Inout_ uint32_t *optlen)",
    ),
    memcpy: bindNativeFunction<
      (destination: unknown, source: Uint8Array, length: number) => unknown
    >(library, "void *memcpy(void *dest, const void *src, size_t n)"),
    pipe2: bindNativeFunction<(pipeFds: Buffer, flags: number) => number>(
      library,
      "int pipe2(int *pipefd, int flags)",
    ),
    ioctl: bindNativeFunction<(fd: number, request: number, argument: unknown) => number>(
      library,
      "int ioctl(int fd, unsigned long request, void *argument)",
    ),
    memfdCreate: bindNativeFunction<(name: string, flags: number) => number>(
      library,
      "int memfd_create(const char *name, unsigned int flags)",
    ),
    ftruncate: bindNativeFunction<(fd: number, length: number) => number>(
      library,
      "int ftruncate(int fd, long length)",
    ),
    write: bindNativeFunction<(fd: number, buffer: Uint8Array, count: number) => NativeInteger>(
      library,
      "long write(int fd, const void *buf, size_t count)",
    ),
    lseek: bindNativeFunction<(fd: number, offset: number, whence: number) => NativeInteger>(
      library,
      "long lseek(int fd, long offset, int whence)",
    ),
  };
  return libcBindings;
}

export function openPath(pathname: string, flags: number): number {
  const fd = getLibcBindings().open(pathname, flags);
  if (fd < 0) {
    throw new Error(`open(${pathname}) failed`);
  }
  return fd;
}

export function closeFd(fd: number): void {
  getLibcBindings().close(fd);
}

export function mmap(
  length: number,
  prot: number,
  flags: number,
  fd: number,
  offset: number,
): unknown {
  const ptr = getLibcBindings().mmap(null, length, prot, flags, fd, offset);
  // MAP_FAILED is (void *)-1
  const addr = BigInt(koffi.address(ptr));
  if (addr === 0xffffffffffffffffn || addr === -1n) {
    throw new Error("mmap failed");
  }
  return ptr;
}

export function munmap(addr: unknown, length: number): void {
  getLibcBindings().munmap(addr, length);
}

const AF_UNIX = 1;
const SOCK_STREAM = 1;
/** Linux SOCK_CLOEXEC */
const SOCK_CLOEXEC = 0x80000;
const F_SETFD = 2;

/** Create a connected UNIX stream socketpair. Returns [fd0, fd1]. */
export function socketpairUnixStream(): [number, number] {
  const sv = koffi.alloc("int", 2);
  const rc = getLibcBindings().socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, sv);
  if (rc !== 0) {
    throw new Error(`socketpair failed (rc=${rc})`);
  }
  const fds = koffi.decode(sv, koffi.array("int", 2)) as number[];
  return [fds[0]!, fds[1]!];
}

/** Clear FD_CLOEXEC so the fd can be inherited / passed via spawn stdio. */
export function clearCloexec(fd: number): void {
  const rc = getLibcBindings().fcntl(fd, F_SETFD, 0);
  if (rc !== 0) {
    throw new Error(`fcntl(F_SETFD) failed on fd=${fd}`);
  }
}

/** Linux SO_PEERCRED — pid/uid/gid of the connected UNIX socket peer. */
const SOL_SOCKET = 1;
const SO_PEERCRED = 17;

const Ucred = koffi.struct("ucred_moire", {
  pid: "int",
  uid: "uint32_t",
  gid: "uint32_t",
});

export type PeerCredentials = {
  pid: number;
  uid: number;
  gid: number;
};

export function peerCredentials(fd: number): PeerCredentials | null {
  const cred = koffi.alloc(Ucred, 1);
  const len = koffi.alloc("uint32_t", 1);
  koffi.encode(len, "uint32_t", koffi.sizeof(Ucred));
  const rc = getLibcBindings().getsockopt(fd, SOL_SOCKET, SO_PEERCRED, cred, len);
  if (rc !== 0) {
    freePtrSafe(cred);
    freePtrSafe(len);
    return null;
  }
  const decoded = koffi.decode(cred, Ucred) as PeerCredentials;
  freePtrSafe(cred);
  freePtrSafe(len);
  return {
    pid: decoded.pid | 0,
    uid: decoded.uid >>> 0,
    gid: decoded.gid >>> 0,
  };
}

function freePtrSafe(ptr: unknown): void {
  try {
    koffi.free(ptr);
  } catch {
    // ok
  }
}

/** Copy `length` bytes from a Node Buffer/TypedArray into an mmap pointer. */
export function memcpyTo(dest: unknown, src: Uint8Array, length = src.byteLength): void {
  const buf = src.byteOffset === 0 && src.byteLength === length ? src : src.subarray(0, length);
  getLibcBindings().memcpy(dest, buf, length);
}

/** Return a zero-copy ArrayBuffer view over native memory. */
export function nativeView(address: unknown, length: number): ArrayBuffer {
  return koffi.view(address, length) as ArrayBuffer;
}

/** Create a close-on-exec pipe. */
export function createPipe(flags: number): [readFd: number, writeFd: number] {
  const descriptors = Buffer.alloc(8);
  const result = getLibcBindings().pipe2(descriptors, flags);
  if (result !== 0) throw new Error(`pipe2 failed (rc=${result})`);
  return [descriptors.readInt32LE(0), descriptors.readInt32LE(4)];
}

/** Perform an ioctl through the typed libc boundary. */
export function ioctlFd(fd: number, request: number, argument: unknown): number {
  return getLibcBindings().ioctl(fd, request, argument);
}

/** Perform an ioctl whose argument is a pointer to one uint64 value. */
export function ioctlUint64(fd: number, request: number, value: bigint): number {
  const argument = koffi.alloc("uint64_t", 1);
  try {
    koffi.encode(argument, "uint64_t", value);
    return getLibcBindings().ioctl(fd, request, argument);
  } finally {
    freePtrSafe(argument);
  }
}

export function createMemfd(name: string, flags: number): number {
  const fd = getLibcBindings().memfdCreate(name, flags);
  if (fd < 0) throw new Error(`memfd_create(${name}) failed`);
  return fd;
}

export function truncateFd(fd: number, length: number): void {
  const result = getLibcBindings().ftruncate(fd, length);
  if (result !== 0) throw new Error(`ftruncate(fd=${fd}, length=${length}) failed`);
}

export function writeFd(fd: number, buffer: Uint8Array): number {
  return Number(getLibcBindings().write(fd, buffer, buffer.byteLength));
}

export function seekFd(fd: number, offset: number, whence: number): number {
  return Number(getLibcBindings().lseek(fd, offset, whence));
}

/**
 * Flush a CPU staging buffer into a DRM/shm mmap via libc memcpy.
 * On Parallels, follow with `presentKms()` so the CRTC actually shows the update
 * (see docs/parallels-drm-present.md).
 */
export function flushMmap(dest: unknown, src: Uint8Array, length = src.byteLength): void {
  memcpyTo(dest, src, length);
}

export const PROT_READ = 0x1;
export const PROT_WRITE = 0x2;
export const MAP_SHARED = 0x01;
