import React, { useEffect, useRef, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Button,
  Pressable,
  Label,
  ScrollArea,
  SearchField,
  Surface,
  Toolbar,
  Window,
  usePalette,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import {
  WeatherCache,
  WeatherClient,
  weatherLabel,
  type CachedPlace,
  type Forecast,
  type Place,
} from "./weather";
export function WeatherApp(
  props: WindowSize & { client: Pick<WeatherClient, "forecast" | "search">; cache: WeatherCache },
): ReactNode {
  const uiScale = getUiScaleFactor();
  const pal = usePalette();
  const [loaded] = useState(() => {
    try {
      return { entries: props.cache.read(), error: "" };
    } catch (error) {
      return { entries: [], error: `Local weather cache could not be read: ${String(error)}` };
    }
  });
  const [entries, setEntries] = useState<CachedPlace[]>(loaded.entries),
    [place, setPlace] = useState<Place | null>(loaded.entries[0]?.place ?? null),
    [forecast, setForecast] = useState<Forecast | null>(loaded.entries[0]?.forecast ?? null),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [status, setStatus] = useState(loaded.error || "Search for a city to see its weather"),
    [offline, setOffline] = useState(false);
  const weatherRequest = useRef<AbortController | null>(null),
    searchRequest = useRef<AbortController | null>(null),
    entriesRef = useRef(entries);
  entriesRef.current = entries;
  const load = async (next: Place, force = true) => {
    weatherRequest.current?.abort();
    const request = new AbortController();
    weatherRequest.current = request;
    setPlace(next);
    const saved = entriesRef.current.find((entry) => entry.place.id === next.id);
    setForecast(saved?.forecast ?? null);
    setOffline(false);
    if (!force && saved && Date.now() - saved.forecast.fetchedAt < 900000) {
      setBusy(false);
      setStatus(`Cached forecast from ${new Date(saved.forecast.fetchedAt).toLocaleTimeString()}`);
      return;
    }
    setBusy(true);
    setStatus(`Updating ${next.name}…`);
    try {
      const updated = await props.client.forecast(next, request.signal);
      if (weatherRequest.current !== request || request.signal.aborted) return;
      setForecast(updated);
      const nextEntries = [
        { place: next, forecast: updated },
        ...entriesRef.current.filter((entry) => entry.place.id !== next.id),
      ].slice(0, 8);
      entriesRef.current = nextEntries;
      setEntries(nextEntries);
      try {
        props.cache.write(nextEntries);
        setStatus(
          `Updated ${new Date(updated.fetchedAt).toLocaleTimeString()} · ${updated.timeZone}`,
        );
      } catch (error) {
        setStatus(`Forecast updated, but cache could not be saved: ${String(error)}`);
      }
    } catch (error) {
      if (weatherRequest.current !== request || request.signal.aborted) return;
      setOffline(true);
      setStatus(
        saved
          ? `Offline · showing saved forecast from ${new Date(saved.forecast.fetchedAt).toLocaleString()}`
          : `Forecast unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (weatherRequest.current === request && !request.signal.aborted) setBusy(false);
    }
  };
  const search = async () => {
    searchRequest.current?.abort();
    const request = new AbortController();
    searchRequest.current = request;
    setSearching(true);
    setResults([]);
    try {
      const found = await props.client.search(query, request.signal);
      if (request.signal.aborted) return;
      setResults(found);
      setStatus(
        found.length
          ? "Choose a location from the results"
          : "No locations matched. Try a nearby city.",
      );
    } catch (error) {
      if (!request.signal.aborted) setStatus(`Location search unavailable: ${String(error)}`);
    } finally {
      if (!request.signal.aborted) setSearching(false);
    }
  };
  useEffect(() => {
    if (place) void load(place, false);
    return () => {
      weatherRequest.current?.abort();
      searchRequest.current?.abort();
    };
  }, []);
  const sidebar = Math.min(300, Math.floor(props.width * 0.37)),
    contentX = sidebar + 22,
    contentW = Math.max(200, props.width - contentX - 20);
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg} clip>
      <Toolbar width={props.width} height={68}>
        <Label flexGrow={1} text="Weather" fontSize={22} fontWeight="bold" />
        <Button
          width={100 * uiScale}
          label={busy ? "Updating…" : "Refresh"}
          disabled={!place || busy}
          onPress={() => place && void load(place)}
        />
      </Toolbar>
      <SearchField
        x={16}
        y={86}
        width={sidebar - 24}
        value={query}
        placeholder="City or town"
        onChange={setQuery}
        onSubmit={() => void search()}
      />
      <Button
        x={16}
        y={132}
        width={sidebar - 24}
        label={searching ? "Searching…" : "Find Location"}
        disabled={searching}
        onPress={() => void search()}
      />
      <ScrollArea
        x={16}
        y={190}
        width={sidebar - 24}
        height={Math.max(90, props.height - 310)}
        contentHeight={Math.max(90, (results.length + entries.length) * 70 + 36)}
      >
        {results.map((result, index) => (
          <Pressable
            key={`${result.id}:${index}`}
            y={index * 70}
            width={sidebar - 40}
            height={58}
            fill={pal.panel}
            hoverFill={pal.selection}
            radius={pal.radiusMd}
            onPress={() => {
              setResults([]);
              void load(result);
            }}
          >
            <Label
              x={12}
              y={6}
              width={sidebar - 64}
              text={result.name}
              fontSize={13}
              overflow="ellipsis"
              maxLines={1}
            />
            <Label
              x={12}
              y={32}
              width={sidebar - 64}
              text={result.country}
              color={pal.muted}
              fontSize={10}
              overflow="ellipsis"
              maxLines={1}
            />
          </Pressable>
        ))}
        <Label y={results.length * 70 + 6} text="Saved places" color={pal.muted} fontSize={11} />
        {entries.map((entry, index) => (
          <Pressable
            key={entry.place.id}
            y={results.length * 70 + 36 + index * 70}
            width={sidebar - 40}
            height={58}
            fill={place?.id === entry.place.id ? pal.selection : pal.panel}
            hoverFill={pal.selection}
            radius={pal.radiusMd}
            onPress={() => void load(entry.place, false)}
          >
            <Label
              x={12}
              y={6}
              width={sidebar - 64}
              text={entry.place.name}
              fontSize={13}
              overflow="ellipsis"
              maxLines={1}
            />
            <Label
              x={12}
              y={32}
              width={sidebar - 64}
              text={entry.place.country}
              color={pal.muted}
              fontSize={10}
              overflow="ellipsis"
              maxLines={1}
            />
          </Pressable>
        ))}
      </ScrollArea>
      <Button
        x={16}
        y={props.height - 100}
        width={sidebar - 24}
        label="Clear Saved Places"
        disabled={!entries.length}
        onPress={() => {
          weatherRequest.current?.abort();
          weatherRequest.current = null;
          setBusy(false);
          try {
            props.cache.write([]);
            entriesRef.current = [];
            setEntries([]);
            setStatus("Saved places cleared");
          } catch (error) {
            setStatus(String(error));
          }
        }}
      />
      <ScrollArea
        x={contentX}
        y={86}
        width={contentW}
        height={Math.max(90, props.height - 150)}
        contentHeight={forecast ? 660 + (uiScale - 1) * 86 : 180}
      >
        <Label
          text={place ? `${place.name}, ${place.country}` : "Your local forecast"}
          fontSize={23}
          fontWeight="bold"
        />
        {forecast ? (
          <>
            <Label y={48} text={`${Math.round(forecast.temperature)}°C`} fontSize={60} />
            <Label y={135 + (uiScale - 1) * 86} text={weatherLabel(forecast.code)} fontSize={20} />
            <Label
              y={178 + (uiScale - 1) * 86}
              text={`Feels like ${Math.round(forecast.feelsLike)}°C · Wind ${Math.round(forecast.wind)} km/h`}
              color={pal.muted}
              fontSize={12}
            />
            <Label
              y={210 + (uiScale - 1) * 86}
              text={offline ? "Saved forecast · offline" : "Seven-day forecast"}
              color={offline ? pal.muted : pal.accent}
              fontSize={13}
            />
            {forecast.days.map((day, index) => (
              <Surface
                key={day.date}
                y={244 + (uiScale - 1) * 86 + index * 54}
                width={contentW - 16}
                height={48}
                fill={pal.panel}
              >
                <Label
                  x={10}
                  y={6}
                  text={new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                  fontSize={12}
                />
                <Label
                  x={10}
                  y={27}
                  text={weatherLabel(day.code)}
                  color={pal.muted}
                  fontSize={10}
                />
                <Label
                  x={contentW - 180}
                  y={13}
                  text={`${Math.round(day.min)}° / ${Math.round(day.max)}°   ${day.rain}% rain`}
                  fontSize={12}
                />
              </Surface>
            ))}
          </>
        ) : (
          <Label
            y={54}
            width={contentW - 20}
            text={
              busy
                ? "Loading the forecast…"
                : "Choose a city in the location search. Weather uses Celsius and km/h."
            }
            color={pal.muted}
            fontSize={14}
          />
        )}
      </ScrollArea>
      <Label
        x={16}
        y={props.height - 52}
        width={props.width - 32}
        text={status}
        color={pal.muted}
        fontSize={10}
        overflow="ellipsis"
        maxLines={1}
      />
      <Label
        x={16}
        y={props.height - 26}
        text="Weather data by Open-Meteo · open-meteo.com · CC BY 4.0"
        color={pal.muted}
        fontSize={9}
      />
    </Surface>
  );
}
export async function main(): Promise<void> {
  const app = new Application(),
    window = new Window({ title: "Weather", appId: "org.moire.Weather", width: 860, height: 700 }),
    client = new WeatherClient(),
    cache = new WeatherCache();
  window.setContent((size) => <WeatherApp {...size} client={client} cache={cache} />);
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[weather]", error);
    process.exitCode = 1;
  });
