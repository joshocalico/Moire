/** The month grid: six weeks of days, today circled, a coloured dot per event. */
import React, { type ReactNode } from "react";
import {
  Box,
  Label,
  Pressable,
  Surface,
  getUiScaleFactor,
  usePalette,
  useWidgetTheme,
} from "@moire/ui";
import { WEEKDAYS } from "#calendar/dates";
import type { Occurrence } from "#calendar/model";
import { eventColor, tint } from "./color";
import type { Frame } from "./frame";

const MAX_DOTS = 3;

export function MonthGrid(
  props: Frame & {
    month: string;
    days: readonly string[];
    byDay: ReadonlyMap<string, readonly Occurrence[]>;
    selected: string;
    today: string;
    onSelect: (date: string) => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const onAccent = useWidgetTheme().recipes.button.primary.medium.label.base.color;
  const pad = 8 * ui,
    weekdayH = 26 * ui,
    inset = 2 * ui;
  const cellW = (props.width - pad * 2) / 7;
  const cellH = Math.max(
    24 * ui,
    Math.min(cellW * 0.95, 64 * ui, (props.height - pad * 2 - weekdayH) / 6),
  );
  const cardH = pad * 2 + weekdayH + cellH * 6;
  const w = cellW - inset * 2,
    h = cellH - inset * 2;
  // Leave room under today's circle for the event dots.
  const mark = Math.max(16 * ui, Math.min(26 * ui, h - 14 * ui));
  const dot = 5 * ui,
    dotPitch = 8 * ui;
  return (
    <Box x={props.x} y={props.y} width={props.width} height={props.height}>
      <Surface
        width={props.width}
        height={cardH}
        fill={pal.surface}
        radius={12 * ui}
        stroke={pal.borderSubtle}
        strokeWidth={1}
      >
        {WEEKDAYS.map((name, index) => (
          <Label
            key={name}
            x={pad + index * cellW}
            y={pad}
            width={cellW}
            height={weekdayH}
            text={name}
            color={pal.muted}
            fontSize={11}
            fontWeight="medium"
            horizontalAlign="center"
            verticalAlign="center"
          />
        ))}
        {props.days.map((day, index) => {
          const occurrences = props.byDay.get(day) ?? [];
          const dots = occurrences.slice(0, MAX_DOTS);
          const selected = day === props.selected,
            today = day === props.today,
            inMonth = day.startsWith(props.month);
          return (
            <Pressable
              key={day}
              x={pad + (index % 7) * cellW + inset}
              y={pad + weekdayH + Math.floor(index / 7) * cellH + inset}
              width={w}
              height={h}
              radius={8 * ui}
              fill={selected ? tint(pal.accent, 0x2e) : 0x00000000}
              hoverFill={selected ? tint(pal.accent, 0x40) : pal.hover}
              pressedFill={pal.pressed}
              focusId={`day:${day}`}
              onPress={() => props.onSelect(day)}
            >
              {today ? (
                <Surface
                  x={(w - mark) / 2}
                  y={4 * ui}
                  width={mark}
                  height={mark}
                  radius={mark / 2}
                  fill={pal.accent}
                />
              ) : null}
              <Label
                y={4 * ui}
                width={w}
                height={mark}
                text={String(Number(day.slice(-2)))}
                fontSize={13}
                fontWeight={today || selected ? "medium" : "regular"}
                color={today ? onAccent : selected ? pal.accent : inMonth ? pal.text : pal.muted}
                horizontalAlign="center"
                verticalAlign="center"
              />
              {h >= mark + 12 * ui
                ? dots.map((occurrence, at) => {
                    const color = eventColor(occurrence.event.color, pal.accent);
                    return (
                      <Surface
                        key={occurrence.key}
                        x={w / 2 + (at - (dots.length - 1) / 2) * dotPitch - dot / 2}
                        y={mark + 7 * ui}
                        width={dot}
                        height={dot}
                        radius={dot / 2}
                        fill={inMonth ? color : tint(color, 0x80)}
                      />
                    );
                  })
                : null}
            </Pressable>
          );
        })}
      </Surface>
    </Box>
  );
}
