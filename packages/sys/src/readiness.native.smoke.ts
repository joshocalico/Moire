/** Real epoll/eventfd liveness when there are more owners than native worker slots. */
import assert from "node:assert/strict";
import { LinuxReadinessDispatcher } from "./readiness";
import { getLibc, closeFd } from "./libc";
import { bindNativeFunction, type NativeInteger } from "./ffi";

assert.equal(process.platform, "linux", "This proof requires Linux, not a host skip");
const eventfd = bindNativeFunction<(value: number, flags: number) => number>(
  getLibc(),
  "int eventfd(unsigned int initval, int flags)",
);
const write = bindNativeFunction<(fd: number, bytes: Buffer, length: number) => NativeInteger>(
  getLibc(),
  "long write(int fd, const void *buf, size_t count)",
);
const read = bindNativeFunction<(fd: number, bytes: Buffer, length: number) => NativeInteger>(
  getLibc(),
  "long read(int fd, void *buf, size_t count)",
);
const owners: LinuxReadinessDispatcher[] = [];
const fds: number[] = [];
const hits = new Set<number>();
const value = Buffer.alloc(8);
value.writeBigUInt64LE(1n);
const waitFor = async (index: number) => {
  const deadline = Date.now() + 1200;
  while (!hits.has(index) && Date.now() < deadline)
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.ok(hits.has(index), `Readiness owner ${index} must progress while other owners are idle`);
};
try {
  for (let index = 0; index < 8; index++) {
    const fd = eventfd(0, 0x80000 | 0x800);
    assert.ok(fd >= 0);
    const owner = new LinuxReadinessDispatcher(`readiness-proof-${index}`);
    owners.push(owner);
    fds.push(fd);
    owner.add(fd, () => {
      assert.equal(Number(read(fd, Buffer.alloc(8), 8)), 8);
      hits.add(index);
    });
  }
  // The first seven idle owners must not monopolize all async native workers.
  assert.equal(Number(write(fds[7]!, value, 8)), 8);
  await waitFor(7);
  owners[0]!.stop();
  assert.throws(() => owners[0]!.add(fds[0]!, () => {}), /stopped/);
  assert.equal(Number(write(fds[6]!, value, 8)), 8);
  await waitFor(6);
} finally {
  for (const owner of owners) owner.stop();
  for (const fd of fds) closeFd(fd);
}
// Retiring every owner must allow a fresh queue in the same process.
const fresh = new LinuxReadinessDispatcher("readiness-proof-fresh");
const fd = eventfd(0, 0x80000 | 0x800);
try {
  fresh.add(fd, () => {
    assert.equal(Number(read(fd, Buffer.alloc(8), 8)), 8);
    hits.add(8);
  });
  assert.equal(Number(write(fd, value, 8)), 8);
  await waitFor(8);
} finally {
  fresh.stop();
  closeFd(fd);
}
console.log(
  JSON.stringify({
    suite: "shared native readiness liveness",
    owners: 8,
    stoppedOwnerIsolation: true,
    freshQueue: true,
    deviceAccess: 0,
    actualExitCode: 0,
  }),
);
