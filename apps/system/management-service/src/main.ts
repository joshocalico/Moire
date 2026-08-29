import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { SessionBus } from "@moire/dbus";
import {
  SYSTEM_MANAGEMENT_BUS,
  SYSTEM_MANAGEMENT_INTERFACE,
  SYSTEM_MANAGEMENT_PATH,
  type ManagedProcess,
  type SystemSnapshot,
} from "@moire/system-management";

const uid = process.getuid?.() ?? 0;
const clockTicks = (() => {
  try {
    return Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;
  } catch {
    return 100;
  }
})();

type CpuSample = { ticks: number; at: number };
const cpuSamples = new Map<number, CpuSample>();

function statusValue(status: string, key: string): string | null {
  const line = status.split("\n").find((entry) => entry.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim() ?? null;
}

function procStatus(pid: number): string {
  return fs.readFileSync(`/proc/${pid}/status`, "utf8");
}

function procOwner(status: string): number {
  return Number(statusValue(status, "Uid")?.split(/\s+/)[0] ?? -1);
}

function procParent(status: string): number {
  return Number(statusValue(status, "PPid") ?? 0);
}

function ancestors(pid: number): Set<number> {
  const result = new Set<number>();
  let current = pid;
  for (let depth = 0; current > 0 && depth < 32; depth++) {
    result.add(current);
    try {
      current = procParent(procStatus(current));
    } catch {
      break;
    }
  }
  return result;
}

const protectedAncestors = ancestors(process.pid);

function procStat(pid: number): { ticks: number; rssBytes: number } {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  const ticks = Number(fields[11] ?? 0) + Number(fields[12] ?? 0);
  const rssPages = Number(fields[21] ?? 0);
  return { ticks, rssBytes: rssPages * 4096 };
}

function commandLine(pid: number): string {
  const value = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
  return value || fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
}

function workingDirectory(pid: number): string {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

type Identity = { name: string; appId: string; protected: boolean };

function identify(command: string, cwd: string, fallback: string): Identity {
  const source = `${command} ${cwd}`;
  const known: Array<[RegExp, string, string, boolean]> = [
    [
      /apps\/system\/compositor|@moire\/compositor/,
      "Moire Compositor",
      "org.moire.Compositor",
      true,
    ],
    [/apps\/system\/session|moire-session/, "Moire Session", "org.moire.Session", true],
    [
      /management-service|@moire\/system-management-service/,
      "System Management Service",
      "org.moire.SystemManagement",
      true,
    ],
    [/apps\/system\/portal|@moire\/portal/, "Desktop Portal", "org.moire.Portal", true],
    [/apps\/core\/settings|@moire\/settings/, "Settings", "org.moire.Settings", false],
    [
      /apps\/core\/process-manager|@moire\/process-manager/,
      "Process Manager",
      "org.moire.ProcessManager",
      false,
    ],
    [
      /apps\/core\/memory-pressure|@moire\/memory-pressure/,
      "Memory Pressure",
      "org.moire.MemoryPressure",
      false,
    ],
    [/apps\/bundled\/files|@moire\/files/, "Files", "org.moire.Files", false],
    [/apps\/bundled\/terminal|@moire\/terminal-app/, "Terminal", "org.moire.Terminal", false],
    [/apps\/developer\/showcase|@moire\/showcase/, "Widget Showcase", "org.moire.Showcase", false],
    [/apps\/developer\/benchmark|@moire\/benchmark/, "Moire Bench", "org.moire.Benchmark", false],
    [/\bXwayland\b/, "Xwayland", "org.moire.Xwayland", true],
    [/\bdbus-daemon\b/, "D-Bus Session", "org.freedesktop.DBus", true],
  ];
  for (const [pattern, name, appId, protectedProcess] of known) {
    if (pattern.test(source)) return { name, appId, protected: protectedProcess };
  }
  return {
    name: fallback || path.basename(command.split(/\s+/)[0] ?? "Process"),
    appId: "",
    protected: false,
  };
}

function cpuPercent(pid: number, ticks: number, now: number): number {
  const previous = cpuSamples.get(pid);
  cpuSamples.set(pid, { ticks, at: now });
  if (!previous || now <= previous.at || ticks < previous.ticks) return 0;
  return ((ticks - previous.ticks) / clockTicks / ((now - previous.at) / 1_000)) * 100;
}

function readProcess(pid: number, now = performance.now()): ManagedProcess | null {
  try {
    const status = procStatus(pid);
    if (procOwner(status) !== uid) return null;
    const command = commandLine(pid);
    const comm = statusValue(status, "Name") ?? "Process";
    const identity = identify(command, workingDirectory(pid), comm);
    const stat = procStat(pid);
    return {
      pid,
      name: identity.name,
      appId: identity.appId,
      command,
      rssBytes: stat.rssBytes,
      cpuPercent: cpuPercent(pid, stat.ticks, now),
      protected: identity.protected || protectedAncestors.has(pid),
    };
  } catch {
    return null;
  }
}

function memoryInfo(): Omit<SystemSnapshot, "processes"> {
  const values = new Map<string, number>();
  try {
    for (const line of fs.readFileSync("/proc/meminfo", "utf8").split("\n")) {
      const match = /^([^:]+):\s+(\d+)\s+kB/.exec(line);
      if (match) values.set(match[1]!, Number(match[2]) * 1024);
    }
  } catch {
    // os.totalmem/freemem keep diagnostics useful outside procfs.
  }
  return {
    totalMemoryBytes: values.get("MemTotal") ?? os.totalmem(),
    availableMemoryBytes: values.get("MemAvailable") ?? os.freemem(),
    swapTotalBytes: values.get("SwapTotal") ?? 0,
    swapFreeBytes: values.get("SwapFree") ?? 0,
  };
}

function watchMemoryPressure(): void {
  let criticalSamples = 0;
  let dialog: ChildProcess | null = null;
  let cooldownUntil = 0;
  setInterval(() => {
    const memory = memoryInfo();
    const pressure =
      memory.totalMemoryBytes > 0 ? 1 - memory.availableMemoryBytes / memory.totalMemoryBytes : 0;
    criticalSamples = pressure >= 0.92 ? criticalSamples + 1 : 0;
    if (criticalSamples < 3 || dialog || Date.now() < cooldownUntil) return;
    criticalSamples = 0;
    try {
      dialog = spawn("moire-memory-pressure", [], {
        stdio: "ignore",
        env: process.env,
      });
      dialog.once("error", (error) => {
        console.warn("[system-management] memory-pressure UI failed:", error.message);
        dialog = null;
        cooldownUntil = Date.now() + 60_000;
      });
      dialog.once("exit", () => {
        dialog = null;
        cooldownUntil = Date.now() + 60_000;
      });
      console.warn(
        `[system-management] critical memory pressure (${Math.round(pressure * 100)}%); opened recovery UI`,
      );
    } catch (error) {
      console.warn("[system-management] could not open memory-pressure UI:", error);
      cooldownUntil = Date.now() + 60_000;
    }
  }, 2_000).unref();
}

function snapshot(): SystemSnapshot {
  const now = performance.now();
  const livePids = new Set<number>();
  const processes: ManagedProcess[] = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    const item = readProcess(pid, now);
    if (!item) continue;
    livePids.add(pid);
    processes.push(item);
  }
  for (const pid of cpuSamples.keys()) {
    if (!livePids.has(pid)) cpuSamples.delete(pid);
  }
  processes.sort((a, b) => b.rssBytes - a.rssBytes || a.pid - b.pid);
  return { ...memoryInfo(), processes };
}

function terminate(pid: number, force: boolean): boolean {
  const target = readProcess(pid);
  if (!target || target.protected) return false;
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("System management service currently requires Linux procfs");
  }
  const bus = await SessionBus.connect();
  bus.exportObject(SYSTEM_MANAGEMENT_PATH, {
    name: SYSTEM_MANAGEMENT_INTERFACE,
    methods: {
      GetSnapshot: {
        inSignature: "",
        outSignature: "tttta(usssuub)",
        handler: () => {
          const state = snapshot();
          return {
            body: [
              BigInt(state.totalMemoryBytes),
              BigInt(state.availableMemoryBytes),
              BigInt(state.swapTotalBytes),
              BigInt(state.swapFreeBytes),
              state.processes.map((item) => [
                item.pid,
                item.name,
                item.appId,
                item.command,
                Math.min(0xffff_ffff, Math.round(item.rssBytes / 1024)),
                Math.min(0xffff_ffff, Math.max(0, Math.round(item.cpuPercent * 100))),
                item.protected,
              ]),
            ],
          };
        },
      },
      Terminate: {
        inSignature: "ub",
        outSignature: "b",
        handler: ({ body }) => ({
          body: [terminate(Number(body[0]), Boolean(body[1]))],
        }),
      },
    },
  });
  const ownership = await bus.requestName(SYSTEM_MANAGEMENT_BUS);
  if (ownership !== 1) throw new Error(`Could not own ${SYSTEM_MANAGEMENT_BUS}`);
  watchMemoryPressure();
  console.log(`[system-management] ready as ${SYSTEM_MANAGEMENT_BUS}`);
}

main().catch((error: unknown) => {
  console.error("[system-management] fatal:", error);
  process.exit(1);
});
