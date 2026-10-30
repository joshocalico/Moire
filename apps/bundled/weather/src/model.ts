/**
 * Weather's state and transitions, as pure functions: saved places, the selected place's sync
 * state, location search, display units and how stored metric measurements read in them.
 */
import { formatTimeAgo } from "@moire/app-tools";
import {
  WeatherError,
  type CachedPlace,
  type Forecast,
  type Hour,
  type Place,
  type WeatherErrorKind,
} from "./weather";

export const APP_ID = "org.moire.Weather";
/** A saved forecast younger than this is shown as is, without asking the network again. */
const REUSE_FOR_MS = 15 * 60_000;
/** A saved forecast older than this is marked out of date. */
export const STALE_AFTER_MS = 3 * 60 * 60_000;
const SAVED_PLACES = 8;

// Units ----------------------------------------------------------------------------------------

export type TemperatureUnit = "celsius" | "fahrenheit";
export type WindUnit = "kmh" | "mph";
export type Units = { temperature: TemperatureUnit; wind: WindUnit };
export const DEFAULT_UNITS: Units = { temperature: "celsius", wind: "kmh" };

/** Validate stored preferences, falling back per field so one bad value keeps the other. */
export function parseUnits(data: unknown): Units {
  const item = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  return {
    temperature: item.temperature === "fahrenheit" ? "fahrenheit" : "celsius",
    wind: item.wind === "mph" ? "mph" : "kmh",
  };
}

const celsiusToFahrenheit = (celsius: number): number => (celsius * 9) / 5 + 32;
const kmhToMph = (kmh: number): number => kmh / 1.609344;

/** A stored °C reading in the viewer's unit, rounded: "21°" or "70°". */
export function formatTemperature(celsius: number, units: Units): string {
  const value = units.temperature === "fahrenheit" ? celsiusToFahrenheit(celsius) : celsius;
  // Avoid "-0°" for readings just below zero.
  return `${Math.round(value) || 0}°`;
}

/** A stored km/h wind speed in the viewer's unit: "11 km/h" or "7 mph". */
export function formatWind(kmh: number, units: Units): string {
  return units.wind === "mph" ? `${Math.round(kmhToMph(kmh))} mph` : `${Math.round(kmh)} km/h`;
}

// Forecast reading -----------------------------------------------------------------------------

export function weatherLabel(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Weather conditions unavailable";
}

export const isStale = (forecast: Forecast, now: number): boolean =>
  now - forecast.fetchedAt > STALE_AFTER_MS;

export const today = (forecast: Forecast) =>
  forecast.days.find((day) => day.date === forecast.time.slice(0, 10));

/** Every `step` hours from the forecast's current hour: the hourly strip's columns. */
export function hourlySlots(forecast: Forecast, step = 3, count = 8): Hour[] {
  return (forecast.hours ?? []).filter((_, index) => index % step === 0).slice(0, count);
}

/** "3 PM" (or "15" in 24-hour locales) for a local ISO time, without shifting time zones. */
export function hourLabel(time: string): string {
  const hour = Number(time.slice(11, 13));
  return new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(undefined, {
    hour: "numeric",
    timeZone: "UTC",
  });
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// State ----------------------------------------------------------------------------------------

/** A failure the UI shows; `storage` is the local cache, the rest come from the backend. */
export type Failure = { kind: WeatherErrorKind | "storage"; message: string };

export function failureOf(error: unknown): Failure {
  if (error instanceof WeatherError) return { kind: error.kind, message: error.message };
  return {
    kind: "invalid",
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Where the selected place's forecast stands with the network. */
export type Sync =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "updated" }
  /** The refresh failed; the saved forecast is still shown. */
  | { kind: "offline"; failure: Failure }
  /** The refresh failed and there is nothing saved to show. */
  | { kind: "unavailable"; failure: Failure };

export type Search =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; places: Place[] }
  | { kind: "failed"; failure: Failure };

export type WeatherState = {
  entries: CachedPlace[];
  selected: Place | null;
  sync: Sync;
  search: Search;
  /** A message that outranks the usual status, such as a cache that could not be saved. */
  notice: Failure | null;
};

export type Action =
  | { type: "select"; place: Place }
  | { type: "load-started" }
  | { type: "load-finished"; place: Place; forecast: Forecast }
  | { type: "load-failed"; failure: Failure }
  | { type: "search-started" }
  | { type: "search-finished"; places: Place[] }
  | { type: "search-failed"; failure: Failure }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "notice"; failure: Failure | null };

