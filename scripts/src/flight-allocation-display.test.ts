import assert from "node:assert/strict";
import test from "node:test";
import { flightBudgetAllocation } from "../../artifacts/travel-optimizer/src/lib/flight-display";
import { flightOffer, flightResult } from "./flight-fixtures";
import type { BudgetItem } from "../../lib/api-client-react/src/generated/api.schemas";

const unavailable = { ...flightResult([]), status: "unavailable" as const, selected_offer: null };
const allocation: BudgetItem = { category: "Flights", estimated_amount: 588,
  description: "Round trip from New York, New York, United States",
  source_metadata: { label: "ESTIMATED", is_live: false, provider: "Kalyra", data_type: "budget_estimate", freshness: "estimated", retrieved_at: null } };

test("unavailable flight allocation uses the stored category amount without recalculation", () => {
  assert.equal(flightBudgetAllocation(unavailable, [allocation]), 588);
  assert.equal(flightBudgetAllocation(unavailable, [{ ...allocation, estimated_amount: 723 }]), 723);
  assert.equal(flightBudgetAllocation(unavailable, [{ ...allocation, estimated_amount: 0 }]), 0);
});

test("live and nearby-date provider prices are never labeled budget allocations", () => {
  const live = flightResult([flightOffer("live", 1914, 600)]);
  assert.equal(flightBudgetAllocation(live, [allocation]), null);
  assert.equal(flightBudgetAllocation({ ...live, status: "unavailable" }, [allocation]), null);
});

test("missing or invalid allocations and retained provider fares are not relabeled", () => {
  assert.equal(flightBudgetAllocation(unavailable, []), null);
  assert.equal(flightBudgetAllocation(undefined, [allocation]), null);
  for (const estimated_amount of [NaN, Infinity, -1]) {
    assert.equal(flightBudgetAllocation(unavailable, [{ ...allocation, estimated_amount }]), null);
  }
  for (const description of ["Round-trip fare for United; 0 stops.", "Estimated round-trip airfare based on live fares found for nearby travel dates."]) {
    assert.equal(flightBudgetAllocation(unavailable, [{ ...allocation, description }]), null);
  }
  assert.equal(flightBudgetAllocation(unavailable, [{ ...allocation, source_metadata: { ...allocation.source_metadata!, is_live: true } }]), null);
});
