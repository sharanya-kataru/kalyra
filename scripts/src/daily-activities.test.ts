import assert from "node:assert/strict";
import test from "node:test";
import { generateItinerary, normalizeItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";
import { discoverDailyActivities, formatPlaceDescription } from "../../artifacts/api-server/src/lib/daily-activities";
import type { PlaceResult, PlacesProvider } from "../../artifacts/api-server/src/lib/places";

const trip: TripData = {
  id: "test-trip", destination: "Test region", starting_location: "Test origin",
  start_date: "2026-09-01", end_date: "2026-09-05", traveler_count: 1,
  budget: 1000, budget_preference: "Balance",
  traveler_profile: { interests: [], preferences: [], travel_style: "Balanced" },
};
const place = (name: string): PlaceResult => ({ name, category: "tourism.sights", source: "Test provider" });

test("description formatter prefers provider prose without inventing or rewriting facts", () => {
  assert.equal(formatPlaceDescription({ ...place("Example"), categories: ["leisure.park"],
    description: "  Provider-supplied description.  " }), "Provider-supplied description.");
});

test("description formatter chooses specific categories regardless of category order", () => {
  const categories = ["building", "tourism", "tourism.attraction", "tourism.attraction.viewpoint"];
  const input = { ...place("Example"), categories, city: "Sample locality" };
  assert.equal(formatPlaceDescription(input), "A viewpoint in Sample locality.");
  assert.equal(formatPlaceDescription({ ...input, categories: [...categories].reverse() }),
    "A viewpoint in Sample locality.");
  assert.deepEqual(input.categories, categories);
  for (const [category, expected] of [
    ["leisure.park", "A park."], ["entertainment.museum", "A museum."],
    ["entertainment.culture.gallery", "A gallery."],
    ["tourism.sights.memorial.monument", "A monument."],
    ["tourism.sights.place_of_worship.church", "A place of worship."],
    ["heritage", "A heritage site."],
    ["tourism.sights.archaeological_site", "An archaeological site."],
  ]) {
    assert.equal(formatPlaceDescription({ ...place("Example"), categories: [category] }), expected);
  }
});

test("description formatter handles placeholders, addresses, broad categories, and missing fields", () => {
  for (const description of [undefined, " ", "N/A", "unknown", "No description available", "Example", "---"]) {
    assert.equal(formatPlaceDescription({ ...place("Example"), description,
      categories: ["leisure", "leisure.park"], city: "Town" }), "A park in Town.");
  }
  const input = { ...place("Example"), categories: ["building", "tourism", "leisure"],
    address_line2: " Street, Town ", address: "Example, Street, Town" };
  assert.equal(formatPlaceDescription(input), "Street, Town");
  assert.equal(formatPlaceDescription({ ...input, address_line2: " " }), "Example, Street, Town");
  assert.equal(formatPlaceDescription(place("Example")), "");
  assert.equal(formatPlaceDescription({ ...place("Example"), categories: ["leisure.parking"] }), "");
});

test("descriptions for observed example categories use only provider-supported facts", () => {
  for (const [name, city, category, expected] of [
    ["Giardini di Villa Melzi d'Eril", "Bellagio", "leisure.park", "A park in Bellagio."],
    ["Höhematte", "Interlaken", "leisure.park", "A park in Interlaken."],
    ["Alpenwildpark", "Interlaken", "tourism.attraction", "An attraction in Interlaken."],
  ]) {
    assert.equal(formatPlaceDescription({ ...place(name), city, categories: [category] }), expected);
  }
});
function provider(overrides: Partial<PlacesProvider> = {}): PlacesProvider {
  return {
    search_attractions: async () => [], search_nature: async () => [],
    search_points_of_interest: async () => [], search_restaurants: async () => [],
    ...overrides,
  };
}
function plan() {
  return normalizeItinerary({
    route: [
      { location: "First base", country: "Test country", nights: 2, transport_to_next: "train", duration_hours: 2 },
      { location: "Second base", country: "Test country", nights: 2, transport_to_next: null, duration_hours: null },
    ],
    daily_schedule: Array.from({ length: 5 }, (_, index) => ({
      day: index + 1, date: `2026-09-0${index + 1}`, location: index < 2 ? "First base" : "Second base",
      activities: { morning: "Existing morning", afternoon: "Existing afternoon", evening: "Existing evening",
        food_recommendation: "", transport: "Existing transport", estimated_cost: 50 },
    })),
  }, trip);
}

test("legacy strings become activity titles and rich activity objects survive normalization", () => {
  const itinerary = plan();
  assert.equal(itinerary.daily_itinerary[0].morning.activity, "Existing morning");
  assert.deepEqual(normalizeItinerary(itinerary, trip).daily_itinerary, itinerary.daily_itinerary);
});

test("places are unique per location and travel blocks remain intact", async () => {
  const itinerary = plan();
  const queries: string[] = [];
  const result = await discoverDailyActivities(itinerary, trip, provider({
    search_attractions: async (query) => {
      queries.push(query);
      return [place("C"), place("A"), place("B"), place("A")];
    },
    search_points_of_interest: async () => [place("A"), place("D")],
  }));
  assert.deepEqual(queries, ["First base, Test country", "Second base, Test country"]);
  assert.equal(result[0].afternoon.activity, "A");
  assert.equal(result[1].morning.activity, "B");
  assert.equal(result[1].afternoon.activity, "C");
  assert.deepEqual(result[0].morning, itinerary.daily_itinerary[0].morning);
  assert.deepEqual(result[2].morning, itinerary.daily_itinerary[2].morning);
  assert.deepEqual(result[4], itinerary.daily_itinerary[4]);
  result.forEach((day, index) => {
    assert.deepEqual(day.evening, itinerary.daily_itinerary[index].evening);
    assert.equal(day.estimated_daily_cost_usd, itinerary.daily_itinerary[index].estimated_daily_cost_usd);
    assert.deepEqual(day.transportation, itinerary.daily_itinerary[index].transportation);
  });
});

test("interests and preferences prioritize categories and provider order does not change selection", async () => {
  const itinerary = plan();
  const makeProvider = (reverse: boolean) => provider({
    search_attractions: async () => [place("Attraction")],
    search_nature: async () => (reverse ? [place("Park B"), place("Park A")] : [place("Park A"), place("Park B")]),
    search_points_of_interest: async () => [place("Heritage")],
  });
  const natureTrip = { ...trip, traveler_profile: { ...trip.traveler_profile, preferences: ["Outdoor walks"] } };
  const first = await discoverDailyActivities(itinerary, natureTrip, makeProvider(false));
  assert.equal(first[0].afternoon.activity, "Park A");
  assert.deepEqual(first, await discoverDailyActivities(itinerary, natureTrip, makeProvider(true)));
  const cultureTrip = { ...trip, traveler_profile: { ...trip.traveler_profile, interests: ["History"] } };
  const culture = await discoverDailyActivities(itinerary, cultureTrip, makeProvider(false));
  assert.equal(culture[0].afternoon.activity, "Heritage");
});

test("missing, failed, empty, and exhausted discovery retain existing activities", async () => {
  const itinerary = plan();
  assert.deepEqual(await discoverDailyActivities(itinerary, trip, null), itinerary.daily_itinerary);
  assert.deepEqual(await discoverDailyActivities(itinerary, trip, provider()), itinerary.daily_itinerary);
  assert.deepEqual(await discoverDailyActivities(itinerary, trip, provider({
    search_attractions: async () => { throw new Error("Unavailable"); },
    search_points_of_interest: () => { throw new Error("Unavailable"); },
  })), itinerary.daily_itinerary);
  const partial = await discoverDailyActivities(itinerary, trip, provider({
    search_attractions: async () => { throw new Error("Unavailable"); },
    search_points_of_interest: async () => [place("Only place")],
  }));
  assert.equal(partial[0].afternoon.activity, "Only place");
  assert.deepEqual(partial[1], itinerary.daily_itinerary[1]);
});

test("initial generation uses discovered places and synchronizes the legacy schedule", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = "test-key";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.geoapify.com");
    const properties = url.pathname === "/v2/places"
      ? { name: "Discovered place", categories: ["leisure", "leisure.park"], city: "Test locality", lat: 12, lon: 34 }
      : { formatted: "Test region", lat: 12, lon: 34 };
    return new Response(JSON.stringify({ features: [{ properties, geometry: { coordinates: [34, 12] } }] }), { status: 200 });
  };
  try {
    const itinerary = await generateItinerary(trip);
    assert.equal(itinerary.daily_itinerary[0].afternoon.activity, "Discovered place");
    assert.equal(itinerary.daily_itinerary[0].afternoon.description, "A park in Test locality.");
    assert.match(itinerary.daily_schedule[0].activities.afternoon, /^Discovered place:/);
    assert.match(itinerary.daily_itinerary.at(-1)!.morning.activity, /final morning/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = originalKey;
  }
});
