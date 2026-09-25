import assert from "node:assert/strict";
import test from "node:test";
import { buildFlightComparison } from "../../artifacts/api-server/src/lib/flight-alternatives";
import { searchFlightCandidates } from "../../artifacts/api-server/src/lib/live-data";
import { flightOffer, flightResult } from "./flight-fixtures";
import { flightDeltas, flightMetrics, visibleFlightAlternatives } from "../../artifacts/travel-optimizer/src/lib/flight-display";
import { normalizeItinerary, type TripData } from "../../artifacts/api-server/src/lib/ai";

const balanced = flightOffer("balanced", 500, 600);
const cheap = flightOffer("cheap", 400, 1800, 2, "CCC");
const fast = flightOffer("fast", 700, 360, 0, "DDD");
const pool = () => [flightResult([balanced]), flightResult([cheap], "CCC"), flightResult([fast], "DDD")];

test("balanced recommended differs from cross-airport cheapest and fastest", () => {
  const result = buildFlightComparison(pool())!;
  assert.equal(result.selected_offer?.provider_offer_id, "balanced");
  assert.equal(result.origin, "AAA");
  assert.deepEqual(result.alternatives?.map((a) => [a.kind, a.origin]), [["cheapest", "CCC"], ["fastest", "DDD"]]);
  assert.match(result.recommendation_reason!, /balance/);
  assert.equal(flightDeltas(cheap, balanced), "$100 cheaper · 20h 0m longer round-trip · 2 more connections");
  assert.equal(flightDeltas(fast, balanced), "$200 more · 4h 0m faster round-trip");
});

test("non-selected offer of an airport pair can become an alternative", () => {
  const result = buildFlightComparison([flightResult([balanced, cheap])])!;
  assert.equal(result.selected_offer, balanced);
  assert.equal(result.alternatives?.[0].offer, cheap);
});

test("duplicate journeys under different provider IDs are shown once", () => {
  const duplicate = { ...cheap, provider_offer_id: "different-id" };
  const result = buildFlightComparison([flightResult([balanced, cheap, duplicate])])!;
  assert.equal(result.alternatives?.length, 1);
  assert.equal(buildFlightComparison([flightResult([balanced, { ...balanced, provider_offer_id: "alias" }])])?.alternatives?.length, 0);
});

test("one journey winning both alternative categories has two distinctions on one card", () => {
  const tradeoff = flightOffer("both", 450, 480, 4);
  const result = buildFlightComparison([flightResult([balanced, tradeoff])])!;
  assert.equal(result.selected_offer, balanced);
  assert.equal(result.alternatives?.length, 1);
  assert.deepEqual(result.alternatives?.[0].distinctions, ["cheapest", "fastest"]);
});

test("insignificant savings and improvements are suppressed, including percentage threshold", () => {
  const offers = [balanced, flightOffer("small-saving", 480, 900), flightOffer("small-time", 600, 550)];
  assert.deepEqual(buildFlightComparison([flightResult(offers)])?.alternatives, []);
  assert.deepEqual(buildFlightComparison([flightResult([flightOffer("expensive", 2000, 600), flightOffer("discount", 1950, 1500)])])?.alternatives, []);
});

test("one offer narrows wording; dominating options do not create duplicate category cards", () => {
  assert.deepEqual(buildFlightComparison([flightResult([balanced])])?.alternatives, []);
  assert.match(buildFlightComparison([flightResult([balanced])])!.recommendation_reason!, /only usable/);
  assert.deepEqual(buildFlightComparison([flightResult([balanced, flightOffer("worse", 600, 900, 2)])])?.alternatives, []);
});

