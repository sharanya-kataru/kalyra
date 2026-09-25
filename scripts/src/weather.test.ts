import assert from "node:assert/strict";
import test from "node:test";
import { aggregateHistorical, createHistoricalWeather } from "../../artifacts/api-server/src/lib/historical-weather";
import { getWeatherForecast, type WeatherSummary } from "../../artifacts/api-server/src/lib/weather";
import { scoreActivity } from "../../artifacts/api-server/src/lib/activity-optimizer";
import { generateItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";
import { enrichItineraryWithLiveData } from "../../artifacts/api-server/src/lib/live-data";
import { weatherPresentation } from "../../artifacts/travel-optimizer/src/lib/weather-label";
import { liveSource } from "../../artifacts/api-server/src/lib/sources";

const date = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
function history(first = 2021, last = 2025, months = [1]) {
  const time: string[] = [];
  for (let year = first; year <= last; year++) for (const month of months)
    for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day++)
      time.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  return { time, temperature_2m_min: time.map(() => 10), temperature_2m_max: time.map(() => 20), precipitation_sum: time.map(() => 2) };
}
const input = { location: "Weather test base", latitude: 1, longitude: 2, start_date: date(1), end_date: date(2) };

test("historical aggregation is deterministic, month-specific, and rejects sparse data", () => {
  const daily = history();
  assert.deepEqual(aggregateHistorical(daily, 2021, 2025), [{ month: 1, min: 10, max: 20, wet: 100, sample: 155 }]);
  assert.deepEqual(aggregateHistorical({ ...daily, time: [...daily.time].reverse() }, 2021, 2025), aggregateHistorical(daily, 2021, 2025));
  assert.deepEqual(aggregateHistorical({ ...daily, time: daily.time.slice(0, 5) }, 2021, 2025), []);
});

test("archive request/cache deduplicates concurrent requests; historical data is never a forecast", async () => {
  let calls = 0;
  const provider = createHistoricalWeather(async (url) => {
    calls++;
    const request = new URL(String(url));
    assert.equal(request.origin + request.pathname, "https://archive-api.open-meteo.com/v1/archive");
    assert.equal(request.searchParams.get("models"), "era5");
    assert.equal(request.searchParams.get("start_date"), "2021-01-01");
    assert.equal(request.searchParams.get("end_date"), "2025-12-31");
    assert.equal(request.searchParams.get("daily"), "temperature_2m_min,temperature_2m_max,precipitation_sum");
    return Response.json({ daily: history() });
  }, () => Date.parse("2026-09-01T00:00:00Z"));
  const [a, b] = await Promise.all([provider(input, ["2027-01-01"]), provider(input, ["2028-01-02"])]);
  assert.equal(calls, 1);
  assert.equal(a[0].kind, "historical");
  assert.equal(a[0].source_metadata.is_live, false);
  assert.equal(a[0].source_metadata.label, "HISTORICAL");
  assert.equal(a[0].weather_code, null);
  assert.equal(a[0].precipitation_probability, null);
  assert.equal(b[0].historical_wet_day_frequency, 100);
  await provider(input, ["2029-01-01"]);
  assert.equal(calls, 1);
  const presentation = weatherPresentation({ ...a[0], precipitation_probability: 99 });
  assert.equal(presentation.title, "Typical conditions");
  assert.match(presentation.qualifier, /not a forecast/);
  assert.doesNotMatch(presentation.precipitation, /chance|99/);
});

test("in-range uses live forecast; out-of-range uses archive; unavailable stays empty", async () => {
  const old = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = async (url) => {
    const request = new URL(String(url)); hosts.push(request.hostname);
    if (request.hostname === "archive-api.open-meteo.com") {
      const first = Number(request.searchParams.get("start_date")!.slice(0, 4));
      return Response.json({ daily: history(first, first + 4) });
    }
    return Response.json({ daily: { time: [date(1), date(2)], temperature_2m_min: [10, 12], temperature_2m_max: [20, 22],
      precipitation_probability_max: [80, 90], weather_code: [63, 63] } });
  };
  try {
    const live = await getWeatherForecast(input);
    assert.equal(live.status, "live_forecast");
    assert.equal(live.summaries[0].precipitation_probability, 80);
    assert.equal(live.summaries[0].source_metadata.is_live, true);
    assert.equal(weatherPresentation(live.summaries[0]).title, "Forecast");
    const year = new Date().getUTCFullYear() + 1;
    const typical = await getWeatherForecast({ ...input, start_date: `${year}-01-01`, end_date: `${year}-01-02` });
    assert.equal(typical.status, "historical");
    assert.equal(typical.summaries.length, 2);
    assert.deepEqual(hosts, ["api.open-meteo.com", "archive-api.open-meteo.com"]);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const failed = await getWeatherForecast({ ...input, latitude: 5, location: "Offline" });
    assert.equal(failed.status, "unavailable");
    assert.deepEqual(failed.summaries, []);
  } finally { globalThis.fetch = old; }
});

const trip: TripData = { id: "weather", destination: "Weather test region", starting_location: "Origin", start_date: date(1), end_date: date(3),
  budget: 1000, budget_preference: "Balance", traveler_count: 1,
  traveler_profile: { interests: ["Nature", "Culture/History"], preferences: [], travel_style: "Balanced" } };

