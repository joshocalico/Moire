import koffi from "koffi";

let libc: ReturnType<typeof koffi.load> | null = null;

export function getLibc() {
  if (!libc) {
    libc = koffi.load("libc.so.6");
  }
  return libc;
}

export const O_RDWR = 0x2;
export const O_CLOEXEC = 0x80000;

export function openPath(pathname: string, flags: number): number {
  const open = getLibc().func("int open(const char *pathname, int flags)");
  const fd = open(pathname, flags) as number;
  if (fd < 0) {
    throw new Error(`open(${pathname}) failed`);
  }
  return fd;
}

export function closeFd(fd: number): void {
  const close = getLibc().func("int close(int fd)");
  close(fd);
}

export function mmap(
  length: number,
  prot: number,
  flags: number,
  fd: number,
  offset: number,
): unknown {
  const mmapFn = getLibc().func(
    "void *mmap(void *addr, size_t length, int prot, int flags, int fd, long offset)",
  );
  const ptr = mmapFn(null, length, prot, flags, fd, offset);
  // MAP_FAILED is (void *)-1
  const addr = BigInt(koffi.address(ptr));
  if (addr === 0xffffffffffffffffn || addr === -1n) {
    throw new Error("mmap failed");
  }
  return ptr;
}

export function munmap(addr: unknown, length: number): void {
  const munmap = getLibc().func("int munmap(void *addr, size_t length)");
  munmap(addr, length);
}

const AF_UNIX = 1;
const SOCK_STREAM = 1;
/** Linux SOCK_CLOEXEC */
const SOCK_CLOEXEC = 0x80000;
const F_SETFD = 2;

/** Create a connected UNIX stream socketpair. Returns [fd0, fd1]. */
export function socketpairUnixStream(): [number, number] {
  const libc = getLibc();
  const socketpair = libc.func(
    "int socketpair(int domain, int type, int protocol, _Out_ int *sv)",
  );
  const sv = koffi.alloc("int", 2);
  const rc = socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, sv) as number;
  if (rc !== 0) {
    throw new Error(`socketpair failed (rc=${rc})`);
  }
  const fds = koffi.decode(sv, koffi.array("int", 2)) as number[];
  return [fds[0]!, fds[1]!];
}

/** Clear FD_CLOEXEC so the fd can be inherited / passed via spawn stdio. */
export function clearCloexec(fd: number): void {
  const fcntl = getLibc().func("int fcntl(int fd, int cmd, int arg)");
  const rc = fcntl(fd, F_SETFD, 0) as number;
  if (rc !== 0) {
    throw new Error(`fcntl(F_SETFD) failed on fd=${fd}`);
  }
}

/** Copy `length` bytes from a Node Buffer/TypedArray into an mmap pointer. */
export function memcpyTo(dest: unknown, src: Uint8Array, length = src.byteLength): void {
  const memcpy = getLibc().func(
    "void *memcpy(void *dest, const void *src, size_t n)",
  );
  const buf =
    src.byteOffset === 0 && src.byteLength === length
      ? src
      : src.subarray(0, length);
  memcpy(dest, buf, length);
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
