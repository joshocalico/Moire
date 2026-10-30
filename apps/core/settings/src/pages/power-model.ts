/** Power & Battery's pure parts: the battery's state in words, and who may keep it awake. */
import type { DesktopBattery } from "@moire/system-management/battery-status";
import type {
  SleepBlockerGrant,
  SleepBlockerRequest,
} from "@moire/system-management/power-settings";

type ReadyBattery = Extract<DesktopBattery, { kind: "ready" }>;

/** "3 h 12 min", "45 min", "under a minute". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function chargeLabel(battery: ReadyBattery): string {
  switch (battery.chargeState) {
    case "charging":
      return "Charging";
    case "discharging":
      return "On battery";
    case "fully-charged":
      return "Fully charged";
    case "empty":
      return "Empty";
    case "pending-charge":
      return "Plugged in, not charging";
    case "pending-discharge":
      return "Waiting to discharge";
    case "unknown":
      return battery.onBattery ? "On battery" : "Plugged in";
  }
}

/** "3 h 12 min left", "1 h until full", or the charge state when there's no estimate. */
export function batteryDetail(battery: ReadyBattery): string {
  if (battery.timeToEmptySeconds && battery.onBattery)
    return `${formatDuration(battery.timeToEmptySeconds)} left`;
  if (battery.timeToFullSeconds && !battery.onBattery)
    return `${formatDuration(battery.timeToFullSeconds)} until full`;
  return chargeLabel(battery);
}

export const batteryPercent = (battery: ReadyBattery) => `${Math.round(battery.percentage)}%`;

/** One app under "Apps that can keep this computer awake". */
export type AwakeApp = {
  /** Stable within the list; the identity, or the name of an app that has none. */
  key: string;
  /** What a grant is stored under; null for an app that could not be identified. */
  grant: SleepBlockerGrant | null;
  name: string;
  detail: string;
  allowed: boolean;
  holding: boolean;
  x11: boolean;
};

function awakeDetail(app: Pick<AwakeApp, "allowed" | "holding" | "x11">, known: boolean): string {
  if (!known) return "Couldn't be identified, so it can't be allowed";
  const state = app.holding
    ? app.allowed
      ? "Keeping this computer awake now"
      : "Asking now, but closing the lid still sleeps"
    : app.allowed
      ? "Can keep this computer awake"
      : "Asked to keep this computer awake";
  return app.x11 ? `${state} · Runs under X11` : state;
}

/**
 * The apps to offer a switch for: those the compositor saw asking (holding ones first), then
 * allowed apps that have not asked this session, so a grant can always be taken back. The stored
 * grants decide `allowed`, so a switch answers at once.
 */
export function awakeApps(
  grants: readonly SleepBlockerGrant[],
  requests: readonly SleepBlockerRequest[],
): AwakeApp[] {
  const granted = new Map(grants.map((grant) => [grant.id, grant]));
  const seen = new Set<string>();
  const apps: AwakeApp[] = [];
  for (const request of requests) {
    const key = request.id ?? `unidentified:${request.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state = {
      allowed: request.id !== null && granted.has(request.id),
      holding: request.holding,
      x11: request.x11,
    };
    apps.push({
      key,
      grant: request.id === null ? null : { id: request.id, name: request.name, x11: request.x11 },
      name: request.id === null ? `Unidentified app (${request.name})` : request.name,
      detail: awakeDetail(state, request.id !== null),
      ...state,
    });
  }
  const idle = grants
    .filter((grant) => !seen.has(grant.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const grant of idle) {
    const state = { allowed: true, holding: false, x11: grant.x11 };
    apps.push({
      key: grant.id,
      grant,
      name: grant.name,
      detail: awakeDetail(state, true),
      ...state,
    });
  }
  return apps;
}

/** The note under the list: the rule, and what an X11 grant really covers. */
export function awakeFootnote(apps: readonly AwakeApp[]): string {
  const rule =
    "Off unless you turn it on. Any app can hold off sleep while this computer is idle; only the apps turned on here can keep it awake with the lid closed. Choosing Suspend still sleeps, and so does a critically low battery.";
  return apps.some((app) => app.x11)
    ? `${rule} Apps under X11 can control each other, so allowing one allows them all.`
    : rule;
}
