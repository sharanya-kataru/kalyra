import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreDestinationForTrip,
  selectRouteCandidates,
  type DecisionTrip,
} from "../../artifacts/api-server/src/lib/decision-engine";

function trip(overrides: Partial<DecisionTrip> = {}): DecisionTrip {
  return {
    destination: "Italy and Switzerland",
    start_date: "2026-09-01",
    end_date: "2026-09-09",
    traveler_count: 2,
    budget: 5000,
    budget_preference: "Balance",
    traveler_profile: {
      interests: ["Nature", "Photography"],
      travel_style: "Balanced",
    },
    ...overrides,
  };
}

test("nature and photography travelers favor a scenic base over Milan", () => {
  const traveler = trip({ destination: "Italy", traveler_profile: { interests: ["Nature", "Photography"], travel_style: "Balanced" } });
  const scenic = scoreDestinationForTrip("Lake Como", traveler);
  const urban = scoreDestinationForTrip("Milan", traveler);
  assert.ok(scenic.overall_score > urban.overall_score);
  assert.ok(scenic.interest_fit > urban.interest_fit);
});

test("food and culture preferences produce a different ranking signal", () => {
  const traveler = trip({ destination: "Italy", traveler_profile: { interests: ["Food", "Culture"], travel_style: "Balanced" } });
  const florence = scoreDestinationForTrip("Florence", traveler);
  const lakeComo = scoreDestinationForTrip("Lake Como", traveler);
  assert.ok(florence.interest_fit > lakeComo.interest_fit);
  assert.notDeepEqual(
    scoreDestinationForTrip("Lake Como", trip()).matched_interests,
    lakeComo.matched_interests
  );
});

test("tight budget changes budget fit compared with a flexible budget", () => {
  const tight = trip({ budget: 1800, budget_preference: "Keep it lean" });
  const flexible = trip({ budget: 9000, budget_preference: "A few beautiful splurges" });
  const zermattTight = scoreDestinationForTrip("Zermatt", tight);
  const zermattFlexible = scoreDestinationForTrip("Zermatt", flexible);
  assert.ok(zermattFlexible.budget_fit > zermattTight.budget_fit);
  assert.ok(zermattFlexible.overall_score > zermattTight.overall_score);
});

test("slow travel selects fewer bases than fast travel", () => {
  const slow = selectRouteCandidates(trip({ traveler_profile: { interests: ["Nature"], travel_style: "Slow and unhurried" } }));
  const fast = selectRouteCandidates(trip({ traveler_profile: { interests: ["Nature"], travel_style: "Fast and active" } }));
  assert.ok(slow.base_count < fast.base_count);
  assert.equal(slow.candidates.length, slow.base_count);
  assert.equal(fast.candidates.length, fast.base_count);
});

test("Italy and Switzerland share one total base budget and preserve both countries", () => {
  const selection = selectRouteCandidates(trip());
  assert.ok(selection.candidates.length <= 3);
  assert.deepEqual(new Set(selection.candidates.map((candidate) => candidate.country)), new Set(["Italy", "Switzerland"]));
});

test("candidate ordering does not change an individual destination score", () => {
  const traveler = trip();
  const first = scoreDestinationForTrip("Milan", traveler);
  const second = scoreDestinationForTrip("Milan", { ...traveler, destination: "Switzerland" });
  assert.deepEqual(first, second);
});

test("same input produces the same selection and scores", () => {
  const traveler = trip();
  assert.deepEqual(selectRouteCandidates(traveler), selectRouteCandidates(traveler));
});

test("unknown destinations stay limited-confidence instead of receiving fabricated precision", () => {
  const result = scoreDestinationForTrip("Atlantis", trip({ destination: "Atlantis" }));
  assert.equal(result.found, false);
  assert.equal(result.confidence, "limited");
  assert.equal(result.overall_score, 50);
  assert.match(result.explanation, /limited-data/i);
});