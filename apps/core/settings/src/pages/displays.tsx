/**
 * Displays: the arrangement as the hero, then the selected display's brightness, resolution,
 * refresh rate, scale and whether it is primary, then Night light. A new mode or layout is a trial the compositor reverts
 * unless kept; the banner at the top counts it down.
 */
import React from "react";
import {
  Button,
  DisplayArrangement,
  Horizontal,
  PageHero,
  getUiScaleFactor,
  type DisplayArrangementItem,
  type SettingRowSpec,
} from "@moire/ui";
import { settingEntry } from "#settings/catalog";
import type { PageContext } from "#settings/context";
import { refreshLabel, resolutionForMode } from "#settings/display-service";
import type { Banner, PageContent } from "#settings/model";
import { section, segmentedRow, selectRow } from "#settings-view/rows";
import { displaySummary, type DisplaySettings } from "./displays-state";
import { brightnessNote, brightnessRow, nightLightSection } from "./night-light";

const SCALES = [120, 150, 180, 210, 240];
const ARRANGEMENT = 132;
const FAILURE = /failed|could not|unavailable|didn't|rejected|disconnected|lost/i;

function trialBanner(state: DisplaySettings): Banner | null {
  const pending = state.pendingMode ? "mode" : state.pendingLayout ? "arrangement" : null;
  if (!pending) return null;
  const ui = getUiScaleFactor();
  const keep = pending === "mode" ? state.confirmMode : state.confirmLayout;
  const revert = pending === "mode" ? state.revertMode : state.revertLayout;
  return {
    id: "trial",
    title: pending === "mode" ? "Keep this display mode?" : "Keep this arrangement?",
    message: `Reverting in ${state.countdown}s`,
    tone: "accent",
    icon: "monitor",
    actionWidth: 184,
    action: (
      <Horizontal width={184 * ui} height={32 * ui} gap={8 * ui} align="center">
        <Button
          width={88 * ui}
          height={30 * ui}
          label="Revert"
          disabled={state.busy}
          onPress={revert}
        />
        <Button
          width={88 * ui}
          height={30 * ui}
          label="Keep"
          variant="primary"
          disabled={state.busy}
          onPress={keep}
        />
      </Horizontal>
    ),
  };
}

function arrangementItems(state: DisplaySettings): DisplayArrangementItem[] {
  return state.outputs.map((output) => ({
    id: output.id,
    label: output.model || output.name,
    x: output.x,
    y: output.y,
    width: output.width,
    height: output.height,
    primary: output.primary,
  }));
}

