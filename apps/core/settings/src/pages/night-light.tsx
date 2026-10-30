/**
 * Displays' brightness row and Night light section. Brightness goes through the management
 * service (logind); without a backlight the section says so instead of showing a slider. Night
 * light is a pref the compositor applies at composition, with its schedule and warmth.
 */
import { MIN_BRIGHTNESS, type BrightnessStatus } from "@moire/system-management/brightness";
import type { NightLightSettings } from "@moire/prefs";
import type { SettingRowSpec, SettingsSectionSpec } from "@moire/ui";
import type { PageContext } from "#settings/context";
import { scheduleTimes, withTime, clockLabel } from "#settings/time-choices";
import { section, selectRow, sliderRow, timeRow, toggleRow } from "#settings-view/rows";
import {
  NIGHT_LIGHT_SCHEDULES,
  approximateNote,
  nightLightNow,
  nightLightSummary,
} from "./daylight-model";

const PAGE = "displays";

/** The backlight's status, or null while the service isn't there. */
export function brightnessStatus(context: PageContext): BrightnessStatus | null {
  const state = context.brightness.state;
  return state?.kind === "ready" ? state.status : null;
}

/** The brightness slider, when this computer has a backlight. */
export function brightnessRow(context: PageContext): SettingRowSpec | null {
  const status = brightnessStatus(context);
  const client = context.brightness.client;
  if (status?.kind !== "ready" || !client) return null;
  return sliderRow(
    "displays.brightness",
    Math.max(MIN_BRIGHTNESS, status.level),
    {
      onCommit: (level) =>
        context.attempt(PAGE, async () => {
          const result = await context.calls.run("brightness", () => client.setLevel(level));
          return result.ok ? null : result.message;
        }),
    },
    {
      description: `${Math.round(status.level * 100)}% · ${status.device}`,
      disabled: context.calls.busy === "brightness",
    },
  );
}

/** Why there is no brightness slider, for the display section's footnote. */
export function brightnessNote(context: PageContext): string | null {
  const status = brightnessStatus(context);
  return status && status.kind !== "ready" ? status.message : null;
}

function setNightLight(context: PageContext, patch: Partial<NightLightSettings>, label: string) {
  context.prefs.set(
    { nightLight: { ...context.prefs.values.nightLight, ...patch } },
    { label, page: PAGE },
  );
}

export function nightLightSection(context: PageContext): SettingsSectionSpec {
  const settings = context.prefs.values.nightLight;
  const region = context.prefs.values.region;
  const state = nightLightNow(settings, context.daylight);
  const viewport = { width: context.width, height: context.height };
  const times = scheduleTimes(region);
  const custom = settings.schedule === "custom";
  return section(
    "displays.night",
    "Night light",
    [
      toggleRow(
        "displays.night-light",
        settings.enabled,
        (on) => setNightLight(context, { enabled: on }, `Night light turned ${on ? "on" : "off"}`),
        { description: nightLightSummary(settings, state, region) },
      ),
      selectRow(
        "displays.night-schedule",
        viewport,
        settings.schedule,
        NIGHT_LIGHT_SCHEDULES,
        (id) =>
          setNightLight(
            context,
            { schedule: id as NightLightSettings["schedule"] },
            `Night light schedule set to ${NIGHT_LIGHT_SCHEDULES.find((choice) => choice.id === id)?.label ?? id}`,
          ),
        { width: 200 },
      ),
      custom &&
        timeRow(
          viewport,
          "displays.night-from",
          "Turn on at",
          settings.from,
          withTime(times, settings.from, region),
          (from) =>
            setNightLight(context, { from }, `Night light starts at ${clockLabel(from, region)}`),
        ),
      custom &&
        timeRow(
          viewport,
          "displays.night-to",
          "Turn off at",
          settings.to,
          withTime(times, settings.to, region),
          (to) => setNightLight(context, { to }, `Night light ends at ${clockLabel(to, region)}`),
          settings.to < settings.from ? "The next morning" : undefined,
        ),
      sliderRow(
        "displays.night-strength",
        settings.strength,
        {
          onCommit: (strength) =>
            setNightLight(
              context,
              { strength },
              `Night light warmth set to ${Math.round(strength * 100)}%`,
            ),
        },
        { description: `${Math.round(settings.strength * 100)}%` },
      ),
    ],
    {
      footnote: state.approximate
        ? approximateNote(settings.from, settings.to, region)
        : "Screenshots keep their true colours.",
    },
  );
}
