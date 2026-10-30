/**
 * Settings sections: a muted heading, then a card of rows separated by hairlines. A row puts
 * its label (and a description) on the left and its control on the right; wide controls move
 * under the label in narrow cards. Rows can lead with an icon tile or custom content, end with
 * a value and a chevron, open something when pressed, reveal a control only while hovered or
 * focused, and flash when a deep link lands on them.
 */
import React, { useState, type ReactNode } from "react";
import { Group, Rect, measureTextBounds } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { Icon, type IconName } from "./icon";
import { IconTile } from "./icon-tile";
import { Horizontal } from "./layout";
import { Pressable } from "./pressable";
import { Separator, Surface, TextBlock, measureWrappedText } from "./primitives";

/** Handlers a revealed control passes to its button, so the pointer on it keeps it shown. */
export type SettingRevealHandlers = {
  onHoverChange: (hovered: boolean) => void;
  onFocusChange: (focused: boolean) => void;
};

export type SettingControl = {
  /**
   * `compact` controls (switches, buttons) keep their size at the right edge. `wide` controls
   * (selects, sliders, segments) take a column and move under the label in narrow cards.
   * `block` content spans the card without a label.
   */
  kind: "compact" | "wide" | "block";
  /** Width a compact control reserves, or the least a wide control needs (unscaled). */
  width?: number;
  /** The control's height (unscaled); a block's whole height. 36 by default. */
  height?: number;
  render: (width: number, reveal: SettingRevealHandlers) => ReactNode;
};

export type SettingRowSpec = {
  id: string;
  label: string;
  description?: string;
  /** Accent the label (the connected network) or mute it (a pending item). */
  labelTone?: "default" | "accent" | "muted";
  descriptionTone?: "muted" | "accent" | "danger";
  /** A tinted icon tile before the label. */
  icon?: IconName;
  tint?: number;
  /** Custom 32px leading content (an avatar, signal bars) instead of an icon tile. */
  leading?: ReactNode;
  /** Muted text at the end of the row, before the control and chevron. */
  value?: string;
  chevron?: boolean;
  /** The whole row is pressable: drill into details, open a page. */
  onPress?: () => void;
  control?: SettingControl;
  /** Shown instead of `control` only while the row is hovered or holds focus (Connect). */
  revealControl?: SettingControl;
  /** Least row height (unscaled); 46, or 56 with a description. */
  height?: number;
  focusId?: string;
};

export type SettingsSectionSpec = {
  id: string;
  title?: string;
  /** Leading icon beside the title (search results group by page). */
  titleIcon?: IconName;
  titleTint?: number;
  /** End of the heading line: a status badge or a link, with the width it needs (unscaled). */
  trailing?: ReactNode;
  trailingWidth?: number;
  rows: readonly SettingRowSpec[];
  /** A muted note under the card. */
  footnote?: string;
};

const PAD = 16;
const LEAD = 32;
const LEAD_GAP = 12;
const HEADING = 28;
const FOOTNOTE = 26;
const CONTROL_H = 36;
const CHEVRON = 14;
/** Cards narrower than this stack wide controls under their labels. */
const STACK_BELOW = 400;

type Metrics = { ui: number; pad: number; inner: number; stacked: boolean; wide: number };

function metrics(cardWidth: number): Metrics {
  const ui = getUiScaleFactor();
  const pad = PAD * ui;
  const inner = Math.max(1, cardWidth - pad * 2);
  const stacked = cardWidth < STACK_BELOW * ui;
  const wide = stacked ? inner : Math.round(Math.max(150 * ui, Math.min(260 * ui, inner * 0.42)));
  return { ui, pad, inner, stacked, wide };
}

function leadWidth(row: SettingRowSpec, m: Metrics): number {
  return row.icon || row.leading ? (LEAD + LEAD_GAP) * m.ui : 0;
}

