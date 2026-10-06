import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import koffi from "koffi";
import { getLibc, memcpyTo, nativeView } from "./libc";
import { bindNativeFunction, type NativeInteger } from "./ffi";
import {
  notifySystemdReady,
  systemdNotifyAddress,
  sendSystemdReadyDatagram,
  type SystemdNotifyBindings,
} from "./systemd-notify";

const pathname = systemdNotifyAddress("/run/notify");
assert.equal(pathname.readUInt16LE(0), 1);
assert.deepEqual(pathname.subarray(2), Buffer.from("/run/notify\0"));
const abstract = systemdNotifyAddress("@moire-ready");
assert.deepEqual(abstract.subarray(2), Buffer.from("\0moire-ready"));
assert.equal(
  abstract.length,
  2 + Buffer.byteLength("@moire-ready"),
  "abstract address has no trailing terminator",
);
assert.equal(systemdNotifyAddress("/" + "x".repeat(106)).length, 110);
assert.equal(systemdNotifyAddress("@" + "é".repeat(53)).length, 109);
for (const invalid of [
  "",
  "@",
  "/",
  "relative",
  "/x\0y",
  "@x\0y",
  "/" + "x".repeat(107),
  "@" + "é".repeat(54),
  "/\ud800",
])
  assert.throws(() => systemdNotifyAddress(invalid));
