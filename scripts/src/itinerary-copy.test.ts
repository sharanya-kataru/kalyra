import assert from "node:assert/strict";
import test from "node:test";
import { generateItinerary, normalizeItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";

const trip: TripData = {
  id: "copy-test", destination: "Test region", starting_location: "Test origin",
  start_date: "2026-10-01", end_date: "2026-10-05", traveler_count: 1,
  budget: 1000, budget_preference: "Balance",
  traveler_profile: { interests: [], preferences: [], travel_style: "Balanced" },
};

test("normalized transport copy distinguishes travel days without invented durations", () => {
  const modes = ["Arrive from Test origin", "Walk and local transit", "Transfer from the previous base",
    "Walk and local transit", "Depart from Second base"];
  const itinerary = normalizeItinerary({
    route: [
      { location: "First base", nights: 2, transport_to_next: null, duration_hours: null },
      { location: "Second base", nights: 2, transport_to_next: null, duration_hours: null },
    ],
    daily_schedule: modes.map((mode, index) => ({
      day: index + 1, date: `2026-10-0${index + 1}`, location: index < 2 ? "First base" : "Second base",
      activities: { morning: "Morning", afternoon: "Afternoon", evening: "Evening",
        food_recommendation: "", transport: mode, estimated_cost: 42 },
    })),
  }, trip);
  assert.deepEqual(itinerary.daily_itinerary.map((day) => day.transportation.mode), modes);
  assert.deepEqual(itinerary.daily_itinerary.map((day) => day.transportation.details), [
    "Allow time to reach your accommodation and settle in.",
    "Plan local journeys around the day's activities.",
    "Allow time to travel between bases and settle into your accommodation.",
    "Plan local journeys around the day's activities.",
    "Leave time to collect your belongings and reach your departure point.",
  ]);
  for (const day of itinerary.daily_itinerary) {
    assert.equal(day.transportation.duration, "");
    assert.equal(day.evening.description, "Enjoy dinner at an unhurried pace.");
    assert.equal(day.estimated_daily_cost_usd, 42);
  }
  itinerary.daily_itinerary[0].transportation = { mode: "Provided mode", details: "Provided details", duration: "45 minutes" };
  assert.deepEqual(normalizeItinerary(itinerary, trip).daily_itinerary[0].transportation,
    itinerary.daily_itinerary[0].transportation);
});

test("generated evening and food fallbacks use natural copy", async () => {
  const previousKey = process.env.GEOAPIFY_API_KEY;
  delete process.env.GEOAPIFY_API_KEY;
  try {
    const regular = await generateItinerary(trip);
    const food = await generateItinerary({ ...trip,
      traveler_profile: { ...trip.traveler_profile, interests: ["Food"] } });
    assert.equal(regular.daily_itinerary[0].evening.activity,
      `Relaxed dinner and an easy evening in ${regular.daily_itinerary[0].location}`);
    assert.equal(food.daily_itinerary[0].evening.activity,
      "Dinner at a local restaurant known for regional specialties");
    assert.deepEqual(food.daily_itinerary[0].food_recommendations, ["Try regional dishes at a local restaurant."]);
    assert.doesNotMatch(JSON.stringify(food.daily_itinerary), /Ask your accommodation|off-menu|Follow the planned route|Local movement|Light transfer day/);
    assert.equal(food.daily_itinerary.at(-1)!.evening.activity,
      `Early dinner or airport transfer from ${food.daily_itinerary.at(-1)!.location}`);
  } finally {
    if (previousKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = previousKey;
  }
});