test("missing duration cannot beat complete recommendation or win fastest; partial deltas are hidden", () => {
  const partial = { ...flightOffer("partial", 300, 100), duration_complete: false, inbound: { ...balanced.inbound, duration_minutes: undefined } };
  const result = buildFlightComparison([flightResult([partial, balanced])])!;
  assert.equal(result.selected_offer, balanced);
  assert.deepEqual(result.alternatives?.map((a) => a.kind), ["cheapest"]);
  assert.equal(flightDeltas(partial, balanced), "$200 cheaper");
  assert.match(flightMetrics(partial), /Duration unavailable/);
  const incompleteStops = { ...partial, provider_offer_id: "another-partial", stops_complete: false, stop_count: 9 };
  assert.equal(flightDeltas(incompleteStops, balanced), "$200 cheaper");
  assert.match(buildFlightComparison([flightResult([partial, incompleteStops])])!.recommendation_reason!, /unavailable/);
});

test("estimates and legacy trips do not fabricate alternatives or reliable durations", () => {
  const estimated = { ...flightResult([cheap]), status: "unavailable" as const, offers: [] };
  assert.equal(buildFlightComparison([estimated]), null);
  assert.deepEqual(visibleFlightAlternatives(estimated), []);
  assert.deepEqual(visibleFlightAlternatives(flightResult([balanced])), []);
  assert.match(flightMetrics({ ...balanced, duration_complete: undefined, stops_complete: undefined }), /Duration unavailable.*Connections unavailable/);
});

test("provider ordering, route ordering, and completion ordering do not affect output or add calls", async () => {
  const expected = buildFlightComparison(pool());
  assert.deepEqual(buildFlightComparison(pool().reverse()), expected);
  const sameRoute = flightResult([balanced, cheap, fast]);
  assert.deepEqual(buildFlightComparison([sameRoute]), buildFlightComparison([{ ...sameRoute, offers: [...sameRoute.offers].reverse() }]));
  for (const reverse of [false, true]) {
    let calls = 0;
    const results = reverse ? pool().reverse() : pool();
    const inputs = results.map((r) => ({ origin: r.origin, destination: r.destination,
      departure_date: r.departure_date, return_date: r.return_date, traveler_count: 1 }));
    const actual = await searchFlightCandidates(inputs, async (input, nearby) => {
      calls++; assert.equal(nearby, false);
      if (input.origin === "AAA") await new Promise((resolve) => setTimeout(resolve, 5));
      return results.find((r) => r.origin === input.origin)!;
    });
    assert.equal(calls, 3);
    assert.deepEqual(actual, expected);
  }
});

test("itinerary normalization preserves additive comparison data and accepts old contracts", () => {
  const trip: TripData = { id: "test", destination: "Test", starting_location: "Origin", start_date: "2026-10-01", end_date: "2026-10-05",
    budget: 1000, budget_preference: "Balance", traveler_count: 1, traveler_profile: { interests: [], preferences: [], travel_style: "Balanced" } };
  for (const flight of [buildFlightComparison(pool())!, flightResult([balanced])]) {
    const itinerary = normalizeItinerary({ live_data: { flight_search: flight, weather: [], refreshed_at: "2026-09-01" } }, trip);
    assert.deepEqual(itinerary.live_data?.flight_search, flight);
  }
});

test("significance thresholds include exactly $25 and exactly 60 minutes", () => {
  const result = buildFlightComparison([flightResult([balanced, flightOffer("saving", 475, 1500), flightOffer("hour", 700, 540)])])!;
  assert.deepEqual(result.alternatives?.map((a) => a.kind), ["cheapest", "fastest"]);
});

test("a late successful route cannot change the returned recommendation or alternatives", { timeout: 2000 }, async () => {
  let finish!: (result: ReturnType<typeof flightResult>) => void;
  const pending = new Promise<ReturnType<typeof flightResult>>((resolve) => { finish = resolve; });
  const inputs = ["AAA", "CCC"].map((origin) => ({ origin, destination: "BBB", departure_date: "2026-10-01", return_date: "2026-10-05", traveler_count: 1 }));
  const result = await searchFlightCandidates(inputs, async (input) => input.origin === "AAA" ? flightResult([balanced]) : pending, 25);
  const before = JSON.stringify(result);
  finish(flightResult([cheap], "CCC"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(result), before);
  assert.deepEqual(result?.alternatives, []);
});
