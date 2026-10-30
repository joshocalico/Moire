/** Accessibility: interface size and reduced motion, switches over prefs. */
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { section, sliderRow, toggleRow } from "#settings-view/rows";
import { scaleFromSlider, sliderFromScale } from "./appearance-model";

export function accessibilityPage(context: PageContext): PageContent {
  const { values } = context.prefs;
  return {
    summary: `Interface size ${Math.round(values.uiScale * 100)}%${values.reducedMotion ? " · reduced motion" : ""}`,
    sections: [
      section("accessibility.seeing", "Seeing", [
        sliderRow(
          "accessibility.size",
          sliderFromScale(values.uiScale),
          {
            onChange: (value) =>
              context.prefs.setScaleLive(scaleFromSlider(value), "accessibility"),
          },
          { description: `${Math.round(values.uiScale * 100)}% · text and controls in Moire apps` },
        ),
        toggleRow(
          "accessibility.motion",
          values.reducedMotion,
          (on) => context.prefs.setReducedMotion(on, "accessibility"),
          { disabled: context.prefs.motionSaving },
        ),
      ]),
    ],
  };
}
