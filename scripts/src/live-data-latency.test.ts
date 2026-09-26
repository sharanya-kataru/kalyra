import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { generateEnrichedItinerary, enrichItineraryWithLiveData } from "../../artifacts/api-server/src/lib/live-data";
import { normalizeItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";
import { fallbackSource, liveSource } from "../../artifacts/api-server/src/lib/sources";
import type { FlightSearchResult } from "../../artifacts/api-server/src/lib/flights";

const trip: TripData = { id: "latency", destination: "Latency Base", starting_location: "Latency Origin", start_date: "2026-12-21", end_date: "2026-12-23", traveler_count: 1, budget: 1600, budget_preference: "Balance", traveler_profile: { interests: [], preferences: [], travel_style: "Balanced" } };
function environment(t: TestContext) {
  const geo = process.env.GEOAPIFY_API_KEY, ignav = process.env.IGNAV_API_KEY;
  process.env.GEOAPIFY_API_KEY = t.name; process.env.IGNAV_API_KEY = t.name;
  t.after(() => {
    if (geo === undefined) delete process.env.GEOAPIFY_API_KEY; else process.env.GEOAPIFY_API_KEY = geo;
    if (ignav === undefined) delete process.env.IGNAV_API_KEY; else process.env.IGNAV_API_KEY = ignav;
  });
}
function locationResponse() { return Response.json({ features: [{ geometry: { coordinates: [20, 10] }, properties: {} }] }); }

test("flight search starts while activity discovery is still pending", { timeout: 2000 }, async (t) => {
  environment(t);
  let release!: () => void, started!: () => void;
  const activities = new Promise<void>((resolve) => { release = resolve; });
  const flightStarted = new Promise<void>((resolve) => { started = resolve; });
  let airportQueries = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "ignav.com") { started(); return Response.json({}, { status: 400 }); }
    if (url.pathname.includes("geocode")) return locationResponse();
    if (url.searchParams.get("categories") === "airport") {
      airportQueries++;
      // Distinct origin/destination codes; repeated radius searches deduplicate.
      return Response.json({ features: [{ properties: { name: "Airport", place_id: `airport-${airportQueries <= 2 ? "first" : "second"}`, iata: airportQueries % 2 ? "AAA" : "BBB", categories: ["airport"], lat: 10, lon: 20 } }] });
    }
    if (url.pathname === "/v2/places" && !url.searchParams.get("categories")?.startsWith("catering")) await activities;
    return Response.json({ features: [] });
  });
  const generated = generateEnrichedItinerary(trip);
  try { await flightStarted; } finally { release(); }
  assert.equal((await generated).total_days, 3);
});

test("shortening reuses fresh matching weather, but stale or mismatched weather is refreshed", async (t) => {
  environment(t);
  let weatherCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    // Distinct coordinates isolate the historical provider's shared failure cache
    // from the preceding concurrency test.
    if (url.pathname.includes("geocode")) return Response.json({ features: [{ geometry: { coordinates: [21, 11] }, properties: {} }] });
    if (url.hostname.includes("open-meteo")) weatherCalls++;
    return Response.json({ features: [] });
  });
  const itinerary = normalizeItinerary({}, { ...trip, destination: "Weather reuse base" });
  for (const day of itinerary.daily_itinerary) day.weather = {
    kind: "historical", location: day.location, date: day.date, min_temperature_c: 10, max_temperature_c: 20,
    precipitation_probability: null, weather_code: null, description: "Typical conditions",
    source_metadata: liveSource("Open-Meteo", "weather", new Date().toISOString()),
  };
  const flightSearch: FlightSearchResult = { status: "unavailable", origin: "AAA", destination: "BBB",
    departure_date: trip.start_date, return_date: trip.end_date, offers: [], selected_offer: null, source_metadata: fallbackSource("flight_search") };
  const enriched = await enrichItineraryWithLiveData(itinerary, trip, { reuseWeather: true, flightSearch });
  assert.equal(weatherCalls, 0);
  assert.deepEqual(enriched.daily_itinerary.map((day) => day.weather), itinerary.daily_itinerary.map((day) => day.weather));
  itinerary.daily_itinerary[0].weather!.source_metadata.retrieved_at = "2000-01-01T00:00:00Z";
  const refreshed = await enrichItineraryWithLiveData(itinerary, trip, { reuseWeather: true, flightSearch });
  assert.ok(weatherCalls > 0, "expired metadata must consult the weather provider");
  assert.ok(refreshed.daily_itinerary.every((day) => !day.weather), "failed refresh must not retain expired weather");
  for (const mismatch of ["date", "location"] as const) {
    const changed = structuredClone(itinerary);
    for (const day of changed.daily_itinerary) day.weather!.source_metadata.retrieved_at = new Date().toISOString();
    changed.daily_itinerary[0].weather![mismatch] = "mismatched";
    const result = await enrichItineraryWithLiveData(changed, trip, { reuseWeather: true, flightSearch });
    // The recent failed provider lookup may now be cached: correctness does
    // not require another HTTP call, but mismatched data must not survive.
    assert.ok(result.daily_itinerary.every((day) => !day.weather));
  }
});
