import assert from "node:assert/strict";
import test from "node:test";
import { modifyItinerary, normalizeItinerary, shortenItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";
const trip: TripData = { id: "refinement", destination: "Test region", starting_location: "Origin", start_date: "2026-10-01", end_date: "2026-10-06", traveler_count: 1, budget: 2000, budget_preference: "Balance", traveler_profile: { interests: [], preferences: [], travel_style: "Balanced" } };
function plan(single = false) {
  return normalizeItinerary({ route: single ? [{ location: "Base A", nights: 5, transport_to_next: null, duration_hours: null }] : [{ location: "Base A", nights: 2, transport_to_next: "train", duration_hours: 2 }, { location: "Base B", nights: 3, transport_to_next: null, duration_hours: null }], daily_schedule: Array.from({ length: 6 }, (_, i) => ({ day: i + 1, date: `2026-10-0${i + 1}`, location: single || i < 2 ? "Base A" : "Base B", activities: { morning: `Original morning ${i}`, afternoon: `Original afternoon ${i}`, evening: "Dinner", transport: "Local", food_recommendation: "", estimated_cost: 30 } })) }, trip);
}
test("remove a destination consolidates bases without shortening vacation", async () => {
  for (const request of ["Remove a destination"]) {
    const original = plan();
    const result = await modifyItinerary(trip, original, request);
    assert.equal(result.itinerary.route.length, 1);
    assert.equal(result.itinerary.route[0].nights, 5);
    assert.equal(result.itinerary.daily_itinerary.length, 6);
    assert.ok(result.itinerary.daily_itinerary.every((day) => day.location === "Base A"));
    assert.notEqual(result.itinerary.daily_itinerary[2].morning.activity, original.daily_itinerary[2].morning.activity);
    assert.equal(result.itinerary.daily_itinerary[5].transportation.mode, "Depart from Base A");
    assert.ok(result.itinerary.daily_schedule[2].activities.morning.startsWith(result.itinerary.daily_itinerary[2].morning.activity));
    assert.equal(original.route.length, 2);
    assert.ok(result.changes_made.length);
  }
});
test("single-base slowdown actually frees afternoons and preserves arrival/departure", async () => {
  const original = plan(true);
  const { itinerary } = await modifyItinerary(trip, original, "Slow down the trip");
  assert.equal(itinerary.daily_itinerary[1].afternoon.activity, "Free time");
  assert.deepEqual(itinerary.daily_itinerary[0], original.daily_itinerary[0]);
  assert.deepEqual(itinerary.daily_itinerary[5], original.daily_itinerary[5]);
});
test("nature, food and specific-day refinements change rich rendered activities; unsupported requests report no changes", async () => {
  const original = plan();
  for (const request of ["Add more nature", "Add a food day", "Slow down day 3"]) {
    const result = await modifyItinerary(trip, original, request);
    assert.notDeepEqual(result.itinerary.daily_itinerary, original.daily_itinerary);
    assert.ok(result.changes_made.length);
  }
  const unsupported = await modifyItinerary(trip, original, "Unsupported adjustment");
  assert.deepEqual(unsupported.itinerary.daily_itinerary, original.daily_itinerary);
  assert.equal(unsupported.changes_made.length, 0);
});

test("route refinement updates destination cards and strategy; UI focuses first changed day", async () => {
  const { firstChangedDay } = await import("../../artifacts/travel-optimizer/src/lib/refinement-view");
  const original = plan();
  original.trip_strategy = "A journey with 2 bases";
  assert.equal(original.destinations.length, 2);
  for (const request of ["Remove a destination"]) {
    const result = await modifyItinerary(trip, original, request);
    // Reopening/response normalization must not restore the removed destination.
    const returned = normalizeItinerary(result.itinerary, trip);
    assert.deepEqual(returned.destinations.map((d) => d.name), ["Base A"]);
    assert.match(returned.trip_strategy, /with 1 base:/);
    assert.equal(firstChangedDay(original.daily_itinerary, returned.daily_itinerary), 2);
    assert.equal(firstChangedDay(returned.daily_itinerary, returned.daily_itinerary), -1);
  }
});

test("shortening removes one day, preserves earlier activities, reallocates nights and protects departure", () => {
  const original = plan();
  const shortened = shortenItinerary(trip, original)!;
  assert.equal(shortened.trip.end_date, "2026-10-05");
  assert.equal(shortened.itinerary.total_days, 5);
  assert.equal(shortened.itinerary.total_nights, 4);
  assert.deepEqual(shortened.itinerary.route.map((s) => s.nights), [2, 2]);
  assert.deepEqual(shortened.itinerary.daily_itinerary.slice(0, 4), original.daily_itinerary.slice(0, 4));
  assert.equal(shortened.itinerary.daily_itinerary[4].transportation.mode, "Depart from Base B");
  assert.equal(shortened.itinerary.daily_itinerary[4].morning.place, undefined);
  assert.equal(shortened.itinerary.live_data, undefined);
  assert.match(shortened.itinerary.trip_strategy, /5-day/);
  assert.equal(original.total_days, 6);
  let current = shortened;
  while (current.itinerary.total_days > 2) {
    current = shortenItinerary(current.trip, current.itinerary)!;
    assert.equal(current.itinerary.route.reduce((n, s) => n + s.nights, 0), current.itinerary.total_nights);
    assert.ok(current.itinerary.route.every((s) => s.nights >= 1));
    assert.equal(current.itinerary.daily_itinerary.at(-1)!.location, current.itinerary.route.at(-1)!.location);
  }
  assert.equal(shortenItinerary(current.trip, current.itinerary), null);
});
