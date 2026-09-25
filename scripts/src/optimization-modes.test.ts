import assert from "node:assert/strict";
import test from "node:test";
import {
  activityPace,
  scoreActivity,
  rankActivities,
} from "../../artifacts/api-server/src/lib/activity-optimizer";
import { discoverDailyActivities } from "../../artifacts/api-server/src/lib/daily-activities";
import {
  normalizeItinerary,
  modifyItinerary,
  generateItinerary,
  type TripData,
} from "../../artifacts/api-server/src/lib/ai";
import type { OptimizationMode } from "../../artifacts/api-server/src/lib/optimization-profile";
import type {
  PlaceResult,
  PlacesProvider,
} from "../../artifacts/api-server/src/lib/places";
import { planningStyle } from "../../artifacts/travel-optimizer/src/lib/planning-style";
import { liveSource } from "../../artifacts/api-server/src/lib/sources";

const trip: TripData = {
  id: "mode",
  destination: "Test base",
  starting_location: "Origin",
  start_date: "2026-10-01",
  end_date: "2026-10-05",
  budget: 2000,
  budget_preference: "Balance",
  traveler_count: 1,
  traveler_profile: {
    interests: ["Nature", "Culture"],
    preferences: [],
    travel_style: "A little of everything",
  },
};

const input = (
  mode?: OptimizationMode,
  travelStyle = "A little of everything"
): TripData => ({
  ...trip,
  traveler_profile: {
    ...trip.traveler_profile,
    travel_style: travelStyle,
    optimization_mode: mode,
  },
});

const place = (
  name: string,
  categories: string[],
  lon?: number
): PlaceResult => ({
  name,
  category: categories[0],
  categories,
  lat: lon === undefined ? undefined : 0,
  lon,
  source: "Fixture",
});

const park = place("Park", ["leisure.park"], 0);
const museum = place("Museum", ["entertainment.museum"], 0.02);
const mixed = place(
  "Mixed",
  ["leisure.park", "entertainment.museum"],
  0.024
);

function plan() {
  return normalizeItinerary(
    {
      daily_schedule: Array.from({ length: 5 }, (_, i) => ({
        day: i + 1,
        date: `2026-10-0${i + 1}`,
        location: i < 3 ? "Base A" : "Base B",
        activities: {
          morning: "Morning",
          afternoon: "Afternoon",
          evening: "Dinner",
          transport: "Local transit",
          food_recommendation: "",
          estimated_cost: 50,
        },
      })),
    },
    trip
  );
}

test("missing mode matches Balanced; Interest First changes a controlled tradeoff", () => {
  const context = { previous: park, selectedAtLocation: [museum] };
  const candidates = [park, mixed];

  assert.deepEqual(
    rankActivities(candidates, input(), context),
    rankActivities(candidates, input("balanced"), context)
  );

  assert.equal(
    rankActivities(candidates, input("balanced"), context)[0].place,
    park
  );

  assert.equal(
    rankActivities(candidates, input("interest_first"), context)[0].place,
    mixed
  );

  assert.equal(
    scoreActivity(mixed, input("balanced"), context).diversityAdjustment,
    scoreActivity(mixed, input("interest_first"), context).diversityAdjustment
  );

  assert.equal(planningStyle().label, "Balanced");
});

test("every priority retains weather and diversity; Stay Local strengthens proximity", () => {
  const weather = {
    location: "Base",
    date: "2026-10-02",
    min_temperature_c: 10,
    max_temperature_c: 15,
    precipitation_probability: 90,
    weather_code: 63,
    description: "Rain",
    source_metadata: liveSource(
      "Fixture",
      "weather_forecast",
      "2026-10-01"
    ),
  };

  for (const mode of ["balanced", "interest_first", "stay_local"] as const) {
    const context = {
      previous: park,
      selectedAtLocation: [park],
      weather,
      location: weather.location,
      date: weather.date,
    };

    assert.equal(
      scoreActivity(park, input(mode), context).weatherAdjustment,
      -10
    );
    assert.equal(
      scoreActivity(museum, input(mode), context).weatherAdjustment,
      5
    );
    assert.equal(
      scoreActivity(park, input(mode), context).diversityAdjustment,
      -16
    );
    assert.equal(
      scoreActivity(
        place("Unknown", ["leisure.park"]),
        input(mode),
        context
      ).geography,
      0
    );
  }

  assert.equal(
    scoreActivity(park, input("stay_local"), { previous: park }).geography,
    40
  );
  assert.equal(
    scoreActivity(park, input("balanced"), { previous: park }).geography,
    30
  );
});

