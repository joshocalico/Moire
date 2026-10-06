import { execFile } from "node:child_process";
import { validateCgroupPath } from "./boot-service-state";

export const bootManagerProperties = [
  "Id",
  "LoadState",
  "ActiveState",
  "InvocationID",
  "MainPID",
  "ControlPID",
  "ControlGroup",
  "Job",
  "ExecMainStartTimestampMonotonic",
  "ExecMainExitTimestampMonotonic",
  "ActiveEnterTimestampMonotonic",
  "ActiveExitTimestampMonotonic",
  "InactiveEnterTimestampMonotonic",
  "InactiveExitTimestampMonotonic",
] as const;
export type BootManagerObservation = Readonly<{
  unit: string;
  loadState: "loaded" | "not-found";
  activeState: "inactive" | "failed" | "active" | "activating" | "deactivating";
  invocationId: string | null;
  mainPid: number;
  controlPid: number;
  cgroupPath: string | null;
  jobId: number | null;
  timestamps: readonly string[];
  executed: boolean;
}>;
export type BootManagerObserver = () => Promise<BootManagerObservation>;
function unsigned(value: string, max: bigint): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > max)
    throw new Error("Malformed manager unsigned value");
  return value;
}
/** Parse one complete systemctl show batch, retaining every timestamp for stability checks. */
export function parseBootManagerObservation(text: string, unit: string): BootManagerObservation {
  if (Buffer.byteLength(text) > 16384 || text.includes("\0"))
    throw new Error("Manager input limit exceeded");
  const fields = new Map<string, string>();
  for (const line of text.trimEnd().split("\n")) {
    const equals = line.indexOf("=");
    const name = line.slice(0, equals);
    if (
      equals < 1 ||
      !bootManagerProperties.some((property) => property === name) ||
      fields.has(name)
    )
      throw new Error("Missing, duplicate or unsupported manager property");
    fields.set(name, line.slice(equals + 1));
  }
  const get = (name: (typeof bootManagerProperties)[number]) => {
    const value = fields.get(name);
    if (value === undefined) throw new Error(`Missing manager property ${name}`);
    return value;
  };
  if (!/^[a-zA-Z0-9_.@-]+\.service$/.test(unit) || get("Id") !== unit)
    throw new Error("Manager unit identity mismatch");
  const loadState = get("LoadState"),
    activeState = get("ActiveState");
  if (loadState !== "loaded" && loadState !== "not-found")
    throw new Error("Unsupported manager load state");
  if (
    activeState !== "inactive" &&
    activeState !== "failed" &&
    activeState !== "active" &&
    activeState !== "activating" &&
    activeState !== "deactivating"
  )
    throw new Error("Unsupported manager active state");
  const invocation = get("InvocationID");
  if (invocation !== "" && !/^[0-9a-f]{32}$/.test(invocation))
    throw new Error("Malformed manager invocation");
  const group = get("ControlGroup");
  if (group !== "") validateCgroupPath(group);
  const job = get("Job");
  // systemctl's (uo) Job printer emits an empty value for job ID zero.
  const jobId = job === "" ? null : Number(unsigned(job, 0xffffffffn));
  if (jobId === 0) throw new Error("Ambiguous manager job zero");
  const timestamps = bootManagerProperties
    .slice(8)
    .map((property) => unsigned(get(property), 0xffffffffffffffffn));
  const mainPid = Number(unsigned(get("MainPID"), 0x7fffffffn));
  const controlPid = Number(unsigned(get("ControlPID"), 0x7fffffffn));
  if (
    loadState === "not-found" &&
    (activeState !== "inactive" ||
      invocation ||
      group ||
      mainPid ||
      controlPid ||
      jobId !== null ||
      timestamps.some((stamp) => stamp !== "0"))
  )
    throw new Error("Collected manager unit has conflicting evidence");
  return {
    unit,
    loadState,
    activeState,
    invocationId: invocation || null,
    mainPid,
    controlPid,
    cgroupPath: group || null,
    jobId,
    timestamps,
    executed: timestamps.slice(0, 4).some((stamp) => stamp !== "0") || timestamps[5] !== "0",
  };
}
/** Read-only, one argv batch, bounded output/time, no shell or interactive authorization. */
export function observeBootManager(
  unit: string,
  executable = process.env.MOIRE_SYSTEMCTL ?? "systemctl",
): Promise<BootManagerObservation> {
  if (!/^[a-zA-Z0-9_.@-]+\.service$/.test(unit))
    return Promise.reject(new Error("Invalid boot unit"));
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        "--system",
        "--no-pager",
        "--no-ask-password",
        "show",
        "--all",
        ...bootManagerProperties.map((name) => `--property=${name}`),
        "--",
        unit,
      ],
      {
        timeout: 2000,
        killSignal: "SIGKILL",
        maxBuffer: 16384,
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C", SYSTEMD_COLORS: "0" },
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Boot manager observation failed: ${error.message}`));
          return;
        }
        try {
          resolve(parseBootManagerObservation(stdout, unit));
        } catch (failure) {
          reject(failure);
        }
      },
    );
  });
}
