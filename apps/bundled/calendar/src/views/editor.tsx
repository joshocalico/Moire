/** The event editor dialog: text fields, a colour, and how the event repeats. */
import React, { useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  FocusScope,
  Horizontal,
  Measure,
  ModalBarrier,
  Pressable,
  ScrollColumn,
  SegmentedControl,
  ShortcutManager,
  Surface,
  TextBlock,
  TextField,
  Vertical,
  getUiScaleFactor,
  measureColumnContent,
  useWidgetTheme,
  type WindowSize,
} from "@moire/ui";
import { EVENT_COLORS, type DraftKey, type EventDraft } from "#calendar/model";
import { eventColor } from "./color";

type TextKey = "title" | "date" | "start" | "end" | "timeZone" | "notes";
const TEXT_FIELDS: readonly { key: TextKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "date", label: "Date YYYY-MM-DD" },
  { key: "start", label: "Start HH:MM" },
  { key: "end", label: "End HH:MM" },
  { key: "timeZone", label: "Time zone" },
  { key: "notes", label: "Notes" },
];
const COLOR_CHOICES = [{ id: "default", label: "Default" } as const, ...EVENT_COLORS];
const REPEAT_OPTIONS = [
  { id: "none", label: "None" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
] as const;
const END_OPTIONS = [
  { id: "never", label: "Never" },
  { id: "count", label: "After" },
  { id: "until", label: "On date" },
] as const;
const REPEAT_UNITS = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};
const EDITOR_WIDTH = 520;
const SWATCH = 28;

type ChangeDraft = <K extends DraftKey>(key: K, value: EventDraft[K]) => void;
type EditorProps = { draft: EventDraft; status: string; onChange: ChangeDraft };

type Theme = ReturnType<typeof useWidgetTheme>;

/*
 * The helpers below return plain elements rather than being components: column layout measures
 * its direct children, and a wrapper component would measure as empty.
 */
function labelled(theme: Theme, key: string, label: string, control: ReactNode): ReactNode {
  return (
    <Vertical key={key} gap={theme.foundations.space.xs}>
      <TextBlock text={label} fontSize={13} color={theme.foundations.palette.muted} wrap />
      {control}
    </Vertical>
  );
}

function colorSwatches(theme: Theme, props: EditorProps & { width: number }): ReactNode {
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const size = SWATCH * ui;
  const chosen = COLOR_CHOICES.find((choice) => choice.id === props.draft.color)!;
  return labelled(
    theme,
    "color",
    `Colour · ${chosen.label}`,
    <Horizontal width={props.width} gap={8 * ui} wrap>
      {COLOR_CHOICES.map((choice) => {
        const selected = choice.id === props.draft.color;
        const fill = eventColor(choice.id, pal.accent);
        return (
          <Pressable
            key={choice.id}
            width={size}
            height={size}
            radius={size / 2}
            fill={fill}
            hoverFill={fill}
            pressedFill={fill}
            stroke={selected ? pal.text : undefined}
            strokeWidth={selected ? 2 * ui : undefined}
            focusId={`calendar:color:${choice.id}`}
            onPress={() => props.onChange("color", choice.id)}
          >
            {selected ? (
              <Surface
                x={size / 2 - 4 * ui}
                y={size / 2 - 4 * ui}
                width={8 * ui}
                height={8 * ui}
                radius={4 * ui}
                fill={pal.bg}
              />
            ) : null}
          </Pressable>
        );
      })}
    </Horizontal>,
  );
}

/** Every editor control in order; the repeat details appear once a repeat is chosen. */
function editorControls(theme: Theme, props: EditorProps & { width: number }): ReactNode[] {
  const { draft, onChange, width } = props;
  const field = (key: TextKey | "interval" | "count" | "until", label: string, autoFocus = false) =>
    labelled(
      theme,
      key,
      label,
      <TextField
        width={width}
        value={draft[key]}
        autoFocus={autoFocus}
        focusId={`calendar:field:${key}`}
        onChange={(value) => onChange(key, value)}
      />,
    );
  const choice = <K extends "repeat" | "ends">(
    key: K,
    label: string,
    options: readonly { id: EventDraft[K]; label: string }[],
  ) =>
    labelled(
      theme,
      key,
      label,
      <SegmentedControl
        width={width}
        options={options}
        value={draft[key]}
        onChange={(id) => onChange(key, id as EventDraft[K])}
      />,
    );
  const controls = TEXT_FIELDS.map(({ key, label }, index) => field(key, label, index === 0));
  controls.push(colorSwatches(theme, props), choice("repeat", "Repeat", REPEAT_OPTIONS));
  if (draft.repeat === "none") return controls;
  controls.push(
    field("interval", `Repeat every … ${REPEAT_UNITS[draft.repeat]}`),
    choice("ends", "Ends", END_OPTIONS),
  );
  if (draft.ends === "count") controls.push(field("count", "Number of times"));
  if (draft.ends === "until") controls.push(field("until", "Last date YYYY-MM-DD"));
  return controls;
}

