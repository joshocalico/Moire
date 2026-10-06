import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openSync, closeSync, fstatSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRendererLifetime } from "./renderer-lifetime";

const [mode, reportPath] = process.argv.slice(2);
if (!mode || !reportPath) throw new Error("Expected mode and disposable report path");
const feedback = {
  sequence: 0,
  seconds: 0,
  nanoseconds: 0,
  vsync: false,
  hardwareClock: false,
  hardwareCompletion: false,
};

if (mode === "guardian") {
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "fixed", reportPath],
    {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  child.on("error", (error) => {
    throw error;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else if (mode === "baseline") {
  const fd = openSync(`${reportPath}.resource`, "w", 0o600);
  await new Promise<void>((resolve) => {
    process.once("disconnect", resolve);
    console.log(JSON.stringify({ ready: true, pid: process.pid }));
  });
  closeSync(fd);
  writeFileSync(reportPath, JSON.stringify({ released: true, connected: process.connected }));
  // Exact installed finally expression, without an 'error' handler that masks failure.
  process.disconnect?.();
} else if (mode === "closed-send-callback" || mode === "closed-send-unguarded") {
  const send = process.send?.bind(process);
  assert.ok(send);
  await new Promise<void>((resolve) => {
    process.once("disconnect", resolve);
    console.log(JSON.stringify({ ready: true, pid: process.pid }));
  });
  if (mode === "closed-send-unguarded") {
    writeFileSync(reportPath, JSON.stringify({ released: true, connected: process.connected }));
    // Exact old send semantics: a later process error, not a caught return value.
    send({ kind: "scanout-accepted", feedback });
  } else {
    let callbackSynchronous = true;
    const result = new Promise<void>((resolve, reject) => {
      send({ kind: "scanout-accepted", feedback }, (error) => {
        try {
          assert.ok(error && "code" in error);
          assert.equal(error.code, "ERR_IPC_CHANNEL_CLOSED");
          assert.equal(callbackSynchronous, false);
          writeFileSync(reportPath, JSON.stringify({ callbackError: error.code, released: true }));
          resolve();
        } catch (failure) {
          reject(failure);
        }
      });
    });
    callbackSynchronous = false;
    await result;
  }
} else {
  if (mode === "already-disconnected") {
    await new Promise<void>((resolve) => {
      process.once("disconnect", resolve);
      console.log(JSON.stringify({ ready: true, pid: process.pid }));
    });
  }
  const events = ["SIGTERM", "SIGINT", "disconnect"];
  const before = events.map((event) => process.listenerCount(event));
  const lifetime = createRendererLifetime();
  const fd = openSync(`${reportPath}.resource`, "w", 0o600);
  const deadline = setTimeout(() => {
    throw new Error("Disposable child exceeded stop deadline");
  }, 5_000);
  let unexpected = "";
  try {
    if (mode === "serialization-error") {
      await assert.rejects(
        lifetime.notifyScanoutAccepted({
          ...feedback,
          get sequence(): number {
            throw new Error("Unexpected serialization failure");
          },
        }),
        /Unexpected serialization failure/,
      );
      unexpected = "preserved";
      assert.equal(lifetime.isStopped(), true);
    } else {
      if (mode !== "first-send-race") await lifetime.notifyScanoutAccepted(feedback);
      if (mode !== "already-disconnected")
        console.log(JSON.stringify({ ready: true, pid: process.pid }));
      if (mode === "first-send-race") {
        await new Promise<void>((resolve) => process.once("message", () => resolve()));
        await lifetime.notifyScanoutAccepted(feedback);
      }
      if (mode === "send-race") {
        for (let index = 0; index < 10_000 && !lifetime.isStopped(); index++) {
          await lifetime.notifyScanoutAccepted({ ...feedback, sequence: index });
        }
      }
      await lifetime.waitForStop();
      // A notification after stop must neither send nor revive the lifetime.
      await lifetime.notifyScanoutAccepted(feedback);
    }
  } finally {
    closeSync(fd);
    assert.throws(() => fstatSync(fd), { code: "EBADF" });
    lifetime.close();
    lifetime.close();
    clearTimeout(deadline);
    assert.deepEqual(
      events.map((event) => process.listenerCount(event)),
      before,
    );
    writeFileSync(
      reportPath,
      JSON.stringify({
        released: true,
        connected: process.connected,
        stopped: lifetime.isStopped(),
        listenersRestored: true,
        unexpected,
      }),
    );
  }
}
