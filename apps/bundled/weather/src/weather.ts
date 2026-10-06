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
export type Forecast = {
  fetchedAt: number;
  timeZone: string;
  time: string;
  temperature: number;
  feelsLike: number;
  wind: number;
  code: number;
  days: Array<{ date: string; min: number; max: number; rain: number; code: number }>;
};
export type CachedPlace = { place: Place; forecast: Forecast };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Weather service returned an invalid response.");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Weather service returned invalid text.");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Weather service returned an invalid measurement.");
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Weather service returned an invalid forecast.");
  return value;
}
export function parsePlace(value: unknown): Place {
  const item = record(value),
    latitude = number(item.latitude),
    longitude = number(item.longitude);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    throw new Error("Weather service returned invalid coordinates.");
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
export function parseForecast(value: unknown, fetchedAt = Date.now()): Forecast {
  const item = record(value),
    current = record(item.current),
    daily = record(item.daily),
    dates = list(daily.time),
    min = list(daily.temperature_2m_min),
    max = list(daily.temperature_2m_max),
    rain = list(daily.precipitation_probability_max),
    codes = list(daily.weather_code);
  if (
    [min, max, rain, codes].some((values) => values.length !== dates.length) ||
    dates.length === 0
  )
    throw new Error("Forecast daily measurements do not align.");
  return {
    fetchedAt,
    timeZone: text(item.timezone),
    time: text(current.time),
    temperature: number(current.temperature_2m),
    feelsLike: number(current.apparent_temperature),
    wind: number(current.wind_speed_10m),
    code: number(current.weather_code),
    days: dates.map((date, index) => ({
      date: text(date),
      min: number(min[index]),
      max: number(max[index]),
      rain: number(rain[index]),
      code: number(codes[index]),
    })),
  };
}
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
export class WeatherClient {
  constructor(
    private readonly options: {
      forecastURL?: string;
      geocodingURL?: string;
      now?: () => number;
    } = {},
  ) {}
  private async request(url: URL, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(`Weather service returned HTTP ${response.status}. Try again later.`);
    return response.json();
  }
  async search(query: string, signal?: AbortSignal): Promise<Place[]> {
    if (query.trim().length < 2) throw new Error("Enter at least two letters of a place name.");
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
