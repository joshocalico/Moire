import React, { useState, type ReactNode } from "react";
import {
  APP_STATUS_HEIGHT,
  AppHeaderBar,
  AppStatusLine,
  SegmentedControl,
  ShortcutManager,
  Surface,
  appChromeBody,
  getUiScaleFactor,
  usePalette,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { ToolButton, runApp, startMain } from "@moire/app-tools";
import { useNow, useUnits, useWeather, type WeatherBackend } from "./hooks";
import {
  APP_ID,
  freshness,
  selectedForecast,
  statusText,
  type TemperatureUnit,
  type WindUnit,
} from "./model";
import { WeatherCache, WeatherClient } from "./weather";
import { ForecastPane } from "./views/forecast-pane";
import { PlacesSidebar } from "./views/sidebar";

const PAD = 16;
const SIDEBAR_WIDTH = 280;
/** evdev KEY_R, for Ctrl+R refresh. */
const KEY_R = 19;

export function WeatherApp(
  props: WindowSize &
    WeatherBackend & {
      /** The window the header bar controls (minimize, maximize, close, move). */
      window?: WindowActions | null;
    },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const weather = useWeather(props);
  const [units, setUnits] = useUnits(weather.notify);
  const [query, setQuery] = useState("");
  const now = useNow();
  const { state } = weather;
  const { selected: place } = state;
  const forecast = selectedForecast(state);
  const busy = state.sync.kind === "loading";

  const pad = PAD * ui;
  const { y: top, height: bodyH } = appChromeBody(props.height);
  const sidebarW = Math.min(SIDEBAR_WIDTH * ui, Math.floor(props.width * 0.36));
  const contentX = pad + sidebarW + pad;
  const contentW = Math.max(1, props.width - contentX - pad);
  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      shortcuts={[
        {
          id: "refresh",
          code: KEY_R,
          ctrl: true,
          disabled: !place,
          onInvoke: weather.refresh,
        },
      ]}
    >
      <Surface width={props.width} height={props.height} fill={pal.bg} clip>
        <AppHeaderBar
          width={props.width}
          title="Weather"
          icon="weather"
          subtitle={place ? [place.name, place.country].filter(Boolean).join(", ") : undefined}
          window={props.window}
          actions={
            <>
              <SegmentedControl
                width={84 * ui}
                height={30 * ui}
                size="small"
                options={[
                  { id: "celsius", label: "°C" },
                  { id: "fahrenheit", label: "°F" },
                ]}
                value={units.temperature}
                onChange={(id) => setUnits({ ...units, temperature: id as TemperatureUnit })}
              />
              <SegmentedControl
                width={108 * ui}
                height={30 * ui}
                size="small"
                options={[
                  { id: "kmh", label: "km/h" },
                  { id: "mph", label: "mph" },
                ]}
                value={units.wind}
                onChange={(id) => setUnits({ ...units, wind: id as WindUnit })}
              />
              <ToolButton
                icon="restart"
                tooltip={busy ? "Updating…" : "Refresh (Ctrl+R)"}
                focusId="weather:refresh"
                disabled={!place || busy}
                onPress={weather.refresh}
              />
            </>
          }
        />
        <PlacesSidebar
          x={pad}
          y={top + pad}
          width={sidebarW}
          height={bodyH - pad * 2}
          query={query}
          search={state.search}
          entries={state.entries}
          selectedId={place?.id ?? null}
          units={units}
          now={now}
          onQuery={setQuery}
          onSearch={() => weather.search(query)}
          onPick={weather.open}
          onRemove={weather.remove}
          onClear={weather.clear}
        />
        <ForecastPane
          x={contentX}
          y={top}
          width={contentW + pad}
          height={bodyH}
          place={place}
          forecast={forecast}
          sync={state.sync}
          units={units}
          freshness={freshness(state, now)}
          onRetry={weather.refresh}
        />
        <AppStatusLine
          y={props.height - APP_STATUS_HEIGHT * ui}
          width={props.width}
          status={statusText(state, now)}
          end="Open-Meteo · CC BY 4.0"
        />
      </Surface>
    </ShortcutManager>
  );
}

export async function main(): Promise<void> {
  const client = new WeatherClient();
  const cache = new WeatherCache();
  await runApp(
    "Weather",
    APP_ID,
    (size, window) => <WeatherApp {...size} window={window} client={client} cache={cache} />,
    { width: 860, height: 700 },
  );
}

startMain(import.meta.url, main);
