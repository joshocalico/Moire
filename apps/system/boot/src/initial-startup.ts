import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import {
  currentBootServiceIdentity,
  readBootAttemptLedger,
  readBootServiceLease,
  type BootServicePaths,
  type BootSkipReason,
} from "@moire/sys";
import { readConsoleRequestLatch } from "./console-latch";

export type InitialCommandResult =
  | { kind: "exited"; exitCode: number; diagnostic: string }
  | { kind: "failed"; reason: string };
export type InitialStartupResult =
  | {
      kind: "desktop-started" | "console-retained";
      checkpoint: string;
      bootStart: InitialCommandResult;
      bootDisposition:
        | { kind: "skipped"; reason: BootSkipReason }
        | { kind: "attempted" }
        | { kind: "not-invoked" };
      stop: InitialCommandResult;
    }
  | {
      kind: "blocked";
      phase: "configuration" | "checkpoint" | "admission" | "console" | "desktop";
      reason: string;
    };
export type InitialStartupOptions = {
  systemctlPath: string;
  cleanupPath: string;
  stateDirectory: string;
  consoleLatchPath: string;
  bootUnit?: string;
  sessionUnit?: string;
  paths?: BootServicePaths;
  environment?: NodeJS.ProcessEnv;
  timeouts?: { startMs?: number; stopMs?: number; admissionMs?: number; sessionMs?: number };
};
function executable(file: string): string {
  if (!path.isAbsolute(file) || !fs.statSync(file).isFile())
    throw new Error("Initial startup requires installed absolute command paths");
  return file;
}
function timeout(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 120000)
    throw new Error("Invalid initial startup command timeout");
  return result;
}
function invoke(
  file: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  milliseconds: number,
): Promise<InitialCommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        timeout: milliseconds,
        killSignal: "SIGKILL",
        maxBuffer: 16384,
        encoding: "utf8",
        env: environment,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ kind: "exited", exitCode: 0, diagnostic: "" });
          return;
        }
        if (typeof error.code === "number" && error.signal === null && !error.killed)
          resolve({
            kind: "exited",
            exitCode: error.code,
            diagnostic: (stderr.trim() || stdout.trim()).slice(0, 2048),
          });
        else resolve({ kind: "failed", reason: error.message });
      },
    );
  });
}
function success(result: InitialCommandResult): boolean {
  return result.kind === "exited" && result.exitCode === 0;
}
function failure(result: InitialCommandResult): string {
  return result.kind === "failed"
    ? result.reason
    : result.diagnostic || `Command exited ${result.exitCode}`;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/** One owner of serial transactions; concurrent/repeated run() calls share the same result. */
export function createInitialStartupCoordinator(options: InitialStartupOptions) {
  const config = {
    ...options,
    environment: { ...process.env, ...options.environment },
    paths: options.paths ? { ...options.paths } : undefined,
    timeouts: { ...options.timeouts },
  };
  let operation: Promise<InitialStartupResult> | null = null;
  const run = async (): Promise<InitialStartupResult> => {
    let phase: Extract<InitialStartupResult, { kind: "blocked" }>["phase"] = "configuration";
    try {
      const systemctl = executable(config.systemctlPath),
        cleanup = executable(config.cleanupPath);
      const bootUnit = config.bootUnit ?? "moire-boot.service",
        sessionUnit = config.sessionUnit ?? "moire-session.service";
      if (
        !/^[a-zA-Z0-9_.@-]+\.service$/.test(bootUnit) ||
        !/^[a-zA-Z0-9_.@-]+\.service$/.test(sessionUnit) ||
        bootUnit === sessionUnit
      )
        throw new Error("Distinct boot/session service identities required");
      if (!path.isAbsolute(config.stateDirectory) || !path.isAbsolute(config.consoleLatchPath))
        throw new Error("Absolute runtime state paths required");
      const startMs = timeout(config.timeouts?.startMs, 20000),
        stopMs = timeout(config.timeouts?.stopMs, 10000),
        admissionMs = timeout(config.timeouts?.admissionMs, 5000),
        sessionMs = timeout(config.timeouts?.sessionMs, 20000);
      const environment = {
        ...process.env,
        ...config.environment,
        MOIRE_BOOT_UNIT: bootUnit,
        MOIRE_BOOT_SERVICE_STATE: config.stateDirectory,
        MOIRE_BOOT_LATCH: config.consoleLatchPath,
        MOIRE_SYSTEMCTL: systemctl,
        LC_ALL: "C",
        SYSTEMD_COLORS: "0",
      };
      const current = currentBootServiceIdentity(environment, config.paths);
      // Readiness is the root-owned notify unit's actual start boundary, never this command timeout.
      const bootStart = await invoke(
        systemctl,
        ["--system", "--no-pager", "--no-ask-password", "start", "--", bootUnit],
        environment,
        startMs,
      );
      phase = "checkpoint";
      let checkpoint: string | null = null,
        checkpointError: string | null = null;
      try {
        const ledger = readBootAttemptLedger(config.stateDirectory, current);
        checkpoint = ledger.state === "attempted" ? ledger.invocationId : "not-invoked";
      } catch (error) {
        checkpointError = message(error);
      }
      // Stop even after a failed start/checkpoint read; never leave an owned attempt running deliberately.
      const stop = await invoke(
        systemctl,
        ["--system", "--no-pager", "--no-ask-password", "stop", "--", bootUnit],
        environment,
        stopMs,
      );
      if (checkpoint === null)
        return { kind: "blocked", phase, reason: checkpointError ?? "No recorded boot checkpoint" };
      phase = "admission";
      const admission = await invoke(
        cleanup,
        ["--admission-check", "--expect", checkpoint],
        environment,
        admissionMs,
      );
      if (!success(admission)) return { kind: "blocked", phase, reason: failure(admission) };
      const ledger = readBootAttemptLedger(config.stateDirectory, current);
      const actual = ledger.state === "attempted" ? ledger.invocationId : "not-invoked";
      if (actual !== checkpoint)
        throw new Error("Boot attempt changed after authenticated admission");
      let bootDisposition: Extract<
        InitialStartupResult,
        { kind: "desktop-started" | "console-retained" }
      >["bootDisposition"] = { kind: "not-invoked" };
      if (ledger.state === "attempted") {
        const lease = readBootServiceLease(config.stateDirectory);
        if (
          lease.bootId !== current.bootId ||
          lease.unit !== current.unit ||
          lease.invocationId !== ledger.invocationId
        )
          throw new Error("Released boot disposition identity changed");
        bootDisposition =
          lease.phase === "skipped"
            ? { kind: "skipped", reason: lease.reason }
            : { kind: "attempted" };
      }
      phase = "console";
      const latch = readConsoleRequestLatch(config.consoleLatchPath);
      if (
        latch.kind === "requested" ||
        (bootDisposition.kind === "skipped" && bootDisposition.reason === "console-requested")
      )
        return { kind: "console-retained", checkpoint, bootStart, bootDisposition, stop };
      // No boot/session start pair in one transaction. The desktop's mandatory gate rechecks proof.
      phase = "desktop";
      const desktop = await invoke(
        systemctl,
        ["--system", "--no-pager", "--no-ask-password", "start", "--", sessionUnit],
        environment,
        sessionMs,
      );
      if (!success(desktop)) return { kind: "blocked", phase, reason: failure(desktop) };
      return { kind: "desktop-started", checkpoint, bootStart, bootDisposition, stop };
    } catch (error) {
      return { kind: "blocked", phase, reason: message(error) };
    }
  };
  return { run: () => operation ?? (operation = run()) };
}
/** Source and compiled entry use one CLI; no unit/device side effects for invalid arguments. */
export async function runInitialStartupCommand(args: readonly string[]): Promise<number> {
  try {
    if (args.length !== 0) throw new Error("Usage: moire-initial-startup");
    if (process.platform !== "linux") throw new Error("Initial boot coordination requires Linux");
    const result = await createInitialStartupCoordinator({
      systemctlPath: process.env.MOIRE_SYSTEMCTL ?? "",
      cleanupPath: process.env.MOIRE_BOOT_CLEANUP ?? "",
      stateDirectory: process.env.MOIRE_BOOT_SERVICE_STATE ?? "/run/moire-boot/service",
      consoleLatchPath: process.env.MOIRE_BOOT_LATCH ?? "/run/moire-boot/console-requested",
      bootUnit: process.env.MOIRE_BOOT_UNIT,
      sessionUnit: process.env.MOIRE_SESSION_UNIT,
    }).run();
    console.log("[boot/initial]", JSON.stringify(result));
    return result.kind === "blocked" ? 1 : 0;
  } catch (error) {
    console.error("[boot/initial]", message(error));
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runInitialStartupCommand(process.argv.slice(2));
