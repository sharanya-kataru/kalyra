import type { WeatherSearchInput, WeatherSummary } from "./weather";
import type { DataSourceMetadata } from "./sources";

type Daily = { time?: unknown[]; temperature_2m_min?: unknown[]; temperature_2m_max?: unknown[]; precipitation_sum?: unknown[] };
type Monthly = { month: number; min: number; max: number; wet: number; sample: number };
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
/** Five complete calendar years of ERA5 reanalysis, not a 30-year climate normal.
 * A wet day means >=1 mm total precipitation. Require >=90% valid days in
 * every sampled month/year, preventing sparse samples from masquerading as typical.
 */
export function aggregateHistorical(daily: Daily, firstYear: number, lastYear: number): Monthly[] {
  const rows = new Map<string, { min: number; max: number; wet: number }>();
  for (const [i, date] of (daily.time ?? []).entries()) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;
    const year = parsed.getUTCFullYear();
    const min = daily.temperature_2m_min?.[i], max = daily.temperature_2m_max?.[i], rain = daily.precipitation_sum?.[i];
    if (year < firstYear || year > lastYear || !finite(min) || !finite(max) || min > max || !finite(rain) || rain < 0) continue;
    if (!rows.has(date)) rows.set(date, { min, max, wet: Number(rain >= 1) });
  }
  return Array.from({ length: 12 }, (_, i) => i + 1).flatMap((month) => {
    const selected = [...rows].filter(([date]) => Number(date.slice(5, 7)) === month).sort(([a], [b]) => a.localeCompare(b));
    for (let year = firstYear; year <= lastYear; year++) {
      const count = selected.filter(([date]) => Number(date.slice(0, 4)) === year).length;
      if (count < Math.ceil(new Date(Date.UTC(year, month, 0)).getUTCDate() * 0.9)) return [];
    }
    const mean = (key: "min" | "max" | "wet") => selected.reduce((sum, [, row]) => sum + row[key], 0) / selected.length;
    return [{ month, min: Math.round(mean("min") * 10) / 10, max: Math.round(mean("max") * 10) / 10,
      wet: Math.round(mean("wet") * 100), sample: selected.length }];
  });
}

// Bounded, shared cache of all monthly aggregates per coordinate/window; no
// per-activity or per-future-day archive requests. Failures cached for one minute.
export function createHistoricalWeather(request: typeof fetch = (...args) => fetch(...args), now = Date.now) {
  const cache = new Map<string, { expires: number; months: Monthly[]; source: DataSourceMetadata }>();
  const pending = new Map<string, Promise<{ months: Monthly[]; source: DataSourceMetadata }>>();
  return async (input: WeatherSearchInput, dates: string[]): Promise<WeatherSummary[]> => {
    // Seven-day lag also avoids asking ERA5 for an incompletely published December.
    const lastYear = new Date(now() - 7 * 86400000).getUTCFullYear() - 1;
    const firstYear = lastYear - 4;
    const key = JSON.stringify([input.latitude, input.longitude, firstYear, lastYear, "era5"]);
    const cached = cache.get(key);
    let result = cached && cached.expires > now() ? cached : undefined;
    if (!result) {
      if (!pending.has(key)) {
        if (pending.size >= 4) return [];
        const job = (async () => {
          const source: DataSourceMetadata = { provider: "Open-Meteo", data_type: "historical_weather",
            retrieved_at: new Date(now()).toISOString(), freshness: `${firstYear}–${lastYear} ERA5 monthly sample`, is_live: false, label: "HISTORICAL" };
          let months: Monthly[] = [];
          try {
            const url = new URL("https://archive-api.open-meteo.com/v1/archive");
            for (const [name, value] of Object.entries({ latitude: input.latitude, longitude: input.longitude,
              start_date: `${firstYear}-01-01`, end_date: `${lastYear}-12-31`, models: "era5", timezone: "auto",
              daily: "temperature_2m_min,temperature_2m_max,precipitation_sum" })) url.searchParams.set(name, String(value));
            const response = await request(url, { signal: AbortSignal.timeout(4000) });
            if (response.ok) {
              const body = await response.json() as { daily?: Daily };
              if (Array.isArray(body.daily?.time)) months = aggregateHistorical(body.daily!, firstYear, lastYear);
            }
          } catch { /* No invented seasonal temperatures if the archive fails. */ }
          const value = { months, source };
          cache.delete(key);
          cache.set(key, { ...value, expires: now() + (months.length ? 86400000 : 60000) });
          while (cache.size > 128) cache.delete(cache.keys().next().value!);
          return value;
        })();
        pending.set(key, job);
      }
      try { result = { ...await pending.get(key)!, expires: 0 }; } finally { pending.delete(key); }
    }
    return dates.flatMap((date) => {
      const month = result!.months.find((m) => m.month === Number(date.slice(5, 7)));
      return month ? [{ location: input.location, date, kind: "historical" as const,
        min_temperature_c: month.min, max_temperature_c: month.max,
        precipitation_probability: null, weather_code: null,
        historical_wet_day_frequency: month.wet, historical_sample_days: month.sample,
        historical_period: `${firstYear}–${lastYear}`,
        description: "Monthly average daily low/high", source_metadata: result!.source }] : [];
    });
  };
}
export const getHistoricalWeather = createHistoricalWeather();
