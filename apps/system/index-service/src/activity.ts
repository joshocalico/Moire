/**
 * When the crawl may run. It yields between every batch, and holds off while the machine is busy
 * or on battery below 20%, so indexing never competes with what the user is doing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn, setTimeout as sleep } from "node:timers/promises";

const LOW_BATTERY_PERCENT = 20;
/** Busy: the one-minute load average per CPU is above this. */
const BUSY_LOAD_PER_CPU = 0.8;
/** How often a paused crawl looks again. */
const PAUSED_RECHECK_MS = 30_000;
/** Between batches the battery and load are read at most this often. */
const RUNNING_RECHECK_MS = 5_000;

export type PauseReason = "busy" | "battery" | null;
export type Battery = { percent: number; discharging: boolean } | null;

export type ActivitySource = {
  battery(): Promise<Battery>;
  /** One-minute load average divided by the CPU count. */
  loadPerCpu(): number;
};

/** The first battery under /sys/class/power_supply; none on desktops and in most VMs. */
async function readBattery(root = "/sys/class/power_supply"): Promise<Battery> {
  let supplies: string[];
  try {
    supplies = await fs.readdir(root);
  } catch {
    return null;
  }
  for (const supply of supplies) {
    try {
      const type = (await fs.readFile(path.join(root, supply, "type"), "utf8")).trim();
      if (type !== "Battery") continue;
      const percent = Number(
        (await fs.readFile(path.join(root, supply, "capacity"), "utf8")).trim(),
      );
      const status = (await fs.readFile(path.join(root, supply, "status"), "utf8")).trim();
      if (Number.isFinite(percent)) return { percent, discharging: status === "Discharging" };
    } catch {
      // A supply without these attributes is not one we can read.
    }
  }
  return null;
}

export const systemActivity: ActivitySource = {
  battery: () => readBattery(),
  loadPerCpu: () => os.loadavg()[0]! / Math.max(1, os.availableParallelism()),
};

async function pauseReason(source: ActivitySource): Promise<PauseReason> {
  const battery = await source.battery();
  if (battery?.discharging && battery.percent < LOW_BATTERY_PERCENT) return "battery";
  return source.loadPerCpu() > BUSY_LOAD_PER_CPU ? "busy" : null;
}

export type Gate = {
  /** Yield to the event loop, then wait while paused. Rejects once `signal` aborts. */
  pass(signal: AbortSignal): Promise<void>;
};

export function activityGate(
  source: ActivitySource,
  onPause: (reason: PauseReason) => void,
  recheckMs = PAUSED_RECHECK_MS,
): Gate {
  let paused: PauseReason = null;
  let checkedAt = -Infinity;
  return {
    async pass(signal) {
      await nextTurn(undefined, { signal });
      if (!paused && performance.now() - checkedAt < RUNNING_RECHECK_MS) return;
      for (;;) {
        checkedAt = performance.now();
        const reason = await pauseReason(source);
        if (reason !== paused) {
          paused = reason;
          onPause(reason);
        }
        if (!reason) return;
        await sleep(recheckMs, undefined, { signal });
      }
    },
  };
}
