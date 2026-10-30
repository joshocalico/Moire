/**
 * Date, Time & Region: the time now, the time zone and network time through timedated (via the
 * time settings service), and the clock and date formats every Moire app shares.
 */
import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Box,
  ScrollArea,
  SearchField,
  SettingsSection,
  TextBlock,
  getUiScaleFactor,
  settingsSectionHeight,
  usePalette,
} from "@moire/ui";
import {
  DEFAULT_REGION_SETTINGS,
  formatCalendarDate,
  formatClockTime,
  systemTimeZone,
  type RegionSettings,
} from "@moire/prefs";
import { searchTimeZones, type TimeZoneEntry } from "@moire/system-management/time-settings";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { linkRow, section, selectRow, toggleRow } from "#settings-view/rows";

const PAGE = "datetime";
const ZONE_RESULTS = 40;

/** Locales offered for formats; "system" follows the system language. */
const LOCALES = [
  { id: "system", label: "System language" },
  { id: "en-GB", label: "English (UK)" },
  { id: "en-US", label: "English (US)" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "de-DE", label: "Deutsch" },
  { id: "fr-FR", label: "Français" },
  { id: "es-ES", label: "Español" },
  { id: "it-IT", label: "Italiano" },
  { id: "nl-NL", label: "Nederlands" },
  { id: "pt-BR", label: "Português (Brasil)" },
  { id: "ja-JP", label: "日本語" },
];

/** The time, re-rendered each second; follows the zone timedated last wrote. */
function LiveTime(props: {
  region: RegionSettings;
  zone: string | null;
  width: number;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box width={props.width} height={44 * ui}>
      <TextBlock
        width={props.width}
        height={26 * ui}
        text={formatClockTime(now, props.region, { timeZone: props.zone, seconds: true })}
        fontSize={20}
        fontWeight="medium"
        verticalAlign="center"
        maxLines={1}
      />
      <TextBlock
        y={26 * ui}
        width={props.width}
        height={18 * ui}
        text={formatCalendarDate(now, props.region, { style: "long", timeZone: props.zone })}
        fontSize={12}
        color={pal.muted}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
    </Box>
  );
}

function zoneLabel(entry: TimeZoneEntry): string {
  const country = entry.countries[0]?.name;
  return [entry.city, country].filter(Boolean).join(", ");
}

/** Search the zone catalog and pick one. */
function ZoneSheet(props: { context: PageContext; width: number; height: number }): ReactNode {
  const { context } = props;
  const ui = getUiScaleFactor();
  const [query, setQuery] = useState("");
  const zones = context.time.zones;
  const current = context.time.status?.timeZone;
  const results = useMemo(
    () => (zones ? searchTimeZones(zones, query, ZONE_RESULTS) : []),
    [zones, query],
  );
  const inner = props.width - 32 * ui;
  const list = section(
    "zones",
    undefined,
    zones
      ? results.length
        ? results.map((entry) => ({
            id: `zone:${entry.id}`,
            label: zoneLabel(entry),
            labelTone: entry.id === current ? ("accent" as const) : undefined,
            description: [entry.id, entry.comment].filter(Boolean).join(" · "),
            focusId: `datetime:zone:${entry.id}`,
            onPress: () => {
              context.closeSheet();
              context.attempt(PAGE, async () => {
                const result = await context.calls.run("timezone", () =>
                  context.time.client!.setTimeZone(entry.id),
                );
                return result.ok ? null : result.message;
              });
            },
          }))
        : [{ id: "zone:none", label: "No time zones match", description: "Try a city or country" }]
      : [{ id: "zone:loading", label: "Reading time zones…" }],
  );
  const listH = settingsSectionHeight(list, inner);
  const top = 48 * ui;
  return (
    <Box width={props.width} height={props.height}>
      <SearchField
        x={16 * ui}
        width={inner}
        height={34 * ui}
        value={query}
        placeholder="Search cities and countries"
        autoFocus
        focusId="datetime:zone-search"
        onChange={setQuery}
      />
      <ScrollArea
        y={top}
        width={props.width}
        height={props.height - top}
        contentHeight={listH + 16 * ui}
      >
        <SettingsSection x={16 * ui} width={inner} section={list} />
      </ScrollArea>
    </Box>
  );
}

