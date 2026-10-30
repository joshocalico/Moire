/**
 * Notifications: Do not disturb and its schedule, a rule per app (allow, banners, sound,
 * history), and the history the notification service keeps. The service reads the rules and
 * the schedule from prefs, so a change here applies to the next notification.
 */
import React from "react";
import { Button, Toggle, getUiScaleFactor, type SettingRowSpec } from "@moire/ui";
import { applicationIcon } from "@moire/ui";
import { formatTimeAgo } from "@moire/app-tools";
import {
  notificationRuleFor,
  withNotificationRule,
  type DoNotDisturbSchedule,
  type NotificationRule,
} from "@moire/prefs";
import type { PageContext } from "#settings/context";
import type { PageContent, SheetContent } from "#settings/model";
import { SheetBody } from "#settings-view/sheet-body";
import { section, timeRow, toggleRow } from "#settings-view/rows";
import { notificationApps, ruleSummary } from "./notifications-model";
import { clockLabel, scheduleTimes, withTime } from "#settings/time-choices";

const PAGE = "notifications";
/** History rows shown; the service keeps more. */
const SHOWN = 8;
/** The service accepts this many identities per DismissMany call. */
const DISMISS_BATCH = 128;
/** Sheet ids for an app's rule are `app:<rule key>`. */
const APP_SHEET = "app:";

/** Do not disturb through the notification service, journalled so Overview can undo it. */
export function setDoNotDisturb(context: PageContext, on: boolean) {
  const from = context.desktop.snapshot?.doNotDisturb ?? false;
  context.attempt(PAGE, async () => {
    const failure = await context.desktop.run("dnd", (client) => client.setDoNotDisturb(on));
    if (!failure)
      context.journal.record([{ key: "doNotDisturb", from, to: on }], {
        label: on ? "Do not disturb turned on" : "Do not disturb turned off",
        page: PAGE,
      });
    return failure;
  });
}

function clearHistory(context: PageContext) {
  const notices = context.desktop.snapshot?.notices ?? [];
  context.attempt(PAGE, async () => {
    for (let start = 0; start < notices.length; start += DISMISS_BATCH) {
      const failure = await context.desktop.run("clear-history", (client) =>
        client.dismissMany(
          notices.slice(start, start + DISMISS_BATCH).map(({ id, revision }) => ({ id, revision })),
        ),
      );
      if (failure) return `Couldn't clear notifications: ${failure}`;
    }
    return null;
  });
}

function setSchedule(context: PageContext, patch: Partial<DoNotDisturbSchedule>, label: string) {
  context.prefs.set(
    { doNotDisturbSchedule: { ...context.prefs.values.doNotDisturbSchedule, ...patch } },
    { label, page: PAGE },
  );
}

function setRule(
  context: PageContext,
  app: { id: string; name: string },
  patch: Partial<NotificationRule>,
  label: string,
) {
  context.prefs.set(
    {
      notificationRules: withNotificationRule(
        context.prefs.values.notificationRules,
        app.id,
        patch,
      ),
    },
    { label: `${app.name}: ${label}`, page: PAGE },
  );
}

/** A toggle row for a sheet, labelled here rather than from the catalog. */
function ruleRow(
  id: string,
  label: string,
  description: string,
  on: boolean,
  onChange: (on: boolean) => void,
  disabled = false,
): SettingRowSpec {
  return {
    id,
    label,
    description,
    focusId: `setting:${id}`,
    control: {
      kind: "compact",
      width: 52,
      render: () => (
        <Toggle on={on} disabled={disabled} focusId={`setting:${id}`} onChange={onChange} />
      ),
    },
  };
}

/** A time choice for the schedule; its rows show only while the schedule is on. */
function appSheet(context: PageContext, id: string): SheetContent | null {
  if (!id.startsWith(APP_SHEET)) return null;
  const key = id.slice(APP_SHEET.length);
  const app = notificationApps(
    context.desktop.snapshot?.notices ?? [],
    context.prefs.values.notificationRules,
  ).find((candidate) => candidate.id === key) ?? {
    id: key,
    name: key,
    rule: notificationRuleFor(context.prefs.values.notificationRules, key),
    count: 0,
  };
  const { rule } = app;
  const change = (patch: Partial<NotificationRule>, label: string) =>
    setRule(context, app, patch, label);
  return {
    title: app.name,
    subtitle: app.id === app.name ? "Notifications" : app.id,
    body: (size) => (
      <SheetBody
        {...size}
        intro="Do not disturb holds banners and sounds for every app while it's on."
        sections={[
          section("notifications.app-rule", undefined, [
            ruleRow(
              "notifications.app-allow",
              "Allow notifications",
              rule.allow ? "Shown in the tray" : "Dropped when they arrive",
              rule.allow,
              (on) => change({ allow: on }, on ? "notifications allowed" : "notifications off"),
            ),
            ruleRow(
              "notifications.app-banners",
              "Banners",
              "Show each one at the top of the screen",
              rule.allow && rule.banners,
              (on) => change({ banners: on }, on ? "banners on" : "banners off"),
              !rule.allow,
            ),
            ruleRow(
              "notifications.app-sound",
              "Sounds",
              "Play the app's alert sound",
              rule.allow && rule.sound,
              (on) => change({ sound: on }, on ? "sounds on" : "sounds off"),
              !rule.allow,
            ),
            ruleRow(
              "notifications.app-history",
              "Show in history",
              "Keep them in the tray after they close",
              rule.allow && rule.history,
              (on) => change({ history: on }, on ? "kept in history" : "not kept in history"),
              !rule.allow,
            ),
          ]),
        ]}
      />
    ),
  };
}

