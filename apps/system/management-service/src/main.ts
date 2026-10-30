import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { SessionBus } from "@moire/dbus";
import { attachDesktopControls } from "./desktop-controls";
import { attachStorageControls } from "./storage-controls";
import { attachSystemSettings } from "./system-settings";
import { attachSessionPowerControls } from "./power-profiles";
import { attachBrightnessControls } from "./backlight";
import { attachAppearanceSchedule } from "./appearance-schedule";
import { createUDisksStorageAdapter } from "./udisks-storage";
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

function processArguments(pid: number): string[] {
  return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
}

function workingDirectory(pid: number): string {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

export type ProcessIdentity = { name: string; appId: string; protected: boolean };
export type ProcessCatalog = {
  scripts: ReadonlyMap<string, ProcessIdentity>;
  launchers: ReadonlyMap<string, ProcessIdentity>;
  tsxScripts: ReadonlySet<string>;
};

/** Read identities from this installation, never from a process's working directory. */
export function loadProcessCatalog(root: string): ProcessCatalog {
  const scripts = new Map<string, ProcessIdentity>();
  const launchers = new Map<string, ProcessIdentity>();
  const register = (directory: string, identity: ProcessIdentity, launcher?: string) => {
    for (const extension of ["ts", "tsx"])
      scripts.set(path.join(root, "apps", directory, "src", `main.${extension}`), identity);
    if (launcher) launchers.set(path.join(root, "apps", directory, launcher), identity);
  };
  const existing: Array<[string, string, string, boolean, string?]> = [
    ["system/compositor", "Moire Compositor", "org.moire.Compositor", true],
    ["system/session", "Moire Session", "org.moire.Session", true, "moire-session"],
    ["system/management-service", "System Management Service", "org.moire.SystemManagement", true],
    ["system/index-service", "File Index", "org.moire.Index", false],
    ["system/portal", "Desktop Portal", "org.moire.Portal", true, "moire-portal"],
    ["core/settings", "Settings", "org.moire.Settings", false, "moire-settings"],
    [
      "core/process-manager",
      "System Monitor",
      "org.moire.ProcessManager",
      false,
      "moire-process-manager",
    ],
    [
      "core/memory-pressure",
      "Memory Pressure",
      "org.moire.MemoryPressure",
      false,
      "moire-memory-pressure",
    ],
    ["bundled/files", "Files", "org.moire.Files", false, "moire-files"],
    ["bundled/terminal", "Terminal", "org.moire.Terminal", false, "moire-terminal"],
    ["developer/showcase", "Widget Showcase", "org.moire.Showcase", false, "moire-showcase"],
    ["developer/benchmark", "Moire Bench", "org.moire.Benchmark", false, "moire-benchmark"],
  ];
  for (const [directory, name, appId, protectedProcess, launcher] of existing)
    register(directory, { name, appId, protected: protectedProcess }, launcher);
  for (const category of ["bundled", "core", "developer"]) {
    const categoryPath = path.join(root, "apps", category);
    if (!fs.existsSync(categoryPath)) continue;
    for (const app of fs.readdirSync(categoryPath, { withFileTypes: true })) {
      if (!app.isDirectory()) continue;
      const directory = path.join(categoryPath, app.name);
      for (const entry of fs.readdirSync(directory)) {
        if (!entry.endsWith(".desktop")) continue;
        const values = new Map<string, string>();
        let inEntry = false;
        for (const line of fs.readFileSync(path.join(directory, entry), "utf8").split("\n")) {
          if (line.startsWith("[")) inEntry = line.trim() === "[Desktop Entry]";
          else if (inEntry) {
            const match = /^(Name|StartupWMClass|Exec)=(.*)$/.exec(line);
            if (match) values.set(match[1]!, match[2]!.trim());
          }
        }
        const name = values.get("Name"),
          appId = values.get("StartupWMClass");
        const launcher = values.get("Exec")?.split(/\s+/)[0];
        if (!name || !appId || !launcher || !/^moire-[a-z0-9-]+$/.test(launcher)) continue;
        register(`${category}/${app.name}`, { name, appId, protected: false }, launcher);
      }
    }
  }
  const tsxScripts = new Set<string>();
  const tsxLauncher = path.join(root, "node_modules", ".bin", "tsx");
  if (fs.existsSync(tsxLauncher)) {
    tsxScripts.add(tsxLauncher);
    tsxScripts.add(fs.realpathSync(tsxLauncher));
  }
  return { scripts, launchers, tsxScripts };
}

function scriptArgument(
  args: readonly string[],
  runtime: "node" | "tsx" | "shell",
): { value: string; index: number } | null {
  const withValue = new Set(
    runtime === "node"
      ? ["--require", "-r", "--import", "--loader", "--experimental-loader", "--conditions", "-C"]
      : runtime === "tsx"
        ? ["--tsconfig"]
        : [],
  );
  const flags = new Set(
    runtime === "node"
      ? [
          "--enable-source-maps",
          "--no-warnings",
          "--experimental-strip-types",
          "--inspect",
          "--inspect-brk",
        ]
      : runtime === "tsx"
        ? ["--no-cache"]
        : ["-e", "-u", "-eu", "-ue"],
  );
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--")
      return args[index + 1] ? { value: args[index + 1]!, index: index + 1 } : null;
    if (!argument.startsWith("-")) return { value: argument, index };
    const option = argument.split("=")[0]!;
    if (withValue.has(option)) {
      if (!argument.includes("=")) index++;
    } else if (!flags.has(option)) return null;
  }
  return null;
}

