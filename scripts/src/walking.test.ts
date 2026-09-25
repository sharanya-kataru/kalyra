import assert from "node:assert/strict";
import test from "node:test";
import { normalizeItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";
import { discoverDailyActivities } from "../../artifacts/api-server/src/lib/daily-activities";
import { cleanWalkingData, createWalkingRouter, enrichWalkingLegs, sensibleWalk } from "../../artifacts/api-server/src/lib/walking";
import { liveSource } from "../../artifacts/api-server/src/lib/sources";
import { walkingLabel } from "../../artifacts/travel-optimizer/src/lib/walking-label";

const trip: TripData = { id: "walking-test", destination: "Test base", starting_location: "Origin",
  start_date: "2026-10-01", end_date: "2026-10-04", budget: 1000, budget_preference: "Balance", traveler_count: 1,
  traveler_profile: { interests: [], preferences: [], travel_style: "Balanced" } };
const a = { name: "Place A", location: "Test base", lat: 10, lon: 20 };
const b = { name: "Place B", location: "Test base", lat: 10.01, lon: 20.01 };
const route = { duration_seconds: 982.319, distance_meters: 1050, source_metadata: liveSource("Geoapify", "walking_route", "2026-10-01") };
function plan() {
  const itinerary = normalizeItinerary({}, trip);
  itinerary.daily_itinerary[1].morning = { activity: a.name, description: "", estimated_cost_usd: 0, place: a };
  itinerary.daily_itinerary[1].afternoon = { activity: b.name, description: "", estimated_cost_usd: 0, place: b };
  return itinerary;
}

test("discovered PlaceResult coordinates survive normalization and create only adjacent walking legs", async () => {
  const initial = normalizeItinerary({}, trip);
  const days = await discoverDailyActivities(initial, trip, {
    search_attractions: async () => [a, b, { ...a, name: "Place C", lat: 10.02 }].map((p) => ({ ...p, category: "tourism.attraction", source: "Geoapify" })),
    search_nature: async () => [], search_points_of_interest: async () => [], search_restaurants: async () => [],
  });
  const normalized = normalizeItinerary({ ...initial, daily_itinerary: days }, trip);
  assert.deepEqual(normalized.daily_itinerary[0].afternoon.place, a);
  let calls = 0;
  const enriched = await enrichWalkingLegs(normalized, async () => { calls++; return route; });
  assert.equal(calls, 1);
  assert.equal(enriched.daily_itinerary[1].walking_legs?.[0].from, "morning");
  assert.equal(enriched.daily_itinerary[1].walking_legs?.[0].to, "afternoon");
  assert.equal(normalizeItinerary(enriched, trip).daily_itinerary[1].walking_legs?.length, 1);
});

test("seconds/meters format correctly and excessive routes are suppressed", async () => {
  assert.equal(walkingLabel(982.319, 1050), "About 16 min walk · 1.1 km");
  assert.equal(walkingLabel(1080, 1400), "About 18 min walk · 1.4 km");
  assert.equal(walkingLabel(30, 40), "About 1 min walk · 40 m");
  for (const r of [{ ...route, duration_seconds: 2701 }, { ...route, distance_meters: 3001 }, { ...route, distance_meters: NaN }]) {
    assert.equal(sensibleWalk(r), false);
    assert.deepEqual((await enrichWalkingLegs(plan(), async () => r)).daily_itinerary[1].walking_legs, []);
  }
});

test("missing coordinates, generic periods, different days and transfer locations never route", async () => {
  const itinerary = plan();
  delete itinerary.daily_itinerary[1].afternoon.place;
  itinerary.daily_itinerary[2].morning = { ...itinerary.daily_itinerary[1].morning, activity: b.name, place: b };
  itinerary.daily_itinerary[2].location = "Different base";
  const result = await enrichWalkingLegs(itinerary, async () => { assert.fail("must not route"); });
  assert.ok(result.daily_itinerary.every((day) => day.walking_legs?.length === 0));
});

test("edited activity names and reassigned locations invalidate coordinates and existing legs", async () => {
  const itinerary = await enrichWalkingLegs(plan(), async () => route);
  const day = itinerary.daily_itinerary[1];
  const renamed = cleanWalkingData({ ...day, morning: { ...day.morning, activity: "Rest instead" } });
  assert.equal(renamed.morning.place, undefined);
  assert.deepEqual(renamed.walking_legs, []);
  const moved = cleanWalkingData({ ...day, location: "New base" });
  assert.equal(moved.afternoon.place, undefined);
  assert.deepEqual(moved.walking_legs, []);
  assert.deepEqual(cleanWalkingData({ ...day, morning: { ...day.morning, place: { ...a, lat: 11 } } }).walking_legs, []);
});

test("provider failures preserve transport fallback", async () => {
  const initial = plan();
  const enriched = await enrichWalkingLegs(initial, async () => { throw new Error("offline"); });
  assert.deepEqual(enriched.daily_itinerary[1].walking_legs, []);
  assert.deepEqual(enriched.daily_itinerary[1].transportation, initial.daily_itinerary[1].transportation);
});

test("overall deadline returns partial results and limits concurrency", { timeout: 2000 }, async () => {
  const itinerary = plan();
  itinerary.daily_itinerary = Array.from({ length: 8 }, (_, i) => ({ ...itinerary.daily_itinerary[1], day: i + 1 }));
  let calls = 0;
  const enriched = await enrichWalkingLegs(itinerary, async () => {
    calls++;
    if (calls === 1) return route;
    return new Promise(() => {});
  }, 25);
  assert.equal(calls, 4); // One completed request and three pending workers.
  assert.equal(enriched.daily_itinerary.flatMap((day) => day.walking_legs ?? []).length, 1);
});

test("adapter validates walk/metric responses, deduplicates requests and expires success/failure caches", async () => {
  const oldKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = "test-only";
  let clock = 0;
  let calls = 0;
  let status = 200;
  const router = createWalkingRouter(async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("mode"), "walk");
    assert.equal(url.searchParams.get("units"), "metric");
    assert.equal(url.searchParams.get("waypoints"), `${a.lat},${a.lon}|${b.lat},${b.lon}`);
    return new Response(JSON.stringify({ features: [{ properties: { mode: "walk", distance_units: "meters", time: 982.319, distance: 1050 } }] }), { status });
  }, () => clock);
  try {
    const [first, second] = await Promise.all([router(a, b), router(a, b)]);
    assert.deepEqual(first, second);
    assert.equal(first?.distance_meters, 1050);
    assert.equal(calls, 1);
    await router(a, b);
    assert.equal(calls, 1);
    clock += 86_400_001;
    status = 400;
    assert.equal(await router(a, b), null);
    assert.equal(await router(a, b), null);
    assert.equal(calls, 2);
    clock += 60_001;
    await router(a, b);
    assert.equal(calls, 3);
    for (const properties of [{ mode: "drive", distance_units: "meters", time: 5, distance: 10 }, { mode: "walk", distance_units: "miles", time: 5, distance: 10 }, { mode: "walk", distance_units: "meters", time: -1, distance: 10 }]) {
      const invalid = createWalkingRouter(async () => new Response(JSON.stringify({ features: [{ properties }] })));
      assert.equal(await invalid(a, b), null);
    }
  } finally {
    if (oldKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = oldKey;
  }
});
