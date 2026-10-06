import { batterySupported, type DesktopBattery } from "@moire/system-management/battery-status";

export type BatteryPresentation = Readonly<{
  supported: boolean;
  available: boolean;
  title: string;
  icon: "battery" | "power";
  percentage: number | null;
  summary: string;
  charge: string;
  power: string | null;
  estimate: string | null;
  warning: string | null;
  tone: "normal" | "accent" | "warning" | "muted";
}>;

function duration(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}

/** One observed source for heading, details and panel; cache carries presence only. */
export function batteryPresentation(
  state?: DesktopBattery,
  cachedSupported = false,
): BatteryPresentation {
  if (!state || state.kind !== "ready") {
    const supported = state ? batterySupported(state) : cachedSupported;
    return {
      supported,
      available: false,
      title: "Battery",
      icon: "battery",
      percentage: null,
      summary: state?.kind === "loading" ? "Reading battery status…" : "Battery unavailable",
      charge: state ? state.message : "Battery status unavailable",
      power: null,
      estimate: null,
      warning: null,
      tone: "muted",
    };
  }
  const title = state.source === "ups" ? "UPS" : "Battery";
  const charge = {
    unknown: "Charge state unknown",
    charging: "Charging",
    discharging: "Discharging",
    empty: "Empty",
    "fully-charged": "Fully charged",
    "pending-charge": "Waiting to charge",
    "pending-discharge": "Waiting to discharge",
  }[state.chargeState];
  const warning = {
    unknown: "Warning level unknown",
    none: null,
    discharging: null,
    low: `${title} low`,
    critical: `${title} critical`,
    action: `${title} action warning reported`,
  }[state.warningLevel];
  const percentage = Math.round(state.percentage);
  const estimate =
    state.chargeState === "charging"
      ? state.timeToFullSeconds === null
        ? "Time to full unknown"
        : `About ${duration(state.timeToFullSeconds)} to full`
      : state.chargeState === "discharging"
        ? state.timeToEmptySeconds === null
          ? "Time remaining unknown"
          : `About ${duration(state.timeToEmptySeconds)} remaining`
        : null;
  return {
    supported: true,
    available: true,
    title,
    icon: state.source === "ups" ? "power" : "battery",
    percentage,
    summary: `${percentage}% · ${charge}`,
    charge,
    power: state.onBattery ? "On battery power" : "External power",
    estimate,
    warning,
    tone: ["low", "critical", "action"].includes(state.warningLevel)
      ? "warning"
      : state.chargeState === "charging" || state.chargeState === "fully-charged"
        ? "accent"
        : "normal",
  };
}
