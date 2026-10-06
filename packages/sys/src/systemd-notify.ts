import { bindNativeFunction, type NativeInteger } from "./ffi";
import { getLibc } from "./libc";

const AF_UNIX = 1,
  SOCK_DGRAM = 2,
  SOCK_CLOEXEC = 0x80000,
  SOCK_NONBLOCK = 0x800;
const ready = Buffer.from("READY=1\n", "utf8");
export type SystemdNotifyBindings = {
  socket: (domain: number, type: number, protocol: number) => number;
  sendto: (
    fd: number,
    data: Uint8Array,
    length: number,
    flags: number,
    address: Buffer,
    addressLength: number,
  ) => NativeInteger;
  close: (fd: number) => number;
};
let cached: SystemdNotifyBindings | null = null;
function bindings(): SystemdNotifyBindings {
  if (cached) return cached;
  const library = getLibc();
  cached = {
    socket: bindNativeFunction<(domain: number, type: number, protocol: number) => number>(
      library,
      "int socket(int domain, int type, int protocol)",
    ),
    sendto: bindNativeFunction<
      (
        fd: number,
        data: Uint8Array,
        length: number,
        flags: number,
        address: Buffer,
        addressLength: number,
      ) => NativeInteger
    >(
      library,
      "long sendto(int fd, const void *data, size_t length, int flags, const void *address, uint32_t address_length)",
    ),
    close: bindNativeFunction<(fd: number) => number>(library, "int close(int fd)"),
  };
  return cached;
}
/** Linux sockaddr_un: family plus pathname terminator, or exact abstract name with leading NUL. */
export function systemdNotifyAddress(socketPath: string): Buffer {
  const bytes = Buffer.from(socketPath, "utf8");
  if (
    socketPath.includes("\0") ||
    bytes.toString("utf8") !== socketPath ||
    bytes.length > 107 ||
    bytes.length < 2 ||
    (socketPath[0] !== "/" && socketPath[0] !== "@")
  )
    throw new Error(
      "NOTIFY_SOCKET must be a bounded absolute or abstract UTF-8 address without NUL",
    );
  const abstract = socketPath[0] === "@";
  const address = Buffer.alloc(2 + bytes.length + (abstract ? 0 : 1));
  address.writeUInt16LE(AF_UNIX, 0);
  if (abstract) bytes.subarray(1).copy(address, 3);
  else bytes.copy(address, 2);
  return address;
}
/** Exact syscall boundary used by production and failure fixtures; no readiness policy here. */
export function sendSystemdReadyDatagram(address: Buffer, native: SystemdNotifyBindings): void {
  const fd = native.socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
  if (fd < 0) throw new Error("systemd readiness socket failed");
  let failure: Error | null = null;
  try {
    const sent = native.sendto(fd, ready, ready.byteLength, 0, address, address.byteLength);
    if (sent !== ready.byteLength && sent !== BigInt(ready.byteLength))
      throw new Error(`systemd readiness sendto failed or short (${sent})`);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    try {
      if (native.close(fd) !== 0 && !failure)
        failure = new Error("systemd readiness socket close failed");
    } catch (error) {
      if (!failure) failure = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (failure) throw failure;
}
/** Send synchronously from this process. The guardian owns when readiness is true. */
export function notifySystemdReady(socketPath: string): void {
  const address = systemdNotifyAddress(socketPath);
  if (process.platform !== "linux")
    throw new Error("systemd readiness notification requires Linux");
  sendSystemdReadyDatagram(address, bindings());
}
