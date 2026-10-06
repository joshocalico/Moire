import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bindNativeFunction } from "./ffi";
import { getLibc } from "./libc";
import { KeyboardGrabError, nativeKeyboardDeviceIo, openKeyboardDevice } from "./keyboard-grab";

// Explicit root-selected non-display test device. Never discover/grab a guest
// keyboard implicitly and never synthesize a key or create a uinput device.
const selected = process.env.MOIRE_TEST_KEYBOARD;
if (!selected || !/^\/dev\/input\/event\d+$/.test(selected))
  throw new Error("Set MOIRE_TEST_KEYBOARD to the explicitly authorized Linux keyboard event path");
const io = nativeKeyboardDeviceIo();

if (process.argv[2] === "--owner") {
  const opened = openKeyboardDevice(selected, { exclusive: true }, io);
  assert(opened?.typing, "selected fixture is a real typing keyboard");
  process.send?.({ ready: true, pid: process.pid, fd: opened.fd, device: opened.identity });
  process.on("message", () => {});
} else {
  const fcntl = bindNativeFunction<(fd: number, command: number) => number>(
    getLibc(),
    "int fcntl(int fd, int command)",
  );
  const dup = bindNativeFunction<(fd: number) => number>(getLibc(), "int dup(int fd)");
  const held = new Set<number>();
  const open = () => {
    const fd = io.open(selected);
    held.add(fd);
    return fd;
  };
  const close = (fd: number) => {
    io.close(fd);
    held.delete(fd);
  };
  const busy = (fd: number) =>
    assert.throws(
      () => io.grab(fd),
      (error: unknown) => error instanceof KeyboardGrabError && error.errno === 16,
    );
  let child: ReturnType<typeof fork> | undefined;
  let childExit: Promise<void> | undefined;
  const started = performance.now();
  try {
    const first = openKeyboardDevice(selected, { exclusive: true }, io);
    assert(first?.typing);
    held.add(first.fd);
    assert.equal(fcntl(first.fd, 1) & 1, 1, "actual FD_CLOEXEC flag");
    const other = open();
    busy(other);
    const alias = dup(first.fd);
    assert(alias >= 0);
    held.add(alias);
    close(first.fd);
    busy(other);
    close(alias);
    io.grab(other);
    close(other);

    const owner = openKeyboardDevice(selected, { exclusive: true }, io);
    assert(owner);
    held.add(owner.fd);
    const inherited = execFileSync(
      process.execPath,
      [
        "-e",
        `
      const fs=require('fs'); const subject=process.argv[1];
      const matches=fs.readdirSync('/proc/self/fd').filter(name=>{
        try { const stat=fs.statSync('/proc/self/fd/'+name,{bigint:true});
          return stat.isCharacterDevice()&&String(stat.rdev)===subject;
        } catch { return false; }
      }); process.stdout.write(JSON.stringify(matches));
    `,
        owner.identity,
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.deepEqual(
      JSON.parse(inherited),
      [],
      "actual exec child does not inherit keyboard aliases",
    );
    close(owner.fd);

    child = fork(fileURLToPath(import.meta.url), ["--owner"], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    childExit = new Promise<void>((resolve) => {
      child?.once("exit", () => resolve());
      child?.once("error", () => resolve());
    });
    const ready = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`keyboard owner readiness timeout: ${stderr}`)),
        5000,
      );
      child?.once("message", (message: unknown) => {
        clearTimeout(timer);
        resolve(message);
      });
      child?.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child?.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`keyboard owner exited early: ${stderr}`));
      });
    });
    assert(ready && typeof ready === "object" && "ready" in ready && ready.ready === true);
    const afterKill = open();
    busy(afterKill);
    child.kill("SIGKILL");
    await childExit;
    assert.equal(child.signalCode, "SIGKILL");
    io.grab(afterKill);
    close(afterKill);
    process.stdout.write(
      JSON.stringify({
        test: "keyboard-grab-native",
        device: selected,
        rdev: owner.identity,
        cloexec: true,
        independentBusy: true,
        duplicateLastCloseRelease: true,
        execAliasAbsent: true,
        realChildSigkillRelease: true,
        elapsedMs: performance.now() - started,
        syntheticInput: false,
        physicalCtrlCCopyAccepted: false,
      }) + "\n",
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (childExit) await childExit;
    for (const fd of held)
      try {
        io.close(fd);
      } catch {
        /* already closed */
      }
  }
}
