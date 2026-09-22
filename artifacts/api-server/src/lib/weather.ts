import { logger } from "./logger";
import {
  fallbackSource,
  liveSource,
  type DataSourceMetadata,
} from "./sources";

export interface WeatherSearchInput {
  location: string;
  latitude: number;
  longitude: number;
  start_date: string;
  end_date: string;
}

export interface WeatherSummary {
  location: string;
  date: string;
  min_temperature_c: number;
  max_temperature_c: number;
  precipitation_probability: number | null;
  weather_code: number;
  description: string;
  source_metadata: DataSourceMetadata;
}

export interface WeatherSearchResult {
  status: "live_forecast" | "unavailable";
  location: string;
  summaries: WeatherSummary[];
  source_metadata: DataSourceMetadata;
  message?: string;
}

export interface WeatherProvider {
  get_forecast(input: WeatherSearchInput): Promise<WeatherSearchResult>;
}

const FORECAST_DAYS = 16;
const CACHE_TTL_MS = 60 * 60 * 1000;
const weatherCache = new Map<string, { expiresAt: number; result: WeatherSearchResult }>();

type OpenMeteoResponse = {
  latitude?: unknown;
  longitude?: unknown;
  daily?: {
    time?: unknown;
    temperature_2m_min?: unknown;
    temperature_2m_max?: unknown;
    precipitation_probability_max?: unknown;
    weather_code?: unknown;
  };
};

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateOnly(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isForecastWindow(input: WeatherSearchInput): boolean {
  const today = dateOnly(new Date());
  return input.start_date >= today && input.end_date <= addDays(today, FORECAST_DAYS);
}

function weatherDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return `Weather code ${code}`;
}

function unavailable(input: WeatherSearchInput, message: string): WeatherSearchResult {
  return {
    status: "unavailable",
    location: input.location,
    summaries: [],
    source_metadata: fallbackSource("weather_forecast"),
    message,
  };
}

class OpenMeteoWeatherProvider implements WeatherProvider {
  private readonly baseUrl = "https://api.open-meteo.com/v1/forecast";

  async get_forecast(input: WeatherSearchInput): Promise<WeatherSearchResult> {
    if (!isForecastWindow(input)) {
      return unavailable(input, "Weather forecast will become available closer to your trip.");
    }

    const cacheKey = JSON.stringify(input);
    const cached = weatherCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info({ provider: "Open-Meteo", requestType: "daily_forecast", cache: "hit", resultCount: cached.result.summaries.length }, "Weather cache hit");
      return cached.result;
    }

    const startedAt = Date.now();
    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set("latitude", String(input.latitude));
      url.searchParams.set("longitude", String(input.longitude));
      url.searchParams.set("start_date", input.start_date);
      url.searchParams.set("end_date", input.end_date);
      url.searchParams.set("daily", "temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code");
      url.searchParams.set("timezone", "auto");

      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        logger.warn({ provider: "Open-Meteo", requestType: "daily_forecast", statusCode: response.status, latencyMs: Date.now() - startedAt }, "Weather provider unavailable");
        return unavailable(input, "Weather information couldn't be loaded right now. Your itinerary is still available.");
      }

      const body = (await response.json()) as OpenMeteoResponse;
      const daily = body.daily;
      const times = Array.isArray(daily?.time) ? daily.time : [];
      const mins = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
      const maxes = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
      const precipitation = Array.isArray(daily?.precipitation_probability_max) ? daily.precipitation_probability_max : [];
      const codes = Array.isArray(daily?.weather_code) ? daily.weather_code : [];
      const retrievedAt = new Date().toISOString();
      const sourceMetadata = liveSource("Open-Meteo", "weather_forecast", retrievedAt);
      const summaries = times
        .map((date, index): WeatherSummary | null => {
          if (typeof date !== "string") return null;
          const min = mins[index];
          const max = maxes[index];
          const code = codes[index];
          if (!isFiniteNumber(min) || !isFiniteNumber(max) || !isFiniteNumber(code)) return null;
          const probability = precipitation[index];
          return {
            location: input.location,
            date,
            min_temperature_c: Math.round(min * 10) / 10,
            max_temperature_c: Math.round(max * 10) / 10,
            precipitation_probability: isFiniteNumber(probability) ? Math.round(probability) : null,
            weather_code: Math.round(code),
            description: weatherDescription(Math.round(code)),
            source_metadata: sourceMetadata,
          };
        })
        .filter((summary): summary is WeatherSummary => summary !== null);

      if (summaries.length === 0) {
        logger.info({ provider: "Open-Meteo", requestType: "daily_forecast", cache: "miss", resultCount: 0, latencyMs: Date.now() - startedAt }, "Weather provider returned no usable forecast");
        return unavailable(input, "Weather information couldn't be loaded right now. Your itinerary is still available.");
      }

      const result: WeatherSearchResult = {
        status: "live_forecast",
        location: input.location,
        summaries,
        source_metadata: sourceMetadata,
      };
      weatherCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      logger.info({ provider: "Open-Meteo", requestType: "daily_forecast", cache: "miss", resultCount: summaries.length, latencyMs: Date.now() - startedAt }, "Weather forecast completed");
      return result;
    } catch {
      logger.warn({ provider: "Open-Meteo", requestType: "daily_forecast", latencyMs: Date.now() - startedAt }, "Weather provider request failed");
      return unavailable(input, "Weather information couldn't be loaded right now. Your itinerary is still available.");
    }
  }
}

export function getWeatherProvider(): WeatherProvider {
  return new OpenMeteoWeatherProvider();
}

export async function getWeatherForecast(input: WeatherSearchInput): Promise<WeatherSearchResult> {
  return getWeatherProvider().get_forecast(input);
}