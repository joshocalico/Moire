import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDesktopAdmission } from "./desktop-admission";
import {
  cleanupBootService,
  checkBootServiceRelease,
  serviceIdentity,
  currentBootServiceIdentity,
  initBootAttemptLedger,
  recordBootAttempt,
  checkBootDesktopAdmission,
  parseBootAdmissionCheckpoint,
  type BootAdmissionCheckpoint,
} from "@moire/sys";

/** Childless ExecStopPost command. No renderer, input, DRM or UI imports. */
export function runBootCleanup(checkOnly = false) {
  if (process.platform !== "linux") throw new Error("Boot cleanup requires Linux");
  const expected = serviceIdentity();
  const stateDirectory = process.env.MOIRE_BOOT_SERVICE_STATE ?? "/run/moire-boot/service";
  return (checkOnly ? checkBootServiceRelease : cleanupBootService)({ stateDirectory, expected });
}
export type BootCleanupCommand =
  | { kind: "cleanup" | "check" | "init-ledger" | "record-attempt" | "desktop-admission-check" }
  | { kind: "admission-check"; checkpointOutput: boolean; checkpoint?: BootAdmissionCheckpoint };
/** Parse all arguments before reading any state or invoking the manager. */
export function parseBootCleanupCommand(args: readonly string[]): BootCleanupCommand {
  if (args.length === 0) return { kind: "cleanup" };
  if (args.length === 1) {
    if (args[0] === "--check") return { kind: "check" };
    if (args[0] === "--init-ledger") return { kind: "init-ledger" };
    if (args[0] === "--record-attempt") return { kind: "record-attempt" };
    if (args[0] === "--desktop-admission-check") return { kind: "desktop-admission-check" };
    if (args[0] === "--admission-check")
      return { kind: "admission-check", checkpointOutput: false };
  }
  if (args[0] === "--admission-check") {
    if (args.length === 2 && args[1] === "--checkpoint")
      return { kind: "admission-check", checkpointOutput: true };
    if (args.length === 3 && args[1] === "--expect" && args[2] !== undefined)
      return {
        kind: "admission-check",
        checkpointOutput: false,
        checkpoint: parseBootAdmissionCheckpoint(args[2]),
      };
  }
  throw new Error(
    "Usage: moire-boot-cleanup [--check|--init-ledger|--record-attempt|--desktop-admission-check|--admission-check [--checkpoint|--expect TOKEN]]",
  );
}
/** Shared source/bundled CLI executor. Admission/check modes never enter the mutating retry loop. */
export async function runBootCleanupCommand(args: readonly string[]): Promise<number> {
  try {
    const command = parseBootCleanupCommand(args);
    if (process.platform !== "linux") throw new Error("Boot cleanup requires Linux");
    const stateDirectory = process.env.MOIRE_BOOT_SERVICE_STATE ?? "/run/moire-boot/service";
    if (command.kind === "init-ledger") {
      console.log(
        "[boot/cleanup]",
        JSON.stringify(initBootAttemptLedger(stateDirectory, currentBootServiceIdentity())),
      );
      return 0;
    }
    if (command.kind === "record-attempt") {
      console.log(
        "[boot/cleanup]",
        JSON.stringify(await recordBootAttempt({ stateDirectory, expected: serviceIdentity() })),
      );
      return 0;
    }
    if (command.kind === "admission-check" || command.kind === "desktop-admission-check") {
      const options = {
        stateDirectory,
        current: currentBootServiceIdentity(),
        checkpoint: command.kind === "admission-check" ? command.checkpoint : undefined,
      };
      const result =
        command.kind === "desktop-admission-check"
          ? await checkDesktopAdmission({
              ...options,
              consoleLatchPath: process.env.MOIRE_BOOT_LATCH ?? "/run/moire-boot/console-requested",
            })
          : await checkBootDesktopAdmission(options);
      if (result.kind === "unresolved") {
        console.error("[boot/cleanup]", result.reason);
        return 1;
      }
      if (command.kind === "admission-check" && command.checkpointOutput)
        console.log(result.kind === "not-invoked" ? "not-invoked" : result.expected.invocationId);
      else console.log("[boot/cleanup]", JSON.stringify(result));
      return 0;
    }
    if (command.kind === "check") {
      const result = runBootCleanup(true);
      console.log("[boot/cleanup]", JSON.stringify(result));
      return result.kind === "released" || result.kind === "skipped" ? 0 : 1;
    }
    const budgetText = process.env.MOIRE_BOOT_CLEANUP_MS ?? "2000";
    if (!/^(0|[1-9][0-9]*)$/.test(budgetText) || Number(budgetText) > 10000)
      throw new Error("MOIRE_BOOT_CLEANUP_MS must be 0..10000");
    const deadline = performance.now() + Number(budgetText);
    let result = runBootCleanup(false);
    while (result.kind === "pending" && performance.now() < deadline) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(20, Math.max(1, deadline - performance.now()))),
      );
      result = runBootCleanup(false);
    }
    console.log("[boot/cleanup]", JSON.stringify(result));
    return result.kind === "released" || result.kind === "skipped" ? 0 : 1;
  } catch (error) {
    console.error("[boot/cleanup]", error instanceof Error ? error.message : error);
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runBootCleanupCommand(process.argv.slice(2));
