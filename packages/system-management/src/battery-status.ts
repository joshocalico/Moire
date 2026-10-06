/** Read-only UPower display-device observations, separate from power actions. */
export type BatteryChargeState =
  | "unknown"
  | "charging"
  | "discharging"
  | "empty"
  | "fully-charged"
  | "pending-charge"
  | "pending-discharge";
export type BatteryWarningLevel =
  | "unknown"
  | "none"
  | "discharging"
  | "low"
  | "critical"
  | "action";
export type DesktopBattery =
  | Readonly<{ kind: "unavailable"; message: string }>
  | Readonly<{ kind: "loading" | "error"; supported: boolean; message: string }>
  | Readonly<{
      kind: "ready";
      source: "battery" | "ups";
      percentage: number;
      chargeState: BatteryChargeState;
      onBattery: boolean;
      warningLevel: BatteryWarningLevel;
      timeToEmptySeconds: number | null;
      timeToFullSeconds: number | null;
    }>;

export const BATTERY_UNAVAILABLE: DesktopBattery = Object.freeze({
  kind: "unavailable",
  message: "UPower battery backend unavailable",
});

export function batterySupported(state: DesktopBattery): boolean {
  return (
    state.kind === "ready" ||
    ((state.kind === "loading" || state.kind === "error") && state.supported)
  );
}

export type BatteryAdapter = {
  readonly state: DesktopBattery;
  subscribe(listener: () => void): () => void;
  /** Re-read properties only; never calls UPower Device.Refresh or a power action. */
  refresh(): Promise<void>;
  dispose(): Promise<void>;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid battery status object");
  return value as Record<string, unknown>;
}
function message(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || value.includes("\0"))
    throw new Error("Invalid battery status message");
  return value;
}
function estimate(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("Invalid battery time estimate");
  return value;
}

/** Validate the existing desktop service's JSON boundary before shell presentation. */
export function parseDesktopBattery(value: unknown): DesktopBattery {
  const raw = record(value);
  if (raw.kind === "unavailable") return { kind: raw.kind, message: message(raw.message) };
  if (raw.kind === "loading" || raw.kind === "error") {
    if (typeof raw.supported !== "boolean") throw new Error("Invalid battery capability");
    return { kind: raw.kind, supported: raw.supported, message: message(raw.message) };
  }
  if (raw.kind !== "ready") throw new Error("Invalid battery status kind");
  if (raw.source !== "battery" && raw.source !== "ups") throw new Error("Invalid battery source");
  if (
    typeof raw.percentage !== "number" ||
    !Number.isFinite(raw.percentage) ||
    raw.percentage < 0 ||
    raw.percentage > 100
  )
    throw new Error("Invalid battery percentage");
  const chargeState = raw.chargeState;
  if (
    chargeState !== "unknown" &&
    chargeState !== "charging" &&
    chargeState !== "discharging" &&
    chargeState !== "empty" &&
    chargeState !== "fully-charged" &&
    chargeState !== "pending-charge" &&
    chargeState !== "pending-discharge"
  )
    throw new Error("Invalid battery charge state");
  const warningLevel = raw.warningLevel;
  if (
    warningLevel !== "unknown" &&
    warningLevel !== "none" &&
    warningLevel !== "discharging" &&
    warningLevel !== "low" &&
    warningLevel !== "critical" &&
    warningLevel !== "action"
  )
    throw new Error("Invalid battery warning level");
  if (typeof raw.onBattery !== "boolean") throw new Error("Invalid battery power source");
  return {
    kind: "ready",
    source: raw.source,
    percentage: raw.percentage,
    chargeState,
    warningLevel,
    onBattery: raw.onBattery,
    timeToEmptySeconds: estimate(raw.timeToEmptySeconds),
    timeToFullSeconds: estimate(raw.timeToFullSeconds),
  };
}