export function displaysPage(context: PageContext): PageContent {
  const state = context.display;
  const ui = getUiScaleFactor();
  if (!state.available)
    return {
      summary: "Resolution, scale and arrangement",
      sections: [],
      empty: {
        icon: "monitor",
        title: "Display settings aren't available",
        message:
          "The compositor's display service isn't running, so displays can't be changed here.",
      },
    };
  const selected =
    state.outputs.find((output) => output.id === state.selectedOutputId) ?? state.outputs[0];
  const current = resolutionForMode(state.mode);
  const resolutions = [...new Set(state.parsedModes.map((entry) => entry.resolution))].sort(
    (a, b) => {
      if (a === current) return -1;
      if (b === current) return 1;
      const am = state.parsedModes.find((entry) => entry.resolution === a)!;
      const bm = state.parsedModes.find((entry) => entry.resolution === b)!;
      return bm.width * bm.height - am.width * am.height;
    },
  );
  const refreshModes = state.parsedModes.filter(
    (entry) => entry.resolution === state.selectedResolution,
  );
  const viewport = { width: context.width, height: context.height };
  const banners: Banner[] = [];
  const trial = trialBanner(state);
  if (trial) banners.push(trial);
  if (state.status && FAILURE.test(state.status))
    banners.push({
      id: "status",
      title: "The display didn't change",
      message: state.status,
      tone: "danger",
    });
  const rows: (SettingRowSpec | null)[] = [
    brightnessRow(context),
    selectRow(
      "displays.resolution",
      viewport,
      state.selectedResolution,
      resolutions.map((resolution) => ({
        id: resolution,
        label: `${resolution.replace("x", " × ")}${resolution === current ? " · Current" : resolution === resolutionForMode(state.preferred) ? " · Preferred" : ""}`,
      })),
      state.requestResolution,
      {
        description: selected
          ? [selected.name, refreshModes.find((entry) => entry.id === state.mode)?.refreshMilliHz]
              .map((part) => (typeof part === "number" ? refreshLabel(part) : part))
              .filter(Boolean)
              .join(" · ")
          : undefined,
        disabled: state.locked,
      },
    ),
    selectRow(
      "displays.refresh",
      viewport,
      refreshModes.some((entry) => entry.id === state.mode)
        ? state.mode
        : (refreshModes[0]?.id ?? null),
      refreshModes.map((entry) => ({ id: entry.id, label: refreshLabel(entry.refreshMilliHz) })),
      state.requestMode,
      { disabled: state.locked || refreshModes.length <= 1 },
    ),
    selected
      ? segmentedRow(
          "displays.scale",
          String(selected.scale120),
          SCALES.map((scale120) => ({
            id: String(scale120),
            label: `${Math.round((scale120 / 120) * 100)}%`,
            disabled: state.locked,
          })),
          (value) =>
            state.requestLayout(
              state.outputs.map((output) =>
                output.id === selected.id ? { ...output, scale120: Number(value) } : output,
              ),
            ),
          { width: 300 },
        )
      : null,
    state.outputs.length > 1 && selected
      ? {
          id: "displays.primary",
          label: settingEntry("displays.primary").label,
          description: selected.primary
            ? "The panel and new windows open here"
            : settingEntry("displays.primary").description,
          control: {
            kind: "compact",
            width: 132,
            render: () => (
              <Button
                width={132 * ui}
                height={30 * ui}
                label={selected.primary ? "Primary" : "Make primary"}
                disabled={state.locked || selected.primary}
                focusId="setting:displays.primary"
                onPress={() =>
                  state.requestLayout(
                    state.outputs.map((output) => ({
                      ...output,
                      primary: output.id === selected.id,
                    })),
                  )
                }
              />
            ),
          },
        }
      : null,
  ];
  return {
    summary: displaySummary(state),
    anchors: state.outputs.length ? ["displays.arrangement"] : undefined,
    banners,
    hero: state.outputs.length
      ? {
          kind: "custom",
          height: ARRANGEMENT + 28,
          render: (width) => (
            <PageHero width={width} height={(ARRANGEMENT + 28) * ui} tint={0xff8b7cf6}>
              <Horizontal y={14 * ui} width={width} height={ARRANGEMENT * ui} justify="center">
                <DisplayArrangement
                  width={Math.min(420 * ui, width - 28 * ui)}
                  height={ARRANGEMENT * ui}
                  items={arrangementItems(state)}
                  selectedId={state.selectedOutputId}
                  onSelect={state.setSelectedOutputId}
                  onChange={
                    state.locked
                      ? undefined
                      : (items) => {
                          const positions = new Map(items.map((item) => [item.id, item]));
                          state.requestLayout(
                            state.outputs.map((output) => {
                              const item = positions.get(output.id);
                              return item ? { ...output, x: item.x, y: item.y } : output;
                            }),
                          );
                        }
                  }
                />
              </Horizontal>
            </PageHero>
          ),
        }
      : undefined,
    sections: [
      section("displays.selected", selected ? selected.model || selected.name : "Display", rows, {
        footnote: [
          brightnessNote(context),
          "A new mode or arrangement reverts by itself unless you keep it.",
        ]
          .filter(Boolean)
          .join(" "),
      }),
      nightLightSection(context),
    ],
  };
}
