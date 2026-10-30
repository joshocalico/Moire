/** A throwaway dbus-daemon for smokes that stand in for system services. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SessionBus } from "@moire/dbus";

export type PrivateBus = {
  address: string;
  connect(): Promise<SessionBus>;
  close(): Promise<void>;
};

export async function startPrivateBus(prefix: string): Promise<PrivateBus> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const daemon = spawn(
    process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
    [
      process.env.MOIRE_TEST_DBUS_CONFIG
        ? `--config-file=${process.env.MOIRE_TEST_DBUS_CONFIG}`
        : "--session",
      "--nofork",
      "--nopidfile",
      `--address=unix:path=${path.join(directory, "bus")}`,
      "--print-address=1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let stderr = "";
  daemon.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const address = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dbus-daemon did not start: ${stderr}`)), 5000);
    daemon.once("error", reject);
    daemon.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("\n")) {
        clearTimeout(timer);
        resolve(output.trim());
      }
    });
  });
  const buses: SessionBus[] = [];
  return {
    address,
    async connect() {
      const bus = await SessionBus.connect(address);
      buses.push(bus);
      return bus;
    },
    async close() {
      for (const bus of buses) bus.close();
      daemon.kill("SIGTERM");
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

export async function until(check: () => boolean, label: string, timeoutMs = 4000) {
  const deadline = performance.now() + timeoutMs;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
