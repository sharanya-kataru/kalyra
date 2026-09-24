import assert from "node:assert/strict";
import test from "node:test";
import { explainRouteSelection, scoreDestinationForTrip, type DecisionTrip, type DestinationDecisionScore } from "../../artifacts/api-server/src/lib/decision-engine";
import { DESTINATIONS } from "../../artifacts/api-server/src/lib/destinations";

const trip: DecisionTrip = {
  destination: "Test region", start_date: "2026-09-01", end_date: "2026-09-09",
  traveler_count: 2, budget: 5000, budget_preference: "Balance",
  traveler_profile: { interests: ["Food"], travel_style: "Balanced" },
};
const evidence: DestinationDecisionScore = {
  name: "Tokyo", found: true, confidence: "high", overall_score: 80, match_score: 80,
  interest_fit: 85, budget_fit: 88, pace_fit: 90, season_fit: 62, crowd_fit: 70,
  transport_fit: 70, uniqueness_fit: 60, matched_interests: ["Food", "Nature"],
  strengths: [], tradeoffs: [], explanation: "", avg_daily_cost_usd: 100,
};

test("different selected interests produce different grounded explanations", () => {
  const food = explainRouteSelection(evidence, trip);
  const nature = explainRouteSelection(evidence, { ...trip, traveler_profile: { ...trip.traveler_profile, interests: ["Nature"] } });
  assert.match(food, /prioritized food/);
  assert.doesNotMatch(food, /Nature/);
  assert.match(nature, /does not show a strong rating/);
  assert.notEqual(food, nature);
  assert.match(food, /\$5,000 trip budget and 2 travelers/);
  assert.match(food, /balanced pace and 8 nights/);
});

test("unmatched selected interests and free-form interests are not claimed", () => {
  const explanation = explainRouteSelection({ ...evidence, matched_interests: [] }, trip);
  assert.match(explanation, /prioritized food/);
  assert.doesNotMatch(explanation, /Your Food/);
  assert.doesNotMatch(explainRouteSelection(evidence, { ...trip,
    traveler_profile: { interests: ["Unmapped preference"], travel_style: "Balanced" } }), /Your Unmapped preference/);
});

test("missing and limited catalog data have safe fallbacks", () => {
  assert.equal(explainRouteSelection(undefined, trip), explainRouteSelection({ ...evidence, found: false, confidence: "limited" }, trip));
  assert.match(explainRouteSelection(undefined, trip), /could not be verified/);
});

test("formatter is destination-independent and works with actual catalog scoring", () => {
  assert.equal(explainRouteSelection(evidence, trip), explainRouteSelection({ ...evidence, name: "Kyoto" }, trip));
  for (const name of Object.keys(DESTINATIONS)) {
    const score = scoreDestinationForTrip(name, trip);
    const explanation = explainRouteSelection(score, trip);
    assert.equal(explanation.includes("prioritized food"), DESTINATIONS[name].food >= 70);
  }
});

test("weak factors are not described as strengths", () => {
  const explanation = explainRouteSelection({ ...evidence, budget_fit: 30, pace_fit: 40, season_fit: 62 }, trip);
  assert.doesNotMatch(explanation, /Budget fit|Pace fit|recommended season/);
});


test("small-town interest is explained through dimensions, never a literal destination claim", () => {
  const selected = { ...trip, traveler_profile: { ...trip.traveler_profile, interests: ["Small-town life"] } };
  for (const name of ["Tokyo", "Kyoto", "Paris"]) {
    const score = scoreDestinationForTrip(name, selected);
    const before = structuredClone(score);
    const explanation = explainRouteSelection(score, selected);
    assert.doesNotMatch(explanation, /small-town/i);
    assert.match(explanation, /culture/);
    assert.equal(explanation.includes("distinctive experiences"), name !== "Paris");
    assert.deepEqual(score, before);
  }
});

test("Japan example uses relevant catalog dimensions and preserves match data", () => {
  const selected = { ...trip, destination: "Japan", traveler_profile: {
    ...trip.traveler_profile, interests: ["Local food", "Architecture", "Small-town life"],
  } };
  for (const name of ["Tokyo", "Kyoto"]) {
    const score = scoreDestinationForTrip(name, selected);
    const text = explainRouteSelection(score, selected);
    assert.match(text, /culture, distinctive experiences, food/);
    assert.doesNotMatch(text, /Small-town life|Architecture/);
    assert.deepEqual(score.matched_interests, selected.traveler_profile.interests);
    console.log(`${name}: ${text}`);
  }
});
