import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAudioStatusAdapter } from "@moire/audio";
import { bindManagementShutdown } from "./main";

function fakeBus(events: string[]) {
  let listener: ((error: Error) => void) | null = null;
  return {
    close() {
      events.push("bus-close");
      listener?.(new Error("fixture bus closed"));
    },
    onDisconnect(next: (error: Error) => void) {
      listener = next;
      return () => {
        events.push("unwatch");
        listener = null;
      };
    },
    disconnect() {
      listener?.(new Error("fixture bus disconnected"));
    },
  };
}

async function worker(directory: string): Promise<void> {
  const events: string[] = [];
  const counts = { stopWatch: 0, dispose: 0, busClose: 0 };
  const watch = setInterval(() => {}, 1000);
  const connection = setInterval(() => {}, 1000);
  const bus = fakeBus(events);
  // The production adapter owns its PipeWire connection; this PipeWire accepts and never answers.
  process.env.PIPEWIRE_REMOTE = path.join(directory, "pipewire-0");
  const adapter = createAudioStatusAdapter();
  bindManagementShutdown(
    {
      onDisconnect: bus.onDisconnect,
      close() {
        counts.busClose++;
        clearInterval(connection);
        bus.close();
      },
    },
    {
      async dispose() {
        counts.dispose++;
        events.push("dispose");
        adapter.dispose();
      },
    },
    () => {
      counts.stopWatch++;
      events.push("stop-watch");
      clearInterval(watch);
    },
  );
  void adapter.refresh().then((state) => {
    fs.writeFileSync(path.join(directory, "audio-final.json"), JSON.stringify(state));
  });
  process.once("exit", (code) => {
    fs.writeFileSync(
      path.join(directory, "parent-exit.json"),
      JSON.stringify({ code, events, counts }),
    );
  });
  // No process.exit, no IPC handle and no fixture termination timer. Production
  // shutdown must close the PipeWire connection and both borrowed-lifecycle fixtures.
}

async function waitForFile(file: string, milliseconds: number): Promise<void> {
  const deadline = performance.now() + milliseconds;
  while (!fs.existsSync(file) && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert(fs.existsSync(file), `Missing fixture readiness ${file}`);
}

async function naturalSignalExit(directory: string, signal: "SIGTERM" | "SIGINT") {
  fs.mkdirSync(directory);
  // A PipeWire that accepts and never answers, so the worker's first read is in flight.
  fs.writeFileSync(
    path.join(directory, "hang.mjs"),
    'import fs from "node:fs"; import net from "node:net"; const [, , socket, dir] = process.argv;' +
      ' net.createServer((s) => { fs.writeFileSync(dir + "/connected", ""); s.on("close", () => fs.writeFileSync(dir + "/closed", "")); s.on("error", () => {}); s.resume(); })' +
      '.listen(socket, () => fs.writeFileSync(dir + "/ready", ""));',
  );
  const silent = spawn(process.execPath, [
    path.join(directory, "hang.mjs"),
    path.join(directory, "pipewire-0"),
    directory,
  ]);
  await waitForFile(path.join(directory, "ready"), 2000);
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "--worker", directory],
    {
      env: {
        ...process.env,
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (bytes: Buffer) => {
    output = (output + bytes.toString()).slice(-16 * 1024);
  });
  child.stderr.on("data", (bytes: Buffer) => {
    output = (output + bytes.toString()).slice(-16 * 1024);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
    },
  );
  // Attach a rejection observer before readiness so spawn errors cannot become
  // unhandled or strand final cleanup while no exit event will ever be delivered.
  void exited.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await waitForFile(path.join(directory, "connected"), 2000);
    const began = performance.now();
    assert(child.kill(signal));
    const result = await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${signal} natural-exit deadline: ${output}`)),
          5000,
        );
      }),
    ]);
    assert.deepEqual(result, { code: 0, signal: null }, output);
    const elapsed = performance.now() - began;
    assert(
      elapsed < 1500,
      "Shutdown must close its PipeWire connection, not wait for the request deadline",
    );
    await waitForFile(path.join(directory, "closed"), 1000);
    const final: unknown = JSON.parse(
      fs.readFileSync(path.join(directory, "audio-final.json"), "utf8"),
    );
    assert(
      final &&
        typeof final === "object" &&
        "kind" in final &&
        final.kind === "error" &&
        "reason" in final &&
        final.reason === "disposed",
    );
    const expected = {
      code: 0,
      events: ["unwatch", "stop-watch", "dispose", "bus-close"],
      counts: { stopWatch: 1, dispose: 1, busClose: 1 },
    };
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, "parent-exit.json"), "utf8")),
      expected,
    );
    console.log(
      `${signal}: natural parent exit0, PipeWire connection closed, elapsed ${Math.round(elapsed)}ms`,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    silent.kill("SIGKILL");
  }
}

if (process.argv[2] === "--worker") {
  const directory = process.argv[3];
  if (!directory) throw new Error("Missing private worker fixture");
  await worker(directory);
} else {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-management-shutdown-"));
  try {
    {
      const events: string[] = [];
      const beforeTerm = process.listenerCount("SIGTERM"),
        beforeInt = process.listenerCount("SIGINT");
      const bus = fakeBus(events);
      const shutdown = bindManagementShutdown(
        bus,
        {
          async dispose() {
            events.push("dispose");
          },
        },
        () => events.push("stop-watch"),
      );
      const first = shutdown(),
        second = shutdown();
      assert.equal(first, second, "Idempotent calls retain the same completion promise");
      await first;
      bus.disconnect();
      await shutdown();
      assert.deepEqual(events, ["unwatch", "stop-watch", "dispose", "bus-close"]);
      assert.equal(process.listenerCount("SIGTERM"), beforeTerm);
      assert.equal(process.listenerCount("SIGINT"), beforeInt);
      console.log(
        "Explicit shutdown: idempotent exact cleanup and removed signal/disconnect hooks",
      );
    }
    {
      const events: string[] = [];
      const bus = fakeBus(events);
      const shutdown = bindManagementShutdown(
        bus,
        {
          async dispose() {
            events.push("dispose");
          },
        },
        () => events.push("stop-watch"),
      );
      bus.disconnect();
      await shutdown();
      assert.deepEqual(events, ["unwatch", "stop-watch", "dispose", "bus-close"]);
      console.log("Bus disconnect: same idempotent cleanup");
    }
    {
      const events: string[] = [];
      const bus = fakeBus(events);
      const shutdown = bindManagementShutdown(
        bus,
        {
          async dispose() {
            events.push("dispose");
            throw new Error("owned disposal failure");
          },
        },
        () => events.push("stop-watch"),
      );
      await assert.rejects(shutdown(), /owned disposal failure/);
      await assert.rejects(shutdown(), /owned disposal failure/);
      assert.deepEqual(events, ["unwatch", "stop-watch", "dispose", "bus-close"]);
      console.log("Disposal error: bus still closes once and error retained");
    }
    await naturalSignalExit(path.join(directory, "term"), "SIGTERM");
    await naturalSignalExit(path.join(directory, "int"), "SIGINT");
    console.log(
      "Management shutdown: 5 cases passed; production hook + actual owned Node parent and its PipeWire connection. No live D-Bus/audio/devices.",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