export function initialState(entries: CachedPlace[], notice: Failure | null = null): WeatherState {
  return {
    entries,
    selected: entries[0]?.place ?? null,
    sync: { kind: "idle" },
    search: { kind: "idle" },
    notice,
  };
}

export function reduce(state: WeatherState, action: Action): WeatherState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selected: action.place,
        sync: { kind: "idle" },
        search: { kind: "idle" },
        notice: null,
      };
    case "load-started":
      return { ...state, sync: { kind: "loading" } };
    case "load-finished":
      return {
        ...state,
        entries: [
          { place: action.place, forecast: action.forecast },
          ...state.entries.filter((entry) => entry.place.id !== action.place.id),
        ].slice(0, SAVED_PLACES),
        sync: { kind: "updated" },
      };
    case "load-failed":
      return {
        ...state,
        sync: selectedForecast(state)
          ? { kind: "offline", failure: action.failure }
          : { kind: "unavailable", failure: action.failure },
      };
    case "search-started":
      return { ...state, search: { kind: "searching" } };
    case "search-finished":
      return { ...state, search: { kind: "results", places: action.places } };
    case "search-failed":
      return { ...state, search: { kind: "failed", failure: action.failure } };
    case "remove": {
      const entries = state.entries.filter((entry) => entry.place.id !== action.id);
      if (state.selected?.id !== action.id) return { ...state, entries };
      return {
        ...state,
        entries,
        selected: entries[0]?.place ?? null,
        sync: { kind: "idle" },
      };
    }
    case "clear":
      return { ...state, entries: [], sync: { kind: "idle" }, notice: null };
    case "notice":
      return { ...state, notice: action.failure };
  }
}

export function selectedForecast(state: WeatherState): Forecast | null {
  const id = state.selected?.id;
  return state.entries.find((entry) => entry.place.id === id)?.forecast ?? null;
}

/** Whether opening a place should ask the network: no saved forecast, or one past reuse. */
export function needsRefresh(forecast: Forecast | null, now: number): boolean {
  return !forecast || now - forecast.fetchedAt >= REUSE_FOR_MS;
}

/** The status line: what is happening now, or how fresh the forecast on screen is. */
export function statusText(state: WeatherState, now: number): string {
  if (state.notice) return state.notice.message;
  if (state.search.kind === "searching") return "Searching for places…";
  if (state.search.kind === "failed")
    return `Location search unavailable: ${state.search.failure.message}`;
  if (state.search.kind === "results")
    return state.search.places.length
      ? "Choose a location from the results"
      : "No locations matched. Try a nearby city.";
  const forecast = selectedForecast(state);
  switch (state.sync.kind) {
    case "loading":
      return `Updating ${state.selected?.name ?? "forecast"}…`;
    case "unavailable":
      return `Forecast unavailable: ${state.sync.failure.message}`;
    case "offline":
      return forecast
        ? `Offline · showing the forecast from ${formatTimeAgo(forecast.fetchedAt, now)}`
        : state.sync.failure.message;
  }
  if (!forecast) return "Search for a city to see its weather";
  return `Updated ${formatTimeAgo(forecast.fetchedAt, now)} · ${forecast.timeZone}`;
}

/** The notice above an old or offline forecast, or null while it is current. */
export function freshness(
  state: WeatherState,
  now: number,
): { title: string; message: string } | null {
  const forecast = selectedForecast(state);
  if (!forecast || state.sync.kind === "loading") return null;
  const age = `Last updated ${formatTimeAgo(forecast.fetchedAt, now)}.`;
  if (state.sync.kind === "offline")
    return {
      title: "Offline · showing the saved forecast",
      message: `${age} ${state.sync.failure.message}`,
    };
  if (isStale(forecast, now))
    return {
      title: "This forecast is out of date",
      message: `${age} Refresh for the latest.`,
    };
  return null;
}
