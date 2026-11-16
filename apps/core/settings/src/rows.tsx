/**
 * Row builders the pages share: a switch, a choice, segments, a slider, a button or a link,
 * labelled from the catalog so the row reads the same on its page and in search results.
 */
import React, { useEffect, useState } from "react";
import {
  Button,
  SegmentedControl,
  Select,
  Slider,
  Toggle,
  getUiScaleFactor,
  type SettingRowSpec,
  type SettingsSectionSpec,
} from "@moire/ui";
import { SETTINGS, settingEntry } from "./catalog";

type RowText = { label?: string; description?: string };

/**
 * The catalog's label and description for a setting, overridable with live text. A row that
 * brings its own label needn't be in the catalog: a sheet's rows aren't, since search finds the
 * page's row that opens the sheet.
 */
function text(id: string, override: RowText = {}) {
  const entry =
    override.label === undefined
      ? settingEntry(id)
      : SETTINGS.find((candidate) => candidate.id === id);
  return {
    id,
    label: override.label ?? entry?.label ?? id,
    description: override.description ?? entry?.description,
    focusId: `setting:${id}`,
  };
}

export function toggleRow(
  id: string,
  on: boolean,
  onChange: (on: boolean) => void,
  options: RowText & { disabled?: boolean } = {},
): SettingRowSpec {
  return {
    ...text(id, options),
    control: {
      kind: "compact",
      width: 52,
      render: () => (
        <Toggle on={on} disabled={options.disabled} focusId={`setting:${id}`} onChange={onChange} />
      ),
    },
  };
}

export type Choice = { id: string; label: string };

export function selectRow(
  id: string,
  viewport: { width: number; height: number },
  value: string | null,
  choices: readonly Choice[],
  onChange: (id: string) => void,
  options: RowText & { disabled?: boolean; width?: number; placeholder?: string } = {},
): SettingRowSpec {
  const ui = getUiScaleFactor();
  return {
    ...text(id, options),
    control: {
      kind: "wide",
      width: options.width,
      render: (width) => (
        <Select
          width={width}
          height={32 * ui}
          viewportWidth={viewport.width}
          viewportHeight={viewport.height}
          maxMenuHeight={Math.min(360 * ui, viewport.height - 80 * ui)}
          value={value}
          options={choices}
          placeholder={options.placeholder}
          disabled={options.disabled}
          focusId={`setting:${id}`}
          onChange={onChange}
        />
      ),
    },
  };
}

export function segmentedRow(
  id: string,
  value: string,
  choices: readonly (Choice & { disabled?: boolean })[],
  onChange: (id: string) => void,
  options: RowText & { width?: number } = {},
): SettingRowSpec {
  const ui = getUiScaleFactor();
  return {
    ...text(id, options),
    control: {
      kind: "wide",
      width: options.width,
      render: (width) => (
        <SegmentedControl
          width={width}
          height={32 * ui}
          value={value}
          options={choices}
          onChange={onChange}
        />
      ),
    },
  };
}

/** A slider that moves with the drag and saves once, when it is let go. */
function DraftSlider(props: {
  id: string;
  width: number;
  value: number;
  disabled?: boolean;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const ui = getUiScaleFactor();
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [props.value]);
  return (
    <Slider
      width={props.width}
      height={24 * ui}
      value={draft ?? props.value}
      step={props.step}
      disabled={props.disabled}
      focusId={`setting:${props.id}`}
      onChange={setDraft}
      onCommit={props.onCommit}
    />
  );
}

/**
 * A slider row. With `onChange` it follows every step (the interface size, which previews
 * live); with `onCommit` alone it saves when the drag ends.
 */
export function sliderRow(
  id: string,
  value: number,
  change: { onChange: (value: number) => void } | { onCommit: (value: number) => void },
  options: RowText & { disabled?: boolean; step?: number } = {},
): SettingRowSpec {
  const ui = getUiScaleFactor();
  return {
    ...text(id, options),
    control: {
      kind: "wide",
      height: 24,
      render: (width) =>
        "onChange" in change ? (
          <Slider
            width={width}
            height={24 * ui}
            value={value}
            step={options.step}
            disabled={options.disabled}
            focusId={`setting:${id}`}
            onChange={change.onChange}
          />
        ) : (
          <DraftSlider
            id={id}
            width={width}
            value={value}
            step={options.step}
            disabled={options.disabled}
            onCommit={change.onCommit}
          />
        ),
    },
  };
}

export function buttonRow(
  id: string,
  label: string,
  onPress: () => void,
  options: RowText & {
    disabled?: boolean;
    variant?: "secondary" | "ghost" | "primary" | "danger";
    width?: number;
  } = {},
): SettingRowSpec {
  const ui = getUiScaleFactor();
  const width = options.width ?? 104;
  return {
    ...text(id, options),
    control: {
      kind: "compact",
      width,
      render: () => (
        <Button
          width={width * ui}
          height={30 * ui}
          label={label}
          variant={options.variant ?? "secondary"}
          disabled={options.disabled}
          focusId={`setting:${id}`}
          onPress={onPress}
        />
      ),
    },
  };
}

/**
 * A clock-time choice under the schedule switch it belongs to. It has no catalog entry of its
 * own: search finds the schedule, and these rows exist only while it is on.
 */
export function timeRow(
  viewport: { width: number; height: number },
  id: string,
  label: string,
  value: string,
  choices: readonly Choice[],
  onChange: (time: string) => void,
  description?: string,
): SettingRowSpec {
  const ui = getUiScaleFactor();
  return {
    id,
    label,
    description,
    focusId: `setting:${id}`,
    control: {
      kind: "wide",
      width: 140,
      render: (width) => (
        <Select
          width={width}
          height={32 * ui}
          viewportWidth={viewport.width}
          viewportHeight={viewport.height}
          maxMenuHeight={Math.min(360 * ui, viewport.height - 80 * ui)}
          value={value}
          options={choices}
          onChange={onChange}
        />
      ),
    },
  };
}

/** A row that opens somewhere else: another page, a sheet, an app. */
export function linkRow(
  id: string,
  onPress: () => void,
  options: RowText & { value?: string } = {},
) {
  return {
    ...text(id, options),
    value: options.value,
    chevron: true,
    onPress,
  } satisfies SettingRowSpec;
}

/** A label with a value and nothing to change; a row without a description sits tighter. */
export function infoRow(
  id: string,
  label: string,
  value: string,
  description?: string,
): SettingRowSpec {
  return { id, label, value, description, height: description ? undefined : 40 };
}

/** A section with only the rows that exist; sections left empty are dropped by the page. */
export function section(
  id: string,
  title: string | undefined,
  rows: readonly (SettingRowSpec | null | false | undefined)[],
  extra: Partial<SettingsSectionSpec> = {},
): SettingsSectionSpec {
  return { id, title, rows: rows.filter((row): row is SettingRowSpec => !!row), ...extra };
}