test("travel pace controls density independently of planning priority", async () => {
  const candidates = [
    place("A seed", ["leisure.park"], 0),
    place("B distant", ["leisure.park"], 0.1),
    place("Z nearby", ["leisure.park"], 0.001),
    museum,
    mixed,
  ];

  const run = async (
    mode: OptimizationMode | undefined,
    travelStyle: string,
    reverse = false
  ) => {
    let calls = 0;
    const search = async () => {
      calls++;
      return reverse ? [...candidates].reverse() : candidates;
    };

    const provider: PlacesProvider = {
      search_attractions: search,
      search_points_of_interest: search,
      search_nature: search,
      search_restaurants: async () => [],
    };

    const days = await discoverDailyActivities(
      plan(),
      input(mode, travelStyle),
      provider
    );

    assert.equal(calls, 6);
    return days;
  };

  for (const mode of [
    undefined,
    "balanced",
    "interest_first",
    "stay_local",
  ] as const) {
    const unhurried = await run(mode, "Unhurried");
    const unhurriedReverse = await run(mode, "Unhurried", true);

    assert.deepEqual(unhurried, unhurriedReverse);
    assert.deepEqual(unhurried[0].morning, plan().daily_itinerary[0].morning);
    assert.deepEqual(unhurried[3].morning, plan().daily_itinerary[3].morning);
    assert.deepEqual(unhurried[4], plan().daily_itinerary[4]);
    assert.ok(unhurried[1].morning.place);
    assert.deepEqual(unhurried[1].afternoon, {
      activity: "Free time",
      description: "Leave room to wander, rest, or explore spontaneously.",
      estimated_cost_usd: 0,
    });
    assert.equal(unhurried[1].walking_legs?.length, 0);

    const balancedPace = await run(mode, "A little of everything");
    assert.ok(balancedPace[1].morning.place);
    assert.ok(balancedPace[1].afternoon.place);

    const fastPace = await run(mode, "See it all");
    assert.ok(fastPace[1].morning.place);
    assert.ok(fastPace[1].afternoon.place);
  }

  const empty = await discoverDailyActivities(
    plan(),
    input("balanced", "Unhurried"),
    null
  );

  assert.equal(empty[1].afternoon.activity, "Free time");
  assert.deepEqual(empty[4], plan().daily_itinerary[4]);
});

test("See it all is recognized as fast pace", () => {
  assert.equal(activityPace("Unhurried"), "slow");
  assert.equal(activityPace("A little of everything"), "balanced");
  assert.equal(activityPace("See it all"), "fast");
});

test("Stay Local uses prior same-location coordinates without carrying another base's anchor", async () => {
  const candidates = [
    place("A seed", ["leisure.park"], 0),
    place("B distant", ["leisure.park"], 0.1),
    place("Z nearby", ["leisure.park"], 0.001),
  ];

  const search = async () => candidates;

  const days = await discoverDailyActivities(
    plan(),
    input("stay_local"),
    {
      search_attractions: search,
      search_nature: search,
      search_points_of_interest: search,
      search_restaurants: async () => [],
    }
  );

  assert.equal(days[0].afternoon.activity, "A seed");
  assert.equal(days[1].morning.activity, "Z nearby");
  assert.equal(days[3].afternoon.activity, "A seed");
});

test("refinement and date regeneration preserve the supplied priority and pace", async () => {
  const originalGeo = process.env.GEOAPIFY_API_KEY;
  delete process.env.GEOAPIFY_API_KEY;

  try {
    const selected = input("stay_local", "Unhurried");
    const days = await discoverDailyActivities(plan(), selected, null);

    await modifyItinerary(
      selected,
      { ...plan(), daily_itinerary: days },
      "Keep this plan"
    );

    assert.equal(
      selected.traveler_profile.optimization_mode,
      "stay_local"
    );
    assert.equal(
      selected.traveler_profile.travel_style,
      "Unhurried"
    );

    const generated = await generateItinerary({
      ...selected,
      end_date: "2026-10-06",
    });

    assert.equal(
      generated.daily_itinerary[1].afternoon.activity,
      "Free time"
    );
  } finally {
    if (originalGeo !== undefined) {
      process.env.GEOAPIFY_API_KEY = originalGeo;
    }
  }
});

test("Back/Edit brief hydrates every draft field and mode; old drafts default to Balanced", async () => {
  const { hydratePlanDraft } = await import(
    "../../artifacts/travel-optimizer/src/lib/plan-draft"
  );

  const draft = {
    destination: "Region",
    startingLocation: "Origin",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    travelerCount: "2",
    budget: "$1,400–1,800",
    budgetPreference: "Balance",
    travelerProfile: {
      interests: ["Nature"],
      preferences: ["Free time"],
      travel_style: "Unhurried",
      optimization_mode: "interest_first" as const,
    },
  };

  assert.deepEqual(hydratePlanDraft(draft), draft);

  assert.equal(
    hydratePlanDraft({
      ...draft,
      travelerProfile: {
        ...draft.travelerProfile,
        optimization_mode: undefined,
      },
    }).travelerProfile.optimization_mode,
    "balanced"
  );

  assert.equal(
    hydratePlanDraft(null).travelerProfile.optimization_mode,
    "balanced"
  );
});