/** The width a row gives its control, or null when the control moves under the label. */
function controlWidth(control: SettingControl | undefined, row: SettingRowSpec, m: Metrics) {
  if (!control) return 0;
  const room = m.inner - leadWidth(row, m);
  if (control.kind === "compact") return Math.min(room, (control.width ?? 56) * m.ui);
  if (control.kind === "block" || m.stacked) return null;
  const width = Math.min(room, Math.max(m.wide, (control.width ?? 0) * m.ui));
  return room - width - 12 * m.ui < 120 * m.ui ? null : width;
}

function valueWidth(row: SettingRowSpec, m: Metrics): number {
  if (!row.value) return 0;
  const natural = Math.ceil(measureTextBounds(row.value, { fontSize: 13 }).width) + 2;
  return Math.min(natural, Math.round(m.inner * 0.4));
}

function trailingWidth(row: SettingRowSpec, m: Metrics, control: number): number {
  const chevron = row.chevron ? (CHEVRON + 8) * m.ui : 0;
  const value = valueWidth(row, m);
  const parts = [control, value, chevron].filter((width) => width > 0);
  return parts.reduce((sum, width) => sum + width, 0) + Math.max(0, parts.length - 1) * 8 * m.ui;
}

function labelHeight(row: SettingRowSpec, m: Metrics): number {
  return (row.description ? 36 : 18) * m.ui;
}

function rowHeight(row: SettingRowSpec, m: Metrics): number {
  const control = row.control ?? row.revealControl;
  const controlH = control ? (control.height ?? CONTROL_H) * m.ui : 0;
  if (control?.kind === "block") return controlH + m.pad * 2;
  const least = (row.height ?? (row.description ? 56 : 46)) * m.ui;
  if (control && controlWidth(control, row, m) == null)
    return Math.max(least, 12 * m.ui + labelHeight(row, m) + 8 * m.ui + controlH + 14 * m.ui);
  return Math.max(least, controlH + 16 * m.ui);
}

/** Footnotes wrap (up to four lines) rather than clip; one line keeps the old fixed height. */
const FOOTNOTE_LINES = 4;
function footnoteHeight(text: string, width: number, m: Metrics): number {
  const wrapped = measureWrappedText(text, footnoteWidth(width, m), { fontSize: FOOTNOTE_FONT });
  const lines = Math.min(FOOTNOTE_LINES, wrapped.lines.length);
  return Math.max(FOOTNOTE * m.ui, lines * wrapped.lineHeight + 10 * m.ui);
}
function footnoteWidth(width: number, m: Metrics): number {
  return Math.max(1, width - 8 * m.ui);
}
const FOOTNOTE_FONT = 11;

/** The height of a section, heading and footnote included, at this card width. */
export function settingsSectionHeight(section: SettingsSectionSpec, width: number): number {
  const m = metrics(width);
  return (
    (section.title || section.trailing ? HEADING * m.ui : 0) +
    section.rows.reduce((sum, row) => sum + rowHeight(row, m), 0) +
    (section.footnote ? footnoteHeight(section.footnote, width, m) : 0)
  );
}

/** Where each row sits inside the section, for scrolling a deep-linked row into view. */
export function settingsRowOffset(
  section: SettingsSectionSpec,
  width: number,
  rowId: string,
): number | null {
  const m = metrics(width);
  let y = section.title || section.trailing ? HEADING * m.ui : 0;
  for (const row of section.rows) {
    if (row.id === rowId) return y;
    y += rowHeight(row, m);
  }
  return null;
}

