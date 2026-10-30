/**
 * Weather backend: Open-Meteo geocoding and forecasts, and the on-disk cache of saved places.
 * Measurements stay metric (°C, km/h) here; the model converts them for display, so the cache
 * never depends on the viewer's units.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type Place = {
  id: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  timeZone: string;
};
export type Day = {
  date: string;
  min: number;
  max: number;
  rain: number;
  code: number;
};
/** One hour of today's forecast; `time` is the place's local time, as Open-Meteo gives it. */
export type Hour = {
  time: string;
  temperature: number;
  rain: number;
  code: number;
};
export type Forecast = {
  fetchedAt: number;
  timeZone: string;
  time: string;
  temperature: number;
  feelsLike: number;
  wind: number;
  code: number;
  days: Day[];
  /** Absent in caches written before hourly forecasts were fetched. */
  hours?: Hour[];
};
export type CachedPlace = { place: Place; forecast: Forecast };

/** Why a request failed, so the UI can say what to do about it. */
export type WeatherErrorKind = "network" | "http" | "invalid" | "query";
export class WeatherError extends Error {
  constructor(
    readonly kind: WeatherErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "WeatherError";
  }
}

/** Hours of the hourly forecast kept from the current hour on. */
const HOURS_KEPT = 24;
const REQUEST_TIMEOUT_MS = 10_000;

function invalid(what: string): WeatherError {
  return new WeatherError("invalid", `Weather service returned ${what}.`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalid("an invalid response");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw invalid("invalid text");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid("an invalid measurement");
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalid("an invalid forecast");
  return value;
}
/** Parallel measurement arrays, checked to line up with `times`. */
function columns(times: unknown[], ...values: unknown[]): unknown[][] {
  const lists = values.map(list);
  if (times.length === 0 || lists.some((column) => column.length !== times.length))
    throw invalid("forecast measurements that do not align");
  return lists;
}

function parsePlace(value: unknown): Place {
  const item = record(value),
    latitude = number(item.latitude),
    longitude = number(item.longitude);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    throw invalid("invalid coordinates");
  return {
    id: String(item.id ?? `${latitude},${longitude}`),
    name: text(item.name),
    country: typeof item.country === "string" ? item.country : "",
    latitude,
    longitude,
    timeZone:
      typeof item.timezone === "string"
        ? item.timezone
        : typeof item.timeZone === "string"
          ? item.timeZone
          : "UTC",
  };
}

function parseHours(hourly: unknown, now: string): Hour[] {
  const item = record(hourly),
    times = list(item.time);
  const [temperatures, rain, codes] = columns(
    times,
    item.temperature_2m,
    item.precipitation_probability,
    item.weather_code,
  );
  // Local ISO times sort as strings; "2026-10-02T12" matches every minute of that hour.
  const hour = now.slice(0, 13);
  const first = times.findIndex((time) => text(time) >= hour);
  if (first < 0) return [];
  return times.slice(first, first + HOURS_KEPT).map((time, offset) => ({
    time: text(time),
    temperature: number(temperatures![first + offset]),
    // Open-Meteo leaves the chance of rain null beyond its model's horizon.
    rain: rain![first + offset] === null ? 0 : number(rain![first + offset]),
    code: number(codes![first + offset]),
  }));
}

export function parseForecast(value: unknown, fetchedAt = Date.now()): Forecast {
  const item = record(value),
    current = record(item.current),
    daily = record(item.daily),
    dates = list(daily.time);
  const [min, max, rain, codes] = columns(
    dates,
    daily.temperature_2m_min,
    daily.temperature_2m_max,
    daily.precipitation_probability_max,
    daily.weather_code,
  );
  const time = text(current.time);
  return {
    fetchedAt,
    timeZone: text(item.timezone),
    time,
    temperature: number(current.temperature_2m),
    feelsLike: number(current.apparent_temperature),
    wind: number(current.wind_speed_10m),
    code: number(current.weather_code),
    days: dates.map((date, index) => ({
      date: text(date),
      min: number(min![index]),
      max: number(max![index]),
      rain: number(rain![index]),
      code: number(codes![index]),
    })),
    ...(item.hourly === undefined ? {} : { hours: parseHours(item.hourly, time) }),
  };
}

type WeatherClientOptions = {
  forecastURL?: string;
  geocodingURL?: string;
  now?: () => number;
};
export class WeatherClient {
  constructor(private readonly options: WeatherClientOptions = {}) {}
  private async request(url: URL, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      // A caller's abort is not a failure to report; let it through unchanged.
      if (signal?.aborted) throw error;
      throw new WeatherError(
        "network",
        timeout.aborted
          ? "The weather service did not answer in time."
          : "Can't reach the weather service. Check your connection.",
      );
    }
    if (!response.ok)
      throw new WeatherError(
        "http",
        `Weather service returned HTTP ${response.status}. Try again later.`,
      );
    try {
      return await response.json();
    } catch {
      throw invalid("a response that is not JSON");
    }
  }
  async search(query: string, signal?: AbortSignal): Promise<Place[]> {
    if (query.trim().length < 2)
      throw new WeatherError("query", "Enter at least two letters of a place name.");
    const url = new URL(
      this.options.geocodingURL ?? "https://geocoding-api.open-meteo.com/v1/search",
    );
    url.search = new URLSearchParams({
      name: query.trim(),
      count: "8",
      language: "en",
      format: "json",
    }).toString();
    const response = record(await this.request(url, signal));
    if (response.results === undefined) return [];
    return list(response.results).map(parsePlace);
  }
  async forecast(place: Place, signal?: AbortSignal): Promise<Forecast> {
    const url = new URL(this.options.forecastURL ?? "https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      timezone: "auto",
      current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
      hourly: "temperature_2m,precipitation_probability,weather_code",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      forecast_days: "7",
    }).toString();
    return parseForecast(await this.request(url, signal), (this.options.now ?? Date.now)());
  }
}

function parseCached(value: unknown): CachedPlace {
  const item = record(value),
    place = parsePlace(item.place),
    f = record(item.forecast);
  return {
    place,
    forecast: {
      fetchedAt: number(f.fetchedAt),
      timeZone: text(f.timeZone),
      time: text(f.time),
      temperature: number(f.temperature),
      feelsLike: number(f.feelsLike),
      wind: number(f.wind),
      code: number(f.code),
      days: list(f.days).map((value) => {
        const day = record(value);
        return {
          date: text(day.date),
          min: number(day.min),
          max: number(day.max),
          rain: number(day.rain),
          code: number(day.code),
        };
      }),
      ...(f.hours === undefined
        ? {}
        : {
            hours: list(f.hours).map((value) => {
              const hour = record(value);
              return {
                time: text(hour.time),
                temperature: number(hour.temperature),
                rain: number(hour.rain),
                code: number(hour.code),
              };
            }),
          }),
    },
  };
}

export class WeatherCache {
  constructor(
    readonly file = path.join(
      process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      "moire/weather/places.json",
    ),
  ) {}
  read(): CachedPlace[] {
    if (!fs.existsSync(this.file)) return [];
    const data: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
    return list(data).map(parseCached);
  }
  write(entries: readonly CachedPlace[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(entries) + "\n", { mode: 0o600 });
      fs.renameSync(temp, this.file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}