/** Only the executed entrypoint identifies an app; document arguments and cwd cannot. */
export function identifyProcess(
  argv: readonly string[],
  cwd: string,
  fallback: string,
  catalog: ProcessCatalog,
): ProcessIdentity {
  const executable = argv[0] ?? "";
  const basename = path.basename(executable);
  const external =
    basename === "Xwayland"
      ? { name: "Xwayland", appId: "org.moire.Xwayland", protected: true }
      : basename === "dbus-daemon"
        ? { name: "D-Bus Session", appId: "org.freedesktop.DBus", protected: true }
        : null;
  if (external) return external;
  const resolve = (value: string) => path.resolve(cwd || "/", value);
  const launcher = catalog.launchers.get(resolve(executable));
  if (launcher) return launcher;
  let script: string | null = null;
  if (basename === "node" || basename === "nodejs") {
    const argument = scriptArgument(argv.slice(1), "node");
    script = argument?.value ?? null;
    if (argument) {
      let entrypoint = resolve(argument.value);
      try {
        entrypoint = fs.realpathSync(entrypoint);
      } catch {
        /* Missing processes remain unidentified. */
      }
      if (catalog.tsxScripts.has(entrypoint))
        script = scriptArgument(argv.slice(argument.index + 2), "tsx")?.value ?? null;
    }
  } else if (basename === "tsx") script = scriptArgument(argv.slice(1), "tsx")?.value ?? null;
  else if (["bash", "sh", "zsh"].includes(basename)) {
    const argument = scriptArgument(argv.slice(1), "shell");
    if (argument) {
      const identity = catalog.launchers.get(resolve(argument.value));
      if (identity) return identity;
    }
  }
  const identity = script ? catalog.scripts.get(resolve(script)) : undefined;
  return identity ?? { name: fallback || basename || "Process", appId: "", protected: false };
}

const processCatalog = loadProcessCatalog(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

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
    const argv = processArguments(pid);
    const command = argv.join(" ") || fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    const comm = statusValue(status, "Name") ?? "Process";
    const identity = identifyProcess(argv, workingDirectory(pid), comm, processCatalog);
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

function watchMemoryPressure(): () => void {
  let criticalSamples = 0;
  let dialog: ChildProcess | null = null;
  let cooldownUntil = 0;
  const timer = setInterval(() => {
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
  return () => {
    clearInterval(timer);
    dialog?.kill("SIGTERM");
  };
}

/** Normal process signals must retire owned audio children before leaving. */
export function bindManagementShutdown(
  bus: Pick<SessionBus, "close" | "onDisconnect">,
  controls: { dispose(): Promise<void> },
  stopWatch: () => void = () => {},
): () => Promise<void> {
  let pending: Promise<void> | null = null;
  let removeDisconnect = () => {};
  const shutdown = (): Promise<void> => {
    if (pending) return pending;
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    removeDisconnect();
    stopWatch();
    pending = Promise.resolve()
      .then(() => controls.dispose())
      .finally(() => bus.close());
    return pending;
  };
  const onSignal = () => {
    void shutdown().catch((error) => {
      console.error("[system-management] shutdown:", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  removeDisconnect = bus.onDisconnect(onSignal);
  return shutdown;
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
  const controls = await attachDesktopControls(bus, { notificationActions: true });
  let storage: ReturnType<typeof attachStorageControls>;
  try {
    const adapter = await createUDisksStorageAdapter();
    try {
      storage = attachStorageControls(bus, {
        adapter,
        onError: () =>
          console.error("[system-management] storage: status publication or cleanup failed"),
      });
    } catch (error) {
      await adapter.dispose();
      throw error;
    }
  } catch (error) {
    await controls.dispose().finally(() => bus.close());
    throw error;
  }
  const settings = await attachSystemSettings(bus);
  const power = await attachSessionPowerControls(bus);
  const brightness = attachBrightnessControls(bus, {
    onError: (error) => console.warn("[system-management] brightness:", error),
  });
  const appearance = attachAppearanceSchedule({
    onError: (error) => console.warn("[system-management] automatic dark style:", error),
  });
  bindManagementShutdown(
    bus,
    {
      async dispose() {
        try {
          await Promise.allSettled([
            storage.dispose(),
            settings.dispose(),
            power.dispose(),
            brightness.dispose(),
            appearance.dispose(),
          ]);
        } finally {
          await controls.dispose();
        }
      },
    },
    watchMemoryPressure(),
  );
  console.log(`[system-management] ready as ${SYSTEM_MANAGEMENT_BUS}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error("[system-management] fatal:", error);
    process.exit(1);
  });