function RowLabel(props: { row: SettingRowSpec; width: number; height: number; y?: number }) {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const { row } = props;
  const blockH = (row.description ? 36 : 18) * ui;
  const top = (props.y ?? 0) + (props.height - blockH) / 2;
  return (
    <>
      <TextBlock
        y={top}
        width={props.width}
        height={18 * ui}
        text={row.label}
        fontSize={13}
        fontWeight="medium"
        color={
          row.labelTone === "accent" ? pal.accent : row.labelTone === "muted" ? pal.muted : pal.text
        }
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {row.description ? (
        <TextBlock
          y={top + 19 * ui}
          width={props.width}
          height={17 * ui}
          text={row.description}
          fontSize={11}
          color={
            row.descriptionTone === "accent"
              ? pal.accent
              : row.descriptionTone === "danger"
                ? pal.danger
                : pal.muted
          }
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : null}
    </>
  );
}

function SettingRow(props: {
  row: SettingRowSpec;
  width: number;
  height: number;
  highlighted: boolean;
  m: Metrics;
}): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const { row, m } = props;
  const [rowHovered, setRowHovered] = useState(false);
  const [rowFocused, setRowFocused] = useState(false);
  const [controlHovered, setControlHovered] = useState(false);
  const [controlFocused, setControlFocused] = useState(false);
  const revealed = rowHovered || rowFocused || controlHovered || controlFocused;
  const control = row.revealControl && revealed ? row.revealControl : row.control;
  const reveal: SettingRevealHandlers = {
    onHoverChange: setControlHovered,
    onFocusChange: setControlFocused,
  };
  const lead = leadWidth(row, m);
  const interactive = !!row.onPress || !!row.revealControl;
  const background = (
    <>
      {props.highlighted ? (
        <Rect
          x={6 * m.ui}
          y={4 * m.ui}
          width={props.width - 12 * m.ui}
          height={props.height - 8 * m.ui}
          radius={8 * m.ui}
          fill={mixColor(pal.surface, pal.accent, 0.18)}
        />
      ) : null}
      {interactive ? (
        <Pressable
          x={6 * m.ui}
          y={4 * m.ui}
          width={props.width - 12 * m.ui}
          height={props.height - 8 * m.ui}
          radius={8 * m.ui}
          fill={0x00000000}
          focusable={!!row.onPress}
          focusId={row.focusId}
          onHoverChange={setRowHovered}
          onFocusChange={setRowFocused}
          onPress={row.onPress}
        />
      ) : null}
    </>
  );
  const leading = row.leading ? (
    <Group x={m.pad} y={(props.height - LEAD * m.ui) / 2} width={LEAD * m.ui} height={LEAD * m.ui}>
      {row.leading}
    </Group>
  ) : row.icon ? (
    <IconTile
      x={m.pad}
      y={(props.height - LEAD * m.ui) / 2}
      size={LEAD}
      icon={row.icon}
      tint={row.tint}
    />
  ) : null;

  if (control?.kind === "block") {
    const height = (control.height ?? CONTROL_H) * m.ui;
    return (
      <>
        {background}
        <Group x={m.pad} y={m.pad} width={m.inner} height={height}>
          {control.render(m.inner, reveal)}
        </Group>
      </>
    );
  }
  const width = controlWidth(control, row, m);
  const controlH = (control?.height ?? CONTROL_H) * m.ui;
  if (control && width == null) {
    // Stacked: the label on top, the control across the row under it.
    const labelH = labelHeight(row, m);
    const textWidth = Math.max(1, m.inner - lead);
    return (
      <>
        {background}
        {leading}
        <Group x={m.pad + lead} y={12 * m.ui} width={textWidth} height={labelH}>
          <RowLabel row={row} width={textWidth} height={labelH} />
        </Group>
        <Group x={m.pad} y={12 * m.ui + labelH + 8 * m.ui} width={m.inner} height={controlH}>
          {control.render(m.inner, reveal)}
        </Group>
      </>
    );
  }
  const reserved = trailingWidth(row, m, width ?? 0);
  // A revealed control may be wider than what rests there; reserve the wider of the two.
  const restingReserve = row.revealControl
    ? Math.max(reserved, trailingWidth(row, m, controlWidth(row.revealControl, row, m) ?? 0))
    : reserved;
  const textWidth = Math.max(1, m.inner - lead - restingReserve - (restingReserve ? 12 * m.ui : 0));
  let right = m.pad + m.inner;
  const parts: ReactNode[] = [];
  if (row.chevron) {
    right -= CHEVRON * m.ui;
    parts.push(
      <Icon
        key="chevron"
        x={right}
        y={(props.height - CHEVRON * m.ui) / 2}
        name="chevron-right"
        size={CHEVRON * m.ui}
        color={pal.muted}
        symbolic
      />,
    );
    right -= 8 * m.ui;
  }
  if (control && width) {
    right -= width;
    parts.push(
      <Horizontal
        key="control"
        x={right}
        width={width}
        height={props.height}
        justify="end"
        align="center"
      >
        {control.render(width, reveal)}
      </Horizontal>,
    );
    right -= 8 * m.ui;
  }
  const value = valueWidth(row, m);
  if (value) {
    right -= value;
    parts.push(
      <TextBlock
        key="value"
        x={right}
        width={value}
        height={props.height}
        text={row.value!}
        fontSize={13}
        color={pal.muted}
        horizontalAlign="end"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />,
    );
  }
  return (
    <>
      {background}
      {leading}
      <Group x={m.pad + lead} width={textWidth} height={props.height}>
        <RowLabel row={row} width={textWidth} height={props.height} />
      </Group>
      {parts}
    </>
  );
}