export function datetimePage(context: PageContext): PageContent {
  const region = context.prefs.values.region ?? DEFAULT_REGION_SETTINGS;
  const status = context.time.status;
  const zone = status?.timeZone || systemTimeZone();
  const viewport = { width: context.width, height: context.height };
  const setRegion = (patch: Partial<RegionSettings>, label: string) =>
    context.prefs.set({ region: { ...region, ...patch } }, { label, page: PAGE });
  const timeRows = [
    {
      id: "now",
      label: "Now",
      control: {
        kind: "block" as const,
        height: 44,
        render: (width: number) => <LiveTime region={region} zone={zone} width={width} />,
      },
    },
    status && context.time.client
      ? linkRow(
          "datetime.timezone",
          () => {
            context.time.loadZones();
            context.openSheet(PAGE, "timezone");
          },
          { value: zone ?? "UTC", description: "Where you are; the panel clock follows it" },
        )
      : {
          id: "datetime.timezone",
          label: "Time zone",
          value: zone ?? "UTC",
          description: "Set in the system configuration",
        },
    status?.ntp.available
      ? toggleRow(
          "datetime.automatic",
          status.ntp.enabled,
          (on) =>
            context.attempt(PAGE, async () => {
              const result = await context.calls.run("ntp", () =>
                context.time.client!.setNetworkTime(on),
              );
              return result.ok ? null : result.message;
            }),
          {
            description: status.ntp.enabled
              ? status.ntp.synchronized
                ? "Synchronized with network time"
                : "Waiting for network time"
              : "The clock keeps its own time",
            disabled: context.calls.busy === "ntp",
          },
        )
      : null,
  ];
  return {
    summary: `${zone ?? "UTC"} · ${region.clock === "24h" ? "24-hour" : "12-hour"} clock`,
    banners:
      context.time.state && context.time.state.kind !== "ready"
        ? [
            {
              id: "time-service",
              title: "Time zone and network time can't be changed",
              message: context.time.state.message,
              tone: "warning",
            },
          ]
        : undefined,
    anchors: ["datetime.now"],
    sections: [
      section("datetime.now", "Date and time", timeRows),
      section("datetime.formats", "Formats", [
        toggleRow("datetime.clock24", region.clock === "24h", (on) =>
          setRegion(
            { clock: on ? "24h" : "12h" },
            on ? "24-hour clock turned on" : "12-hour clock turned on",
          ),
        ),
        selectRow(
          "datetime.region",
          viewport,
          region.formatLocale ?? "system",
          region.formatLocale && !LOCALES.some((locale) => locale.id === region.formatLocale)
            ? [...LOCALES, { id: region.formatLocale, label: region.formatLocale }]
            : LOCALES,
          (id) => {
            const label = LOCALES.find((locale) => locale.id === id)?.label ?? id;
            setRegion(
              { formatLocale: id === "system" ? null : id },
              `Region formats set to ${label}`,
            );
          },
          { description: formatCalendarDate(Date.now(), region, { timeZone: zone }) },
        ),
        selectRow(
          "datetime.date-order",
          viewport,
          region.dateFormat,
          [
            { id: "locale", label: "As the region does" },
            { id: "day-month-year", label: "Day/month/year" },
            { id: "month-day-year", label: "Month/day/year" },
            { id: "iso", label: "Year-month-day" },
          ],
          (id) =>
            setRegion({ dateFormat: id as RegionSettings["dateFormat"] }, "Date order changed"),
        ),
        selectRow(
          "datetime.week",
          viewport,
          region.firstDayOfWeek,
          [
            { id: "locale", label: "As the region does" },
            { id: "monday", label: "Monday" },
            { id: "sunday", label: "Sunday" },
            { id: "saturday", label: "Saturday" },
          ],
          (id) =>
            setRegion(
              { firstDayOfWeek: id as RegionSettings["firstDayOfWeek"] },
              "First day of the week changed",
            ),
        ),
      ]),
    ],
    sheet: (id) =>
      id === "timezone" && context.time.client
        ? {
            title: "Time zone",
            subtitle: zone ?? undefined,
            body: (size) => <ZoneSheet context={context} {...size} />,
          }
        : null,
  };
}
