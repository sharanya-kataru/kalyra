import type { DailyItinerary, ItineraryData } from "./ai";
import { liveSource, type DataSourceMetadata } from "./sources";

export interface ActivityPlace { name: string; location: string; lat: number; lon: number }
export type ActivityPeriod = "morning" | "afternoon" | "evening";
export interface WalkingLeg {
  from: ActivityPeriod;
  to: ActivityPeriod;
  from_place_key: string;
  to_place_key: string;
  mode: "walk";
  duration_seconds: number;
  distance_meters: number;
  source_metadata: DataSourceMetadata;
}
type Route = Pick<WalkingLeg, "duration_seconds" | "distance_meters" | "source_metadata">;
export function validPlace(value: unknown): value is ActivityPlace {
  if (!value || typeof value !== "object") return false;
  const p = value as ActivityPlace;
  return typeof p.name === "string" && typeof p.location === "string" &&
    Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
}
export const placeKey = (p: ActivityPlace) => JSON.stringify([p.name, p.location, p.lat, p.lon]);
const pairs: Array<[ActivityPeriod, ActivityPeriod]> = [["morning", "afternoon"], ["afternoon", "evening"]];
// Conservative suggestion threshold: at most 45 minutes AND 3 km. Longer
// routes keep the generic transportation fallback, without inventing alternatives.
export function sensibleWalk(route: Pick<Route, "duration_seconds" | "distance_meters">): boolean {
  return Number.isFinite(route.duration_seconds) && route.duration_seconds > 0 && route.duration_seconds <= 2700 &&
    Number.isFinite(route.distance_meters) && route.distance_meters > 0 && route.distance_meters <= 3000;
}
export function cleanWalkingData(day: DailyItinerary): DailyItinerary {
  const updated = { ...day };
  for (const period of ["morning", "afternoon", "evening"] as const) {
    const activity = day[period];
    const place = activity.place;
    updated[period] = { ...activity };
    if (!validPlace(place) || place.name !== activity.activity || place.location !== day.location) delete updated[period].place;
  }
  updated.walking_legs = (Array.isArray(day.walking_legs) ? day.walking_legs : []).filter((leg) => {
    if (!leg || leg.mode !== "walk" || !pairs.some(([from, to]) => leg.from === from && leg.to === to) || !sensibleWalk(leg)) return false;
    const from = updated[leg.from].place;
    const to = updated[leg.to].place;
    return from && to && leg.from_place_key === placeKey(from) && leg.to_place_key === placeKey(to);
  });
  return updated;
}

// The production instance below owns a bounded module-level cache.
export function createWalkingRouter(request: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { expires: number; result: Route | null }>();
  const inFlight = new Map<string, Promise<Route | null>>();
  return async (from: ActivityPlace, to: ActivityPlace): Promise<Route | null> => {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey || !validPlace(from) || !validPlace(to)) return null;
    const key = JSON.stringify(["Geoapify", "walk", "metric", from.lat, from.lon, to.lat, to.lon]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.result;
    if (inFlight.has(key)) return inFlight.get(key)!;
    if (inFlight.size >= 100) return null;
    const pending = (async () => {
      let result: Route | null = null;
      try {
        const url = new URL("https://api.geoapify.com/v1/routing");
        url.searchParams.set("waypoints", `${from.lat},${from.lon}|${to.lat},${to.lon}`);
        url.searchParams.set("mode", "walk");
        url.searchParams.set("units", "metric");
        url.searchParams.set("apiKey", apiKey);
        const response = await request(url, { signal: AbortSignal.timeout(3500) });
        if (response.ok) {
          const body = await response.json() as {
            features?: Array<{ properties?: { mode?: unknown; distance_units?: unknown; time?: unknown; distance?: unknown; ferry?: unknown } }>;
          };
          const p = body?.features?.[0]?.properties;
          if (p?.mode === "walk" && typeof p.distance_units === "string" && p.distance_units.toLowerCase() === "meters" &&
              typeof p.distance === "number" && Number.isFinite(p.distance) && p.distance >= 0 &&
              typeof p.time === "number" && Number.isFinite(p.time) && p.time >= 0 && p.ferry !== true) {
            result = { distance_meters: p.distance, duration_seconds: p.time,
              source_metadata: liveSource("Geoapify", "walking_route", new Date(now()).toISOString()) };
          }
        }
      } catch { /* Keep the existing transport fallback. */ }
      cache.delete(key);
      cache.set(key, { result, expires: now() + (result ? 86_400_000 : 60_000) });
      while (cache.size > 500) cache.delete(cache.keys().next().value!);
      return result;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  };
}
const searchWalkingRoute = createWalkingRouter();

export async function enrichWalkingLegs(itinerary: ItineraryData, search = searchWalkingRoute, deadlineMs = 3500): Promise<ItineraryData> {
  const days = itinerary.daily_itinerary.map(cleanWalkingData).map((day) => ({ ...day, walking_legs: [] as WalkingLeg[] }));
  const jobs = days.flatMap((day) => pairs.flatMap(([from, to]) => {
    const a = day[from].place;
    const b = day[to].place;
    return a && b ? [{ day, from, to, a, b }] : [];
  }));
  let cursor = 0;
  let active = true;
  const end = performance.now() + deadlineMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const worker = async () => {
    while (active && performance.now() < end && cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const route = await search(job.a, job.b);
        if (active && performance.now() < end && route && sensibleWalk(route)) job.day.walking_legs.push({
          ...route, from: job.from, to: job.to, from_place_key: placeKey(job.a), to_place_key: placeKey(job.b), mode: "walk",
        });
      } catch { /* One failure cannot fail the trip. */ }
    }
  };
  try {
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker)),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlineMs); }),
    ]);
  } finally { active = false; clearTimeout(timer); }
  for (const day of days) day.walking_legs.sort((a, b) => a.from === b.from ? 0 : a.from === "morning" ? -1 : 1);
  return { ...itinerary, daily_itinerary: days };
}
