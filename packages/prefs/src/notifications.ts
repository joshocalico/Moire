/**
 * Notification policy: per-app rules and the Do not disturb schedule, as stored in
 * `settings.json`, and the pure functions the notification service and Settings share.
 *
 * Rules are keyed by app id: the notification's freedesktop `desktop-entry` hint when it sends
 * one (`org.moire.Files`), otherwise its app name (`Files`). See `notificationAppKey`.
 */

export type NotificationRule = {
  /** Off: the notification is dropped on arrival (the sender still gets an id). */
  allow: boolean;
  /** Off: it goes straight to the tray, with no banner. */
  banners: boolean;
  /** Off: it makes no sound. */
  sound: boolean;
  /** Off: it isn't kept in history once it closes. */
  history: boolean;
};

export type NotificationRules = Record<string, NotificationRule>;

export type DoNotDisturbSchedule = {
  enabled: boolean;
  /** Local wall-clock start, `HH:MM`. */
  from: string;
  /** Local wall-clock end, `HH:MM`; before `from` means the window runs overnight. */
  to: string;
};

export const DEFAULT_NOTIFICATION_RULE: NotificationRule = Object.freeze({
  allow: true,
  banners: true,
  sound: true,
  history: true,
});

export const DEFAULT_DND_SCHEDULE: DoNotDisturbSchedule = Object.freeze({
  enabled: false,
  from: "22:00",
  to: "07:00",
});

/** A hand-edited file can't make the service or Settings walk a huge table. */
export const MAX_NOTIFICATION_RULES = 256;
const MAX_KEY_LENGTH = 256;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The key a notification's rule is stored under: its desktop entry, else its app name. */
export function notificationAppKey(desktopEntry: string, appName: string): string {
  const entry = desktopEntry.trim().replace(/\.desktop$/, "");
  return (entry || appName.trim()).slice(0, MAX_KEY_LENGTH);
}

export function notificationRuleFor(rules: NotificationRules, key: string): NotificationRule {
  return Object.hasOwn(rules, key) ? rules[key]! : DEFAULT_NOTIFICATION_RULE;
}

/** Rules with only the fields that differ from the default kept; all-default rules dropped. */
export function normalizeNotificationRules(value: unknown): NotificationRules {
  const result: NotificationRules = {};
  if (!isRecord(value)) return result;
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count >= MAX_NOTIFICATION_RULES) break;
    if (!key.trim() || key.length > MAX_KEY_LENGTH || key.includes("\0") || !isRecord(item))
      continue;
    const rule: NotificationRule = {
      allow: item.allow !== false,
      banners: item.banners !== false,
      sound: item.sound !== false,
      history: item.history !== false,
    };
    if (sameRule(rule, DEFAULT_NOTIFICATION_RULE)) continue;
    // defineProperty: a key such as "__proto__" stays an ordinary entry.
    Object.defineProperty(result, key, {
      value: rule,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    count++;
  }
  return result;
}

function sameRule(a: NotificationRule, b: NotificationRule): boolean {
  return (
    a.allow === b.allow && a.banners === b.banners && a.sound === b.sound && a.history === b.history
  );
}

/** `rules` with one app's rule changed; a rule back at the default is removed. */
export function withNotificationRule(
  rules: NotificationRules,
  key: string,
  patch: Partial<NotificationRule>,
): NotificationRules {
  const next = { ...notificationRuleFor(rules, key), ...patch };
  const { [key]: _old, ...rest } = rules;
  return normalizeNotificationRules(
    sameRule(next, DEFAULT_NOTIFICATION_RULE) ? rest : { ...rest, [key]: next },
  );
}

export function normalizeDndSchedule(value: unknown): DoNotDisturbSchedule {
  if (!isRecord(value)) return { ...DEFAULT_DND_SCHEDULE };
  return {
    enabled: value.enabled === true,
    from:
      typeof value.from === "string" && TIME.test(value.from)
        ? value.from
        : DEFAULT_DND_SCHEDULE.from,
    to: typeof value.to === "string" && TIME.test(value.to) ? value.to : DEFAULT_DND_SCHEDULE.to,
  };
}

/** Minutes after local midnight for `HH:MM`. */
export function minutesOfDay(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new Error(`Invalid time ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Whether the schedule holds Do not disturb on at `now` (local time). `from` is inclusive and
 * `to` exclusive; `to` before `from` wraps past midnight, and equal times mean all day.
 */
export function dndScheduleActive(schedule: DoNotDisturbSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  const from = minutesOfDay(schedule.from);
  const to = minutesOfDay(schedule.to);
  const at = now.getHours() * 60 + now.getMinutes();
  if (from === to) return true;
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/**
 * When the scheduled window that holds `now` ends (ms), or null when the schedule isn't on at
 * `now`. An all-day schedule ends at the next `to`, a day away at most.
 */
export function dndScheduleEnd(schedule: DoNotDisturbSchedule, now: Date): number | null {
  if (!dndScheduleActive(schedule, now)) return null;
  const to = minutesOfDay(schedule.to);
  const end = new Date(now);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end.getTime();
}