export type SettingsSectionProps = {
  x?: number;
  y?: number;
  width: number;
  section: SettingsSectionSpec;
  /** The row a deep link landed on, drawn with an accent wash. */
  highlightedId?: string | null;
};

/** A titled card of setting rows. Its height is `settingsSectionHeight(section, width)`. */
export function SettingsSection(props: SettingsSectionProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const { section } = props;
  const m = metrics(props.width);
  const heading = section.title || section.trailing ? HEADING * m.ui : 0;
  const heights = section.rows.map((row) => rowHeight(row, m));
  const cardH = heights.reduce((sum, value) => sum + value, 0);
  const trailing = (section.trailingWidth ?? 0) * m.ui;
  const iconW = section.titleIcon ? 22 * m.ui : 0;
  let y = 0;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={settingsSectionHeight(section, props.width)}
    >
      {section.titleIcon ? (
        <Icon
          x={4 * m.ui}
          y={(heading - 6 * m.ui - 16 * m.ui) / 2}
          name={section.titleIcon}
          size={16 * m.ui}
          color={section.titleTint ?? pal.muted}
          symbolic
        />
      ) : null}
      {section.title ? (
        <TextBlock
          x={4 * m.ui + iconW}
          width={Math.max(1, props.width - 8 * m.ui - iconW - trailing)}
          height={heading - 6 * m.ui}
          text={section.title}
          fontSize={12}
          fontWeight="medium"
          color={pal.muted}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : null}
      {section.trailing ? (
        <Horizontal
          x={props.width - trailing}
          width={trailing}
          height={heading - 6 * m.ui}
          justify="end"
          align="center"
        >
          {section.trailing}
        </Horizontal>
      ) : null}
      {section.rows.length ? (
        <Surface
          y={heading}
          width={props.width}
          height={cardH}
          fill={pal.surface}
          radius={12 * m.ui}
          stroke={pal.borderSubtle}
          strokeWidth={1}
        >
          {section.rows.map((row, index) => {
            const top = y;
            y += heights[index]!;
            return (
              <Group key={row.id} y={top} width={props.width} height={heights[index]!}>
                {index > 0 ? (
                  <Separator x={m.pad} width={m.inner} color={pal.borderSubtle} />
                ) : null}
                <SettingRow
                  row={row}
                  width={props.width}
                  height={heights[index]!}
                  highlighted={props.highlightedId === row.id}
                  m={m}
                />
              </Group>
            );
          })}
        </Surface>
      ) : null}
      {section.footnote ? (
        <TextBlock
          x={4 * m.ui}
          y={heading + cardH}
          width={footnoteWidth(props.width, m)}
          height={footnoteHeight(section.footnote, props.width, m)}
          text={section.footnote}
          fontSize={FOOTNOTE_FONT}
          color={pal.muted}
          verticalAlign="center"
          wrap
          overflow="ellipsis"
          maxLines={FOOTNOTE_LINES}
        />
      ) : null}
    </Group>
  );
}
