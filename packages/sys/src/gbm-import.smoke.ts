import assert from "node:assert/strict";
import { openOwnedGbmImporter } from "./gbm";
import { O_CLOEXEC, O_RDWR } from "./libc";

function fixture(openFailures: string[], createFailures: number[]) {
  const opened: string[] = [];
  const closed: number[] = [];
  const constructed: number[] = [];
  let nextFd = 40;
  const io = {
    open(path: string, flags: number) {
      assert.equal(flags, O_RDWR | O_CLOEXEC);
      opened.push(path);
      if (openFailures.includes(path)) throw new Error(`denied ${path}`);
      return nextFd++;
    },
    close(fd: number) {
      assert.notEqual(fd, 9, "never close the original KMS descriptor");
      assert.ok(!closed.includes(fd), "owned descriptor closes once");
      closed.push(fd);
    },
    create(fd: number) {
      constructed.push(fd);
      if (createFailures.includes(fd)) throw new Error("GBM initialization unavailable");
      let destroyed = false;
      return {
        fd,
        destroy() {
          if (destroyed) return;
          destroyed = true;
          io.close(fd);
        },
      };
    },
  };
  return { io, opened, closed, constructed };
}

const first = fixture([], []);
const render = openOwnedGbmImporter(9, first.io);
assert.deepEqual(first.opened, ["/dev/dri/renderD128"]);
assert.deepEqual(first.closed, []);
render.destroy();
render.destroy();
assert.deepEqual(first.closed, [40]);

const retry = fixture([], [40]);
const second = openOwnedGbmImporter(9, retry.io);
assert.deepEqual(retry.opened, ["/dev/dri/renderD128", "/dev/dri/renderD129"]);
assert.deepEqual(retry.closed, [40], "failed initialization relinquishes its own fd");
second.destroy();
assert.deepEqual(retry.closed, [40, 41]);

const noRender = ["/dev/dri/renderD128", "/dev/dri/renderD129"];
const reopen = fixture(noRender, []);
const fallback = openOwnedGbmImporter(9, reopen.io);
assert.deepEqual(reopen.opened, [...noRender, "/proc/self/fd/9"]);
assert.deepEqual(reopen.constructed, [40], "reopen succeeds before transferring ownership");
fallback.destroy();
assert.deepEqual(reopen.closed, [40]);

const failedReopen = fixture(noRender, [40]);
assert.throws(() => openOwnedGbmImporter(9, failedReopen.io), AggregateError);
assert.deepEqual(failedReopen.closed, [40]);
assert.deepEqual(
  failedReopen.constructed,
  [40],
  "no borrowed KMS construction after reopen failure",
);

const denied = fixture([...noRender, "/proc/self/fd/9"], []);
assert.throws(() => openOwnedGbmImporter(9, denied.io), AggregateError);
assert.deepEqual(denied.constructed, []);
assert.deepEqual(denied.closed, []);
console.log(
  "GBM production owned-import selection: render retry, independent proc reopen, denied/failed construction cleanup and original fd preservation PASS (portable boundary; no native claim)",
);
