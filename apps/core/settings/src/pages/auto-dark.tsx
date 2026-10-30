/**
 * Automatic dark style on Appearance: the scheme's Auto choice and the section that says when.
 * Choosing Auto applies the scheduled scheme at once; after that the management service flips
 * `dark` at each boundary, and every surface follows the active theme as it always does.
 */
import type { AutoDarkSettings, MoireSettings } from "@moire/prefs";
import type { SettingsSectionSpec } from "@moire/ui";
import type { PageContext } from "#settings/context";
import { clockLabel, scheduleTimes, withTime } from "#settings/time-choices";
import { section, selectRow, timeRow } from "#settings-view/rows";
import {
  AUTO_DARK_SCHEDULES,
  approximateNote,
  autoDarkNow,
  autoDarkSummary,
} from "./daylight-model";

const PAGE = "appearance";
export type SchemeChoice = "Light" | "Dark" | "Auto";
export const SCHEME_CHOICES = [
  { id: "Light", label: "Light" },
  { id: "Dark", label: "Dark" },
  { id: "Auto", label: "Auto" },
] as const;

export function schemeChoice(values: Pick<MoireSettings, "dark" | "autoDark">): SchemeChoice {
  if (values.autoDark.mode !== "off") return "Auto";
  return values.dark ? "Dark" : "Light";
}

/** Apply an automatic schedule (or turn it off), with the scheme it calls for now. */
function setAuto(context: PageContext, auto: AutoDarkSettings, label: string) {
  const { values } = context.prefs;
  const state = autoDarkNow(auto, values.nightLight, context.daylight);
  context.prefs.set(
    { autoDark: auto, ...(state && state.active !== values.dark ? { dark: state.active } : {}) },
    { label, page: PAGE },
  );
}

export function chooseScheme(context: PageContext, choice: string) {
  const { values } = context.prefs;
  if (choice === "Auto") {
    // Back to the schedule chosen before, or sunset to sunrise the first time.
    const mode = values.autoDark.mode === "off" ? "sunset" : values.autoDark.mode;
    setAuto(context, { ...values.autoDark, mode }, "Color scheme set to Auto");
    return;
  }
  context.prefs.set(
    { dark: choice === "Dark", autoDark: { ...values.autoDark, mode: "off" } },
    { label: `Color scheme set to ${choice}`, page: PAGE },
  );
}

/** "Dark · until 05:43" while Auto; the plain scheme otherwise. */
export function schemeSummary(context: PageContext): string {
  const { values } = context.prefs;
  const state = autoDarkNow(values.autoDark, values.nightLight, context.daylight);
  return state ? `Auto · ${autoDarkSummary(state, values.region)}` : schemeChoice(values);
}

export function autoDarkSection(context: PageContext): SettingsSectionSpec {
  const { values } = context.prefs;
  const auto = values.autoDark;
  const region = values.region;
  const viewport = { width: context.width, height: context.height };
  const state = autoDarkNow(auto, values.nightLight, context.daylight);
  const times = scheduleTimes(region);
  const choices = [{ id: "off", label: "Off" }, ...AUTO_DARK_SCHEDULES];
  return section(
    "appearance.auto",
    "Schedule",
    [
      selectRow(
        "appearance.auto-schedule",
        viewport,
        auto.mode,
        choices,
        (id) =>
          setAuto(
            context,
            { ...auto, mode: id as AutoDarkSettings["mode"] },
            id === "off"
              ? "Automatic dark style turned off"
              : `Dark style follows ${choices.find((choice) => choice.id === id)!.label.toLowerCase()}`,
          ),
        {
          description: state ? autoDarkSummary(state, region) : "Light or Dark stays as you chose",
          width: 200,
        },
      ),
      auto.mode === "custom" &&
        timeRow(
          viewport,
          "appearance.auto-from",
          "Dark from",
          auto.from,
          withTime(times, auto.from, region),
          (from) =>
            setAuto(context, { ...auto, from }, `Dark style starts at ${clockLabel(from, region)}`),
        ),
      auto.mode === "custom" &&
        timeRow(
          viewport,
          "appearance.auto-to",
          "Light from",
          auto.to,
          withTime(times, auto.to, region),
          (to) =>
            setAuto(context, { ...auto, to }, `Light style returns at ${clockLabel(to, region)}`),
          auto.to < auto.from ? "The next morning" : undefined,
        ),
    ],
    {
      footnote: state?.approximate
        ? approximateNote(auto.from, auto.to, region)
        : "Moire switches at the boundary, within a minute.",
    },
  );
}