function DraftFields(props: WindowSize & EditorProps): ReactNode {
  const theme = useWidgetTheme();
  const [scrollY, setScrollY] = useState(0);
  const children = (
    <>
      {editorControls(theme, props)}
      <TextBlock text={props.status} color={theme.foundations.palette.muted} fontSize={11} wrap />
    </>
  );
  const maxScroll = Math.max(
    0,
    measureColumnContent({ width: props.width, gap: theme.foundations.space.md, children }, theme)
      .height - props.height,
  );
  const page = props.height * 0.8;
  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      shortcuts={[
        {
          id: "draft-next-page",
          key: "PageDown",
          onInvoke: () => setScrollY((old) => Math.min(maxScroll, old + page)),
        },
        {
          id: "draft-previous-page",
          key: "PageUp",
          onInvoke: () => setScrollY((old) => Math.max(0, old - page)),
        },
      ]}
    >
      <ScrollColumn
        width={props.width}
        height={props.height}
        gap={theme.foundations.space.md}
        scrollY={Math.min(maxScroll, scrollY)}
        onScroll={setScrollY}
        smooth={false}
      >
        {children}
      </ScrollColumn>
    </ShortcutManager>
  );
}

export function CalendarEventEditor(
  props: WindowSize & EditorProps & { onCancel: () => void; onSave: () => void },
): ReactNode {
  const theme = useWidgetTheme(),
    spacing = theme.foundations.space,
    metrics = theme.recipes.dialog.medium.metrics;
  const width = Math.max(
    1,
    Math.min(EDITOR_WIDTH * getUiScaleFactor(), props.width - spacing.md * 2),
  );
  const inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const footer = (
    <Horizontal width={inner} wrap align="center" gap={spacing.sm}>
      <Button label="Cancel" onPress={props.onCancel} />
      <Button label="Save Event" variant="primary" onPress={props.onSave} />
    </Horizontal>
  );
  const footerHeight = measureColumnContent(
    {
      width,
      padding: {
        top: spacing.sm,
        right: metrics.bodyPaddingX,
        bottom: metrics.bodyPaddingBottom,
        left: metrics.bodyPaddingX,
      },
      gap: 0,
      children: footer,
    },
    theme,
  ).height;
  const bodyHeight = measureColumnContent(
    {
      width: inner,
      gap: spacing.md,
      children: [
        ...editorControls(theme, { ...props, width: inner }),
        <TextBlock key="status" text={props.status} fontSize={11} wrap />,
      ],
    },
    theme,
  ).height;
  const height = Math.max(
    1,
    Math.min(
      props.height - spacing.md * 2,
      Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyHeight + footerHeight),
    ),
  );
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible onDismiss={props.onCancel} />
      <FocusScope
        x={(props.width - width) / 2}
        y={(props.height - height) / 2}
        width={width}
        height={height}
        trap
        onEscape={props.onCancel}
      >
        <ShortcutManager
          width={width}
          height={height}
          shortcuts={[{ id: "save-draft", key: "s", ctrl: true, onInvoke: props.onSave }]}
        >
          <Dialog
            width={width}
            height={height}
            title={props.draft.id ? "Edit event" : "New event"}
            onClose={props.onCancel}
            footer={footer}
          >
            <Measure flexGrow={1} minHeight={1}>
              {(size) => (
                <DraftFields
                  {...size}
                  draft={props.draft}
                  status={props.status}
                  onChange={props.onChange}
                />
              )}
            </Measure>
          </Dialog>
        </ShortcutManager>
      </FocusScope>
    </>
  );
}
