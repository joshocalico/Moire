import fs from "node:fs";
import assert from "node:assert/strict";
import { closeFd, createMemfd, createPipe, truncateFd, writeFd } from "./libc";

if (process.platform !== "linux") {
  console.log("libc smoke skipped: Linux only");
} else {
  const O_CLOEXEC = 0o2000000;
  const [readFd, writePipeFd] = createPipe(O_CLOEXEC);
  try {
    assert.equal(fs.writeSync(writePipeFd, Buffer.from("moire")), 5);
    const received = Buffer.alloc(5);
    assert.equal(fs.readSync(readFd, received), 5);
    assert.equal(received.toString("utf8"), "moire");
  } finally {
    closeFd(readFd);
    closeFd(writePipeFd);
  }

  const memfd = createMemfd("moire-libc-smoke", 0x0001);
  try {
    truncateFd(memfd, 16);
    assert.equal(writeFd(memfd, Buffer.from("typed-native")), 12);
  } finally {
    closeFd(memfd);
  }

  console.log("libc smoke passed");
}
