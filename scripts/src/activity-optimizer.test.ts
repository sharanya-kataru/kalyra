import assert from "node:assert/strict";
import test from "node:test";
import { rankActivities, scoreActivity, geographicDistanceKm } from "../../artifacts/api-server/src/lib/activity-optimizer";
import { discoverDailyActivities } from "../../artifacts/api-server/src/lib/daily-activities";
import { normalizeItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";
import type { PlaceResult } from "../../artifacts/api-server/src/lib/places";
import { liveSource } from "../../artifacts/api-server/src/lib/sources";

const trip: TripData = { id: "optimization", destination: "Test region", starting_location: "Origin",
  start_date: "2026-10-01", end_date: "2026-10-05", traveler_count: 1, budget: 1000, budget_preference: "Balance",
  traveler_profile: { interests: [], preferences: [], travel_style: "Balanced" } };
const place = (name: string, category = "tourism", lat?: number, lon?: number): PlaceResult =>
  ({ name, category, lat, lon, source: "Test provider" });
const profile = (interests: string[], preferences: string[] = [], travel_style = "Balanced"): TripData =>
  ({ ...trip, traveler_profile: { interests, preferences, travel_style } });
const park = place("Z park", "leisure.park");
const museum = place("A museum", "entertainment.museum");

test("nature preferences and photography interests boost matching categories, not names", () => {
  const input = profile(["Photography"], ["Outdoor hiking"]);
  const score = scoreActivity(park, input);
  assert.equal(score.interest, 30);
  assert.deepEqual(score.interestMatches.map((m) => m.dimension), ["nature", "photography"]);
  assert.equal(rankActivities([museum, park], input)[0].place, park);
  assert.equal(scoreActivity({ ...park, name: "Different name" }, input).total, score.total);
});

test("culture/history and art fit use detailed categories, with safe unknown interests", () => {
  const input = profile(["History", "Art"]);
  const detailed = { ...museum, category: "building", categories: ["building", "entertainment.museum.art"] };
  assert.equal(scoreActivity(detailed, input).interest, 30);
  assert.equal(rankActivities([park, detailed], input)[0].place, detailed);
  assert.ok(scoreActivity(place("Heritage", "heritage"), input).interest > 0);
  assert.equal(scoreActivity(museum, profile(["Unmapped preference"])).interest, 0);
});

test("next activity favors nearby coordinates; straight-line distance is correct", () => {
  const seed = place("Seed", "tourism", 0, 0);
  const close = place("Z close", "leisure.park", 0, 0.005);
  const far = place("A far", "leisure.park", 0, 0.1);
  assert.equal(rankActivities([far, close], trip, { previous: seed })[0].place, close);
  assert.ok(Math.abs(geographicDistanceKm(seed, place("Point", "tourism", 0, 1))! - 111.195) < 0.01);
});

test("slow and fast pace change geographic tolerance without new periods", () => {
  const previous = place("Seed", "tourism", 0, 0);
  const close = place("Close generic", "tourism", 0, 0.001);
  const farther = place("Farther park", "leisure.park", 0, 0.014);
  assert.equal(rankActivities([farther, close], profile([], [], "Relaxed"), { previous })[0].place, close);
  assert.equal(rankActivities([farther, close], profile([], [], "Fast"), { previous })[0].place, farther);
  assert.ok(scoreActivity(farther, profile([], [], "Slow"), { previous }).paceAdjustment < 0);
});

test("missing/invalid coordinates remain eligible without geographic advantage", () => {
  const previous = place("Seed", "tourism", 0, 0);
  for (const candidate of [park, { ...park, lat: NaN, lon: 0 }, { ...park, lat: 91, lon: 0 }]) {
    const score = scoreActivity(candidate, trip, { previous });
    assert.equal(score.distanceKm, null);
    assert.equal(score.geography, 0);
    assert.equal(score.paceAdjustment, 0);
    assert.equal(rankActivities([candidate], trip)[0].place, candidate);
  }
});

test("weather absent or mismatched has zero effect; matching bad live forecast is modest", () => {
  const weather = { location: "Base", date: "2026-10-02", min_temperature_c: 10, max_temperature_c: 15,
    precipitation_probability: 90, weather_code: 63, description: "Rain",
    source_metadata: liveSource("Test weather", "weather_forecast", "2026-10-01") };
  const context = { weather, location: weather.location, date: weather.date };
  assert.equal(scoreActivity(park, trip).weatherAdjustment, 0);
  assert.equal(scoreActivity(park, trip, { ...context, date: "2026-11-02" }).weatherAdjustment, 0);
  assert.equal(scoreActivity(park, trip, { ...context, location: "Other base" }).weatherAdjustment, 0);
  assert.equal(scoreActivity(park, trip, { ...context, weather: { ...weather, source_metadata: { ...weather.source_metadata, is_live: false } } }).weatherAdjustment, 0);
  assert.equal(scoreActivity(park, trip, context).weatherAdjustment, -10);
  assert.equal(scoreActivity(museum, trip, context).weatherAdjustment, 5);
  assert.equal(rankActivities([park], trip, context)[0].place, park);
});

function plan() {
  return normalizeItinerary({ daily_schedule: Array.from({ length: 5 }, (_, index) => ({
    day: index + 1, date: `2026-10-0${index + 1}`, location: index < 3 ? "First base" : "Second base",
    activities: { morning: "Travel or explore", afternoon: "Explore", evening: "Dinner", food_recommendation: "", transport: "Walk and local transit", estimated_cost: 50 },
  })) }, trip);
}

test("allocation re-ranks each day, deduplicates searches, and is independent of provider ordering", async () => {
  const candidates = [place("A seed", "leisure.park", 0, 0), place("B seed", "leisure.park", 1, 1),
    place("C far", "leisure.park", 0, 0.001), place("Z close", "leisure.park", 1, 1.001),
    place("Other", "tourism"), { ...park, name: " A seed ", lat: 0, lon: 0 }];
  const run = (reversed: boolean) => discoverDailyActivities(plan(), trip, {
    search_attractions: async () => reversed ? [...candidates].reverse() : candidates,
    search_points_of_interest: async () => [candidates[0]], search_nature: async () => [], search_restaurants: async () => [],
  });
  const days = await run(false);
  assert.deepEqual(days, await run(true));
  assert.equal(days[1].morning.activity, "B seed");
  assert.equal(days[1].afternoon.activity, "Z close"); // Beats alphabetical C on proximity.
  const scheduled = [days[0].afternoon, days[1].morning, days[1].afternoon, days[2].morning, days[2].afternoon]
    .map((activity) => activity.activity.trim().toLowerCase());
  assert.equal(new Set(scheduled).size, scheduled.length);
  const initial = plan();
  assert.deepEqual(days[0].morning, initial.daily_itinerary[0].morning);
  assert.deepEqual(days[3].morning, initial.daily_itinerary[3].morning);
  assert.deepEqual(days[4], initial.daily_itinerary[4]);
});

test("all provider failures preserve the deterministic plan, weak-only results remain usable", async () => {
  const initial = plan();
  const fail = async (): Promise<PlaceResult[]> => { throw new Error("offline"); };
  const provider = { search_attractions: fail, search_points_of_interest: fail, search_nature: fail, search_restaurants: fail };
  assert.deepEqual(await discoverDailyActivities(initial, trip, provider), initial.daily_itinerary);
  const result = await discoverDailyActivities(initial, trip, { ...provider, search_attractions: async () => [place("Weak POI")] });
  assert.equal(result[0].afternoon.activity, "Weak POI");
  assert.deepEqual(result[1], initial.daily_itinerary[1]);
});


test("equal scores use normalized name/address ties regardless of input order", () => {
  const a = { ...place("Same", "tourism"), address: "A street" };
  const b = { ...place("Same", "tourism"), address: "Z street" };
  assert.deepEqual(rankActivities([b, a], trip), rankActivities([a, b], trip));
  assert.equal(rankActivities([b, a], trip)[0].place, a);
});

test("unavailable weather leaves normal selection unchanged", () => {
  const input = profile(["Nature"]);
  assert.deepEqual(rankActivities([museum, park], input, { weather: undefined }), rankActivities([museum, park], input));
  assert.equal(rankActivities([museum, park], input)[0].place, park);
});

test("diversity counts overlapping families once and caps the modest penalty", () => {
  const input = profile(["Nature", "Photography", "Culture/History"]);
  assert.equal(scoreActivity(park, input, { selectedAtLocation: [park] }).diversityAdjustment, -8);
  assert.equal(scoreActivity(park, input, { previous: park, selectedAtLocation: [park] }).diversityAdjustment, -16);
  const score = scoreActivity(park, input, { previous: park, selectedAtLocation: Array(10).fill(park) });
  assert.equal(score.diversityAdjustment, -18);
  assert.equal(score.repeatedSelections, 10);
  assert.equal(scoreActivity(museum, input, { selectedAtLocation: [park] }).diversityAdjustment, 0);
});

test("interest relevance survives repetition and geography remains meaningful", () => {
  const input = profile(["Nature"]);
  const context = { previous: park, selectedAtLocation: Array(10).fill(park) };
  assert.equal(scoreActivity(park, input, context).diversityAdjustment, -18);
  assert.equal(rankActivities([museum, park], input, context)[0].place, park);
  const near = { ...park, lat: 0, lon: 0.001 };
  const far = { ...museum, lat: 1, lon: 1 };
  assert.equal(rankActivities([far, near], profile(["Nature", "History"]), {
    ...context, previous: { ...park, lat: 0, lon: 0 },
  })[0].place, near);
});

test("mixed interests gain diversity across days without changing travel protections or provider-order determinism", async () => {
  const input = profile(["Nature", "Photography", "Culture/History"]);
  const parks = Array.from({ length: 8 }, (_, i) => place(`Park ${i}`, "leisure.park", 0, 0));
  const cultural = { ...museum, name: "Z cultural option", lat: 0, lon: 0.01 };
  const run = (reverse: boolean) => discoverDailyActivities(plan(), input, {
    search_attractions: async () => reverse ? [...parks].reverse() : parks,
    search_nature: async () => reverse ? [...parks].reverse() : parks,
    search_points_of_interest: async () => [cultural], search_restaurants: async () => [],
  });
  const days = await run(false);
  assert.deepEqual(days, await run(true));
  assert.equal(days[0].afternoon.activity, "Park 0");
  assert.equal(days[1].morning.activity, cultural.name);
  // A new base starts with no repetition history.
  assert.equal(days[3].afternoon.activity, "Park 0");
  const original = plan().daily_itinerary;
  assert.deepEqual(days[0].morning, original[0].morning);
  assert.deepEqual(days[3].morning, original[3].morning);
  assert.deepEqual(days[4], original[4]);
});


test("distinct evidence supports multiple bonuses while ancestor categories cannot double count", () => {
  const input = profile(["Nature", "Photography", "Culture/History"]);
  const categories = ["leisure", "leisure.park", "leisure.park.garden", "entertainment.museum"];
  const mixed = { ...park, categories };
  assert.equal(scoreActivity(mixed, input).interest, 60);
  assert.deepEqual(scoreActivity({ ...mixed, categories: [...categories].reverse() }, input), scoreActivity(mixed, input));
  assert.equal(scoreActivity({ ...park, categories: categories.slice(0, 3) }, input).interest, 30);
  assert.equal(scoreActivity(mixed, profile(["Nature"])).interest, 30);
  assert.equal(scoreActivity(mixed, input, { selectedAtLocation: Array(10).fill(mixed) }).diversityAdjustment, -36);
});

test("culture recognizes explicit sight categories without inferring culture from broad tourism", () => {
  const input = profile(["Culture/History"]);
  for (const category of ["tourism.sights.castle", "tourism.sights.palace", "entertainment.museum",
    "entertainment.culture.gallery", "religion.place_of_worship", "tourism.sights.place_of_worship",
    "heritage", "tourism.sights.archaeological_site", "tourism.sights.memorial.monument"]) {
    assert.equal(scoreActivity(place("Neutral name", category), input).interest, 30, category);
  }
  assert.equal(scoreActivity(place("Palace museum", "tourism"), input).interest, 0);
});

test("a comparable cultural candidate beats repeated parks despite a realistic distance disadvantage", () => {
  const input = profile(["Nature", "Photography", "Culture/History"]);
  const previous = { ...park, lat: 0, lon: 0 };
  const nearbyPark = { ...park, lat: 0, lon: 0.0045 }; // approximately 500 m
  const cultural = { ...museum, lat: 0, lon: 0.018 }; // approximately 2 km
  const context = { previous, selectedAtLocation: [previous, previous, previous] };
  assert.equal(rankActivities([nearbyPark, cultural], input, context)[0].place, cultural);
  assert.deepEqual(rankActivities([nearbyPark, cultural], input, context), rankActivities([cultural, nearbyPark], input, context));
});
