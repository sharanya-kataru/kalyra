import type { ItineraryData, TripData } from "./ai";
import { resolveLocation } from "./places";
import { getWeatherForecast, type WeatherSummary } from "./weather";

// Transient marker, never serialized: initial enrichment reuses even failed
// weather attempts. A saved itinerary's explicit refresh still fetches normally.
const prepared = new WeakSet<ItineraryData>();
export const hasPreparedWeather = (itinerary: ItineraryData) => prepared.has(itinerary);
export function markWeatherPrepared(itinerary: ItineraryData): ItineraryData {
  prepared.add(itinerary);
  return itinerary;
}
export async function prepareItineraryWeather(itinerary: ItineraryData, trip: TripData): Promise<ItineraryData> {
  const entries: WeatherSummary[][] = [];
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const jobs = Promise.all([...new Set(itinerary.daily_itinerary.map((day) => day.location))].map(async (location) => {
    try {
      const context = itinerary.route.find((stop) => stop.location === location)?.country || trip.destination;
      const query = location.includes(",") || location.toLowerCase() === context.toLowerCase() ? location : `${location}, ${context}`;
      const resolved = await resolveLocation(query);
      if (!resolved) return [];
      const dates = itinerary.daily_itinerary.filter((day) => day.location === location).map((day) => day.date).sort();
      const result = await getWeatherForecast({ location, latitude: resolved.lat, longitude: resolved.lon,
        start_date: dates[0], end_date: dates.at(-1)! });
      if (active) entries.push(result.summaries);
      return result.summaries;
    } catch { return []; }
  }));
  // Bound the extra pre-selection stage, accepting partial success. Late
  // responses may warm caches but cannot mutate the generated itinerary.
  try {
    await Promise.race([jobs, new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); })]);
  } finally { active = false; clearTimeout(timer); }
  const weather = new Map(entries.flat().map((summary) => [`${summary.location}|${summary.date}`, summary]));
  return { ...itinerary, daily_itinerary: itinerary.daily_itinerary.map((day) => ({ ...day,
    weather: weather.get(`${day.location}|${day.date}`) })) };
}