export function notificationsPage(context: PageContext): PageContent {
  const ui = getUiScaleFactor();
  const snapshot = context.desktop.snapshot;
  if (!snapshot?.notificationsAvailable)
    return {
      summary: "Banners, sounds and history",
      sections: [],
      empty: {
        icon: "bell",
        title: "Notifications aren't available",
        message: "The notification service isn't running, so there's nothing to set here yet.",
      },
    };
  const region = context.prefs.values.region;
  const schedule = context.prefs.values.doNotDisturbSchedule;
  const times = scheduleTimes(region);
  const notices = [...snapshot.notices].sort((a, b) => b.createdAt - a.createdAt);
  const history: SettingRowSpec[] = notices.slice(0, SHOWN).map((notice) => ({
    id: `notice:${notice.id}`,
    label: notice.summary || notice.appName,
    description: `${notice.appName} · ${formatTimeAgo(notice.createdAt)}${notice.closed ? "" : " · on screen"}`,
    icon: applicationIcon(notice.appName),
  }));
  const apps = notificationApps(notices, context.prefs.values.notificationRules);
  const window = `${clockLabel(schedule.from, region)} to ${clockLabel(schedule.to, region)}`;
  const scheduled = snapshot.doNotDisturbScheduled === true;
  return {
    summary: snapshot.doNotDisturb
      ? scheduled
        ? `Do not disturb is on until ${clockLabel(schedule.to, region)}`
        : "Do not disturb is on"
      : notices.length
        ? `${notices.length} in history`
        : "No notifications yet",
    sections: [
      section("notifications.alerts", undefined, [
        toggleRow(
          "notifications.dnd",
          snapshot.doNotDisturb,
          (on) => setDoNotDisturb(context, on),
          {
            description: scheduled
              ? `On by schedule until ${clockLabel(schedule.to, region)}; turning it off skips tonight`
              : snapshot.doNotDisturb
                ? "Banners and sounds are held until you turn this off"
                : "Hold banners and sounds",
            disabled: context.desktop.busy === "dnd",
          },
        ),
        toggleRow(
          "notifications.schedule",
          schedule.enabled,
          (on) =>
            setSchedule(
              context,
              { enabled: on },
              on ? `Do not disturb scheduled ${window}` : "Do not disturb schedule turned off",
            ),
          { description: schedule.enabled ? `Every day, ${window}` : "Turn it on at set hours" },
        ),
        schedule.enabled &&
          timeRow(
            context,
            "notifications.schedule-from",
            "From",
            schedule.from,
            withTime(times, schedule.from, region),
            (from) =>
              setSchedule(
                context,
                { from },
                `Do not disturb starts at ${clockLabel(from, region)}`,
              ),
          ),
        schedule.enabled &&
          timeRow(
            context,
            "notifications.schedule-to",
            "To",
            schedule.to,
            withTime(times, schedule.to, region),
            (to) =>
              setSchedule(context, { to }, `Do not disturb ends at ${clockLabel(to, region)}`),
            schedule.to < schedule.from ? "The next morning" : undefined,
          ),
      ]),
      section(
        "notifications.apps",
        "Apps",
        apps.length
          ? apps.map((app): SettingRowSpec => ({
              id: `notifications.app:${app.id}`,
              label: app.name,
              description: ruleSummary(app.rule),
              icon: applicationIcon(app.name),
              chevron: true,
              focusId: `notifications:app:${app.id}`,
              onPress: () => context.openSheet(PAGE, `${APP_SHEET}${app.id}`),
            }))
          : [
              {
                id: "notifications.app:none",
                label: "No apps have notified yet",
                description: "Each app appears here after its first notification",
              },
            ],
      ),
      section(
        "notifications.history",
        "History",
        history.length
          ? history
          : [
              {
                id: "notice:none",
                label: "No notifications yet",
                description: "They're kept here after they close",
              },
            ],
        {
          trailingWidth: 120,
          trailing: notices.length ? (
            <Button
              width={110 * ui}
              height={24 * ui}
              size="small"
              variant="ghost"
              label="Clear history"
              focusId="setting:notifications.clear"
              disabled={context.desktop.busy === "clear-history"}
              onPress={() => clearHistory(context)}
            />
          ) : undefined,
          footnote:
            notices.length > SHOWN
              ? `${notices.length - SHOWN} older notifications not shown`
              : undefined,
        },
      ),
    ],
    sheet: (id) => appSheet(context, id),
  };
}
