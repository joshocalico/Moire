/**
 * Power & Battery: the battery, the power mode, and when the screen dims, turns off and the
 * computer suspends, on battery and plugged in; then the lid and the power button.
 */
import React from "react";
import { PictureOptions, Toggle, getUiScaleFactor, IconTile, type SettingRowSpec } from "@moire/ui";
import { POWER_CHOICES, type PowerSettings } from "@moire/prefs";
import { batterySupported } from "@moire/system-management/battery-status";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { section, selectRow, toggleRow } from "#settings-view/rows";
import {
  awakeApps,
  awakeFootnote,
  batteryDetail,
  batteryPercent,
  chargeLabel,
  type AwakeApp,
} from "./power-model";

const PAGE = "power";
type Source = "ac" | "battery";
type Profile = (typeof POWER_CHOICES.powerProfile)[number];

const PROFILE_LABELS: Record<Profile, string> = {
  "power-saver": "Power saver",
  balanced: "Balanced",
  performance: "Performance",
};
const PROFILE_ICONS = {
  "power-saver": "battery",
  balanced: "power",
  performance: "benchmark",
} as const;

/** "Never", "Immediately", "After 5 minutes". */
export function timeoutLabel(seconds: number | null, zero = "Immediately"): string {
  if (seconds == null) return "Never";
  if (seconds === 0) return zero;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `After ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return `After ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

const choices = (values: readonly (number | null)[], zero?: string) =>
  values.map((value) => ({ id: String(value), label: timeoutLabel(value, zero) }));
const parse = (id: string) => (id === "null" ? null : Number(id));

function attempt(
  context: PageContext,
  change: (client: NonNullable<PageContext["power"]["client"]>) => Promise<unknown>,
) {
  const client = context.power.client;
  if (!client) return;
  context.attempt(PAGE, () => change(client).then(() => null));
}

/** One timeout per power source: two rows when there's a battery, one when always plugged in. */
function timeoutRows(
  context: PageContext,
  id: "power.screen-off" | "power.suspend",
  settings: PowerSettings,
  hasBattery: boolean,
): SettingRowSpec[] {
  const viewport = { width: context.width, height: context.height };
  const field =
    id === "power.screen-off" ? settings.screenOffAfterSeconds : settings.suspendAfterSeconds;
  const values =
    id === "power.screen-off"
      ? POWER_CHOICES.screenOffAfterSeconds
      : POWER_CHOICES.suspendAfterSeconds;
  const set = (source: Source, seconds: number | null) =>
    attempt(context, (client) =>
      id === "power.screen-off"
        ? client.setScreenOffAfter(source, seconds)
        : client.setSuspendAfter(source, seconds),
    );
  const sources: Source[] = hasBattery ? ["battery", "ac"] : ["ac"];
  return sources.map((source, index) => ({
    ...selectRow(
      id,
      viewport,
      String(field[source]),
      choices(values),
      (value) => set(source, parse(value)),
      {
        description: hasBattery
          ? source === "battery"
            ? "When inactive on battery"
            : "When inactive and plugged in"
          : "When inactive",
        width: 170,
      },
    ),
    id: index === 0 ? id : `${id}:${source}`,
  }));
}

/** An app that asked to keep the computer awake, with the switch that lets it. */
function awakeRow(context: PageContext, app: AwakeApp): SettingRowSpec {
  const focusId = `power:awake:${app.key}`;
  const grant = app.grant;
  return {
    id: `power.awake:${app.key}`,
    label: app.name,
    description: app.detail,
    descriptionTone: app.holding && app.allowed ? "accent" : "muted",
    focusId,
    control: {
      kind: "compact",
      width: 52,
      render: () => (
        <Toggle
          on={app.allowed}
          disabled={!grant}
          focusId={focusId}
          onChange={(on) => {
            if (grant) attempt(context, (client) => client.setSleepBlockerAllowed(grant, on));
          }}
        />
      ),
    },
  };
}

export function powerPage(context: PageContext): PageContent {
  const ui = getUiScaleFactor();
  const battery = context.desktop.snapshot?.battery;
  const ready = battery?.kind === "ready" && batterySupported(battery) ? battery : null;
  const power = context.power.state;
  const settings = power?.settings ?? null;
  const idle = power?.idle.kind === "ready" ? power.idle.status : null;
  const profiles =
    power?.profiles.kind === "ready" && power.profiles.status.kind === "ready"
      ? power.profiles.status
      : null;
  const viewport = { width: context.width, height: context.height };
  const capabilities = idle?.capabilities;
  const awake = settings
    ? awakeApps(settings.sleepBlockers, idle?.sleepBlocking.requests ?? [])
    : [];
  const sections = settings
    ? [
        profiles
          ? section("power.mode", "Power mode", [
              {
                id: "power.profile",
                label: "Power mode",
                description: profiles.degraded
                  ? `Limited: ${profiles.degraded.replaceAll("-", " ")}`
                  : undefined,
                control: {
                  kind: "block",
                  height: 84,
                  render: (width) => (
                    <PictureOptions
                      width={width}
                      height={84 * ui}
                      focusId="setting:power.profile"
                      value={profiles.active}
                      options={profiles.profiles.map((profile) => ({
                        id: profile,
                        label: PROFILE_LABELS[profile],
                        picture: (size) => (
                          <IconTile
                            x={(size.width - 36 * ui) / 2}
                            y={(size.height - 36 * ui) / 2}
                            size={36}
                            icon={PROFILE_ICONS[profile]}
                            tint={profile === profiles.active ? context.palette.accent : 0xff8a94a6}
                          />
                        ),
                      }))}
                      onChange={(id) =>
                        context.attempt(PAGE, async () => {
                          const result = await context.power.client!.setPowerProfile(id as Profile);
                          return result.ok ? null : result.message;
                        })
                      }
                    />
                  ),
                },
              },
            ])
          : section("power.mode", undefined, []),
        section(
          "power.screen",
          "Screen and sleep",
          [
            selectRow(
              "power.dim",
              viewport,
              String(settings.dimAfterSeconds),
              choices(POWER_CHOICES.dimAfterSeconds).map((choice) =>
                choice.id === "null" ? { ...choice, label: "Don't dim" } : choice,
              ),
              (value) => attempt(context, (client) => client.setDimAfter(parse(value))),
              { width: 170 },
            ),
            ...timeoutRows(context, "power.screen-off", settings, !!ready),
            ...(capabilities?.suspend !== false
              ? timeoutRows(context, "power.suspend", settings, !!ready)
              : []),
            capabilities?.lock
              ? selectRow(
                  "power.lock-after",
                  viewport,
                  String(settings.lockAfterScreenOffSeconds),
                  choices(POWER_CHOICES.lockAfterScreenOffSeconds, "When the screen turns off"),
                  (value) =>
                    attempt(context, (client) => client.setLockAfterScreenOff(parse(value))),
                  { width: 170 },
                )
              : null,
            capabilities?.lock
              ? toggleRow("power.lock-on-suspend", settings.lockOnSuspend, (on) =>
                  attempt(context, (client) => client.setLockOnSuspend(on)),
                )
              : null,
          ],
          {
            footnote: idle?.inhibitors.display.length
              ? `${idle.inhibitors.display.join(", ")} ${idle.inhibitors.display.length === 1 ? "keeps" : "keep"} the screen on right now`
              : undefined,
          },
        ),
        section("power.buttons", "Lid and power button", [
          capabilities?.lidPresent
            ? selectRow(
                "power.lid",
                viewport,
                settings.lidCloseAction,
                [
                  { id: "suspend", label: "Suspend" },
                  ...(capabilities.powerOff ? [{ id: "power-off", label: "Shut down" }] : []),
                  { id: "nothing", label: "Do nothing" },
                ],
                (value) =>
                  attempt(context, (client) =>
                    client.setLidCloseAction(value as PowerSettings["lidCloseAction"]),
                  ),
                {
                  description: capabilities.lidAction
                    ? "When you close the lid"
                    : "Handled by the system",
                  disabled: !capabilities.lidAction,
                  width: 170,
                },
              )
            : null,
          selectRow(
            "power.power-button",
            viewport,
            // "ask" (an earlier default) has no power menu to open yet, so it does nothing.
            settings.powerButtonAction === "ask" ? "nothing" : settings.powerButtonAction,
            [
              { id: "suspend", label: "Suspend" },
              ...(capabilities?.powerOff !== false
                ? [{ id: "power-off", label: "Shut down" }]
                : []),
              { id: "nothing", label: "Do nothing" },
            ],
            (value) =>
              attempt(context, (client) =>
                client.setPowerButtonAction(value as PowerSettings["powerButtonAction"]),
              ),
            { width: 170 },
          ),
          ready
            ? toggleRow("power.battery-percentage", settings.showBatteryPercentage, (on) =>
                attempt(context, (client) => client.setShowBatteryPercentage(on)),
              )
            : null,
        ]),
        section(
          "power.awake",
          "Apps that can keep this computer awake",
          awake.length > 0
            ? awake.map((app) => awakeRow(context, app))
            : [
                {
                  id: "power.awake:none",
                  label: "No app has asked",
                  description: "An app that asks to keep this computer awake appears here",
                  labelTone: "muted" as const,
                },
              ],
          { footnote: awakeFootnote(awake) },
        ),
      ]
    : [];
  const banners = [
    ...(idle?.lastError
      ? [
          {
            id: "idle-error",
            title: "Something didn't work",
            message: idle.lastError,
            tone: "warning" as const,
          },
        ]
      : []),
    ...(power && power.idle.kind !== "ready" && power.idle.kind !== "loading"
      ? [
          {
            id: "idle",
            title: "The screen and sleep timers aren't running",
            message: power.idle.message,
            tone: "warning" as const,
          },
        ]
      : []),
  ];
  return {
    summary: ready ? `${batteryPercent(ready)} · ${chargeLabel(ready)}` : "Plugged in",
    hero: ready
      ? {
          kind: "status",
          icon: "battery",
          title: `${batteryPercent(ready)} · ${chargeLabel(ready)}`,
          detail: batteryDetail(ready),
        }
      : undefined,
    anchors: ready ? ["power.battery"] : undefined,
    banners,
    sections,
    empty: settings
      ? undefined
      : {
          icon: "battery",
          title: ready ? "Power settings aren't available" : "No battery",
          message:
            "Settings couldn't reach the power service, so idle and power settings can't be changed.",
        },
  };
}