for (const mode of [
  "success",
  "socket-failure",
  "send-failure",
  "short-send",
  "send-throw",
  "close-failure",
]) {
  let sends = 0,
    closes = 0;
  const native: SystemdNotifyBindings = {
    socket(domain, type, protocol) {
      assert.equal(domain, 1);
      assert.equal(type, 2 | 0x80000 | 0x800);
      assert.equal(protocol, 0);
      return mode === "socket-failure" ? -1 : 123;
    },
    sendto(fd, data, length, flags, address, addressLength) {
      sends++;
      assert.equal(fd, 123);
      assert.deepEqual(Buffer.from(data), Buffer.from("READY=1\n"));
      assert.equal(length, 8);
      assert.equal(flags, 0);
      assert.equal(addressLength, pathname.length);
      assert.deepEqual(address, pathname);
      if (mode === "send-throw") throw new Error("fixture send failure");
      return mode === "send-failure" ? -1 : mode === "short-send" ? 7 : 8n;
    },
    close(fd) {
      closes++;
      assert.equal(fd, 123);
      return mode === "close-failure" ? -1 : 0;
    },
  };
  if (mode === "success") sendSystemdReadyDatagram(pathname, native);
  else assert.throws(() => sendSystemdReadyDatagram(pathname, native));
  assert.equal(sends, mode === "socket-failure" ? 0 : 1);
  assert.equal(
    closes,
    mode === "socket-failure" ? 0 : 1,
    "every opened descriptor closes exactly once",
  );
}
console.log(
  "systemd notify: portable Linux sockaddr UTF-8/abstract lengths, exact one payload, socket/send/short/throw/close failure cleanup PASS",
);
if (process.platform !== "linux") {
  assert.throws(() => notifySystemdReady("/run/notify"), /Linux/);
  console.log("systemd notify native datagram/credentials/FD checks skipped: Linux only");
} else {
  assert.ok(
    process.arch === "arm64" || process.arch === "x64",
    "native credential fixture models Linux 64-bit msghdr",
  );
  const library = getLibc();
  const socket = bindNativeFunction<(domain: number, type: number, protocol: number) => number>(
    library,
    "int socket(int domain, int type, int protocol)",
  );
  const bind = bindNativeFunction<(fd: number, address: Buffer, length: number) => number>(
    library,
    "int bind(int fd, const void *address, uint32_t length)",
  );
  const option = bindNativeFunction<
    (fd: number, level: number, option: number, value: Buffer, length: number) => number
  >(library, "int setsockopt(int fd, int level, int option, const void *value, uint32_t length)");
  const receive = bindNativeFunction<(fd: number, message: Buffer, flags: number) => NativeInteger>(
    library,
    "long recvmsg(int fd, void *message, int flags)",
  );
  const close = bindNativeFunction<(fd: number) => number>(library, "int close(int fd)");
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "moire-notify-")));
  const fdSnapshot = () => {
    const result: string[] = [];
    for (const fd of fs.readdirSync("/proc/self/fd")) {
      try {
        result.push(`${fd}:${fs.readlinkSync(`/proc/self/fd/${fd}`)}`);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    return result.sort();
  };
  const before = fdSnapshot();
  try {
    assert.throws(() => notifySystemdReady(path.join(directory, "missing")), /sendto/);
    fs.writeFileSync(path.join(directory, "regular"), "ordinary fixture");
    assert.throws(() => notifySystemdReady(path.join(directory, "regular")), /sendto/);
    for (const destination of [
      path.join(directory, "receiver"),
      `@moire-ready-${process.pid}-${randomUUID()}`,
    ]) {
      const receiver = socket(1, 2 | 0x80000 | 0x800, 0);
      assert.ok(receiver >= 0);
      const data = koffi.alloc("uint8_t", 64),
        control = koffi.alloc("uint8_t", 64),
        iov = koffi.alloc("uint8_t", 16);
      try {
        const address = systemdNotifyAddress(destination),
          enabled = Buffer.alloc(4);
        enabled.writeInt32LE(1);
        assert.equal(
          option(receiver, 1, 16, enabled, 4),
          0,
          "SO_PASSCRED enables actual kernel sender credentials",
        );
        assert.equal(bind(receiver, address, address.length), 0);
        const read = () => {
          const vector = Buffer.alloc(16);
          vector.writeBigUInt64LE(BigInt(koffi.address(data)), 0);
          vector.writeBigUInt64LE(64n, 8);
          memcpyTo(iov, vector);
          const message = Buffer.alloc(56);
          message.writeBigUInt64LE(BigInt(koffi.address(iov)), 16);
          message.writeBigUInt64LE(1n, 24);
          message.writeBigUInt64LE(BigInt(koffi.address(control)), 32);
          message.writeBigUInt64LE(64n, 40);
          const length = Number(receive(receiver, message, 0x40));
          if (length < 0) return null;
          assert.equal(length, 8);
          assert.equal(
            message.readInt32LE(48) & (0x08 | 0x20),
            0,
            "data and credential control payload are not truncated",
          );
          assert.deepEqual(Buffer.from(nativeView(data, length)), Buffer.from("READY=1\n"));
          const controlLength = Number(message.readBigUInt64LE(40));
          assert.ok(controlLength >= 28 && controlLength <= 64);
          const credential = Buffer.from(nativeView(control, controlLength));
          assert.equal(credential.readBigUInt64LE(0), 28n);
          assert.equal(credential.readInt32LE(8), 1);
          assert.equal(credential.readInt32LE(12), 2, "SCM_CREDENTIALS");
          assert.equal(
            credential.readInt32LE(16),
            process.pid,
            "readiness comes from this calling process",
          );
          assert.equal(credential.readUInt32LE(20), process.getuid?.());
          assert.equal(credential.readUInt32LE(24), process.getgid?.());
          return length;
        };
        const baseline = fdSnapshot();
        for (let index = 0; index < 32; index++) {
          notifySystemdReady(destination);
          assert.equal(read(), 8);
          assert.equal(read(), null, "one notify call delivers exactly one datagram");
        }
        assert.deepEqual(fdSnapshot(), baseline, "successful sender calls do not leak descriptors");
      } finally {
        koffi.free(data);
        koffi.free(control);
        koffi.free(iov);
        assert.equal(close(receiver), 0);
      }
    }
    assert.deepEqual(
      fdSnapshot(),
      before,
      "native failures, pathname and abstract fixtures retire all socket descriptors",
    );
    console.log(
      `systemd notify native: pathname+abstract exact datagrams, kernel SCM_CREDENTIALS pid=${process.pid} uid=${process.getuid?.()} gid=${process.getgid?.()}, unreachable/non-socket failures and FD cleanup PASS; no manager readiness/device claim`,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
