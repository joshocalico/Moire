/**
 * Notifications' pure parts: which apps to list (those seen in the tray or history, and those
 * with a saved rule) and how a rule reads in a row.
 */
import { notificationRuleFor, type NotificationRule, type NotificationRules } from "@moire/prefs";

export type NotificationApp = {
  /** The rule key: desktop entry, else app name. */
  id: string;
  name: string;
  rule: NotificationRule;
  /** Notifications from it the service still holds. */
  count: number;
};

type Notice = { appName: string; appId?: string };

/** Apps by name: everything that has notified, plus apps whose rule was saved earlier. */
export function notificationApps(
  notices: readonly Notice[],
  rules: NotificationRules,
): NotificationApp[] {
  const apps = new Map<string, NotificationApp>();
  for (const notice of notices) {
    const id = notice.appId ?? notice.appName;
    if (!id) continue;
    const found = apps.get(id);
    if (found) found.count++;
    else
      apps.set(id, {
        id,
        name: notice.appName || id,
        rule: notificationRuleFor(rules, id),
        count: 1,
      });
  }
  for (const id of Object.keys(rules))
    if (!apps.has(id)) apps.set(id, { id, name: id, rule: rules[id]!, count: 0 });
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "Banners and sounds", "Off", "Tray only · no sound"… */
export function ruleSummary(rule: NotificationRule): string {
  if (!rule.allow) return "Off";
  const parts = [
    rule.banners ? "Banners" : "Tray only",
    rule.sound ? null : "no sound",
    rule.history ? null : "not kept in history",
  ].filter((part): part is string => !!part);
  return parts.length === 1 && rule.banners ? "Banners and sounds" : parts.join(" · ");
}
