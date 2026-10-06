import {
  checkBootDesktopAdmission,
  readBootAttemptLedger,
  readBootServiceLease,
  type BootAdmissionCheckpoint,
  type BootAdmissionResult,
} from "@moire/sys";
import { readConsoleRequestLatch } from "./console-latch";

export type DesktopAdmissionOptions = Parameters<typeof checkBootDesktopAdmission>[0] & {
  consoleLatchPath: string;
};

/**
 * Read-only final desktop gate. The unit transaction must exclude competing boot launches.
 * Release admission proves ownership; this gate additionally preserves current console intent.
 */
export async function checkDesktopAdmission(
  options: DesktopAdmissionOptions,
): Promise<BootAdmissionResult> {
  try {
    const first = await checkBootDesktopAdmission(options);
    if (first.kind === "unresolved") return first;
    const checkpoint: BootAdmissionCheckpoint =
      first.kind === "not-invoked"
        ? { kind: "never-attempted" }
        : { kind: "invocation", invocationId: first.expected.invocationId };
    const policy = (): string => {
      const ledger = readBootAttemptLedger(options.stateDirectory, options.current);
      if (checkpoint.kind === "never-attempted") {
        if (ledger.state !== "never-attempted")
          throw new Error("Boot attempt changed during desktop policy check");
      } else if (ledger.state !== "attempted" || ledger.invocationId !== checkpoint.invocationId)
        throw new Error("Boot attempt changed during desktop policy check");
      const lease =
        first.kind === "not-invoked" ? null : readBootServiceLease(options.stateDirectory);
      if (lease !== null) {
        if (
          first.kind === "not-invoked" ||
          lease.bootId !== first.expected.bootId ||
          lease.unit !== first.expected.unit ||
          lease.invocationId !== first.expected.invocationId
        )
          throw new Error("Released desktop disposition identity changed");
        if (lease.phase === "skipped" && lease.reason === "console-requested")
          throw new Error("Boot disposition requests the console");
      }
      if (readConsoleRequestLatch(options.consoleLatchPath).kind === "requested")
        throw new Error("Protected Escape latch requests the console");
      return JSON.stringify({ ledger, lease });
    };
    const before = policy();
    const final = await checkBootDesktopAdmission({ ...options, checkpoint });
    if (final.kind === "unresolved") return final;
    if (JSON.stringify(final) !== JSON.stringify(first) || policy() !== before)
      throw new Error("Desktop admission or disposition changed during final check");
    return final;
  } catch (error) {
    return { kind: "unresolved", reason: error instanceof Error ? error.message : String(error) };
  }
}