test("live weather has full influence, historical half, missing/fallback zero", () => {
  const live: WeatherSummary = { location: "Base", date: date(1), kind: "forecast", min_temperature_c: 10, max_temperature_c: 20,
    weather_code: 63, precipitation_probability: 80, description: "Rain", source_metadata: liveSource("Open-Meteo", "weather_forecast", date(0)) };
  const historical: WeatherSummary = { ...live, kind: "historical", weather_code: null, precipitation_probability: null,
    historical_sample_days: 155, historical_wet_day_frequency: 80, source_metadata: { ...live.source_metadata, is_live: false, label: "HISTORICAL" } };
  for (const [category, full] of [["leisure.park", -10], ["entertainment.museum", 5]] as const) {
    const place = { name: "Candidate", category, source: "Test" };
    const score = (weather?: WeatherSummary) => scoreActivity(place, trip, { weather, location: "Base", date: date(1) }).weatherAdjustment;
    assert.equal(score(live), full);
    assert.equal(score(historical), full / 2);
    assert.equal(score(), 0);
    assert.equal(score({ ...live, source_metadata: { ...live.source_metadata, is_live: false, label: "FALLBACK" } }), 0);
    assert.equal(score({ ...historical, historical_wet_day_frequency: 20 }), 0);
  }
});

test("actual generation ranks with weather, final enrichment reuses it, and provider failure still generates", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = "test-only";
  let weatherCalls = 0;
  let fail = false;
  globalThis.fetch = async (url) => {
    const request = new URL(String(url));
    if (request.hostname.includes("open-meteo")) {
      weatherCalls++;
      if (fail) throw new Error("offline");
      return Response.json({ daily: { time: [date(1), date(2), date(3)], temperature_2m_min: [10, 10, 10], temperature_2m_max: [20, 20, 20],
        precipitation_probability_max: [90, 90, 90], weather_code: [63, 63, 63] } });
    }
    if (request.pathname === "/v2/places") return Response.json({ features: [
      { properties: { name: "A park", categories: ["leisure.park"] } },
      { properties: { name: "Z museum", categories: ["entertainment.museum"] } },
    ] });
    return Response.json({ features: [{ geometry: { coordinates: [42, 21] }, properties: { formatted: "Weather test region", lat: 21, lon: 42 } }] });
  };
  try {
    const generated = await generateItinerary(trip);
    assert.equal(generated.daily_itinerary[0].afternoon.activity, "Z museum");
    assert.equal(generated.daily_itinerary[0].weather?.kind, "forecast");
    const calls = weatherCalls;
    // Disable unrelated providers for the reuse assertion.
    delete process.env.GEOAPIFY_API_KEY;
    const enriched = await enrichItineraryWithLiveData(generated, trip);
    assert.equal(weatherCalls, calls);
    assert.deepEqual(enriched.daily_itinerary[0].weather, generated.daily_itinerary[0].weather);
    process.env.GEOAPIFY_API_KEY = "test-only";
    fail = true;
    const fallback = await generateItinerary({ ...trip, start_date: date(4), end_date: date(6) });
    assert.ok(fallback.daily_itinerary.length > 0);
    assert.equal(fallback.daily_itinerary[0].weather, undefined);
    assert.equal(fallback.daily_itinerary[0].afternoon.activity, "A park");
    const failedCalls = weatherCalls;
    delete process.env.GEOAPIFY_API_KEY;
    await enrichItineraryWithLiveData(fallback, trip);
    assert.equal(weatherCalls, failedCalls);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = oldKey;
  }
});


test("a trip crossing the horizon preserves supported forecast days and uses history only beyond it", async () => {
  const old = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (url) => {
    const request = new URL(String(url)); paths.push(request.pathname);
    if (request.pathname === "/v1/forecast") {
      assert.equal(request.searchParams.get("start_date"), date(14));
      assert.equal(request.searchParams.get("end_date"), date(15));
      return Response.json({ daily: { time: [date(14), date(15)], temperature_2m_min: [10, 10], temperature_2m_max: [20, 20],
        weather_code: [0, 0], precipitation_probability_max: [0, 0] } });
    }
    const first = Number(request.searchParams.get("start_date")!.slice(0, 4));
    return Response.json({ daily: history(first, first + 4, Array.from({ length: 12 }, (_, i) => i + 1)) });
  };
  try {
    const result = await getWeatherForecast({ ...input, latitude: 11, start_date: date(14), end_date: date(17) });
    assert.equal(result.status, "mixed");
    assert.deepEqual(result.summaries.map((summary) => summary.kind), ["forecast", "forecast", "historical", "historical"]);
    assert.deepEqual(paths.sort(), ["/v1/archive", "/v1/forecast"]);
  } finally { globalThis.fetch = old; }
});

test("historical success and failure caches expire; unavailable archive fabricates nothing", async () => {
  let now = Date.parse("2026-09-01T00:00:00Z");
  let calls = 0;
  let fail = true;
  const provider = createHistoricalWeather(async () => {
    calls++;
    if (fail) throw new Error("offline");
    return Response.json({ daily: history() });
  }, () => now);
  assert.deepEqual(await provider(input, ["2027-01-01"]), []);
  assert.deepEqual(await provider(input, ["2027-01-02"]), []);
  assert.equal(calls, 1);
  now += 60001;
  fail = false;
  assert.equal((await provider(input, ["2027-01-01"])).length, 1);
  assert.equal(calls, 2);
  await provider(input, ["2027-01-02"]);
  assert.equal(calls, 2);
  now += 86400001;
  await provider(input, ["2027-01-03"]);
  assert.equal(calls, 3);
});
