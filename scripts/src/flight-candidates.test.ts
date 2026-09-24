import assert from "node:assert/strict";
import test from "node:test";
import { searchFlightCandidates } from "../../artifacts/api-server/src/lib/live-data";
import type { FlightSearchInput, FlightSearchResult } from "../../artifacts/api-server/src/lib/flights";
import { estimatedSource } from "../../artifacts/api-server/src/lib/sources";

const inputs: FlightSearchInput[] = ["A", "B", "C"].map((origin) => ({
  origin, destination: "D", departure_date: "2026-10-01", return_date: "2026-10-05", traveler_count: 1,
}));
function result(price: number, stops = 0, minutes = 60, status: FlightSearchResult["status"] = "live"): FlightSearchResult {
  const source_metadata = estimatedSource("test");
  return {
    ...inputs[0], status, offers: [], source_metadata,
    selected_offer: {
      provider_offer_id: String(price), total_price_usd: price, stop_count: stops,
      total_duration_minutes: minutes, outbound: { segments: [] }, inbound: { segments: [] },
      carriers: [], departure_datetime: null, arrival_datetime: null, source_metadata,
    },
  };
}
const empty = (): FlightSearchResult => ({ ...result(0, 0, 0, "unavailable"), selected_offer: null });

test("deadline selects a fast live result while a candidate is still pending", { timeout: 2000 }, async () => {
  const fast = result(200);
  let rejectSlow!: (error: Error) => void;
  const slow = new Promise<FlightSearchResult>((_, reject) => { rejectSlow = reject; });
  const calls: string[] = [];
  const selected = await searchFlightCandidates(inputs, async (input, nearby) => {
    assert.equal(nearby, false);
    calls.push(input.origin);
    return input.origin === "B" ? slow : fast;
  }, 25);
  assert.equal(selected, fast);
  assert.deepEqual(calls, ["A", "B", "C"]);
  // Late rejection is handled even after the comparison has returned.
  rejectSlow(new Error("late provider failure"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("completed live routes use price plus stops and duration scoring", async () => {
  const candidates = [result(100, 3, 600), result(180, 0, 60), result(170, 0, 180)];
  assert.equal(await searchFlightCandidates(inputs, async (input) => candidates[inputs.indexOf(input)]), candidates[1]);
});

test("score ties retain input order rather than completion order", async () => {
  const first = result(200);
  const second = result(200);
  assert.equal(await searchFlightCandidates(inputs.slice(0, 2), async (input) => {
    if (input === inputs[0]) await new Promise((resolve) => setImmediate(resolve));
    return input === inputs[0] ? first : second;
  }), first);
});

test("synchronous and asynchronous candidate failures do not reject selection", async () => {
  const live = result(200);
  assert.equal(await searchFlightCandidates(inputs, (input) => {
    if (input.origin === "A") throw new Error("sync failure");
    if (input.origin === "B") return Promise.reject(new Error("async failure"));
    return Promise.resolve(live);
  }), live);
});

test("deadline still invokes nearby fallback on the first input when no live result completes", { timeout: 2000 }, async () => {
  const nearbyResult = result(300, 0, 60, "unavailable");
  const nearbyInputs: FlightSearchInput[] = [];
  assert.equal(await searchFlightCandidates(inputs, async (input, nearby) => {
    if (!nearby) return new Promise<FlightSearchResult>(() => {});
    nearbyInputs.push(input);
    return nearbyResult;
  }, 25), nearbyResult);
  assert.deepEqual(nearbyInputs, [inputs[0]]);
});

test("empty nearby fallback preserves the cheapest completed estimate", async () => {
  const estimates = [result(300, 0, 60, "unavailable"), result(200, 0, 60, "unavailable")];
  assert.equal(await searchFlightCandidates(inputs.slice(0, 2), async (input, nearby) =>
    nearby ? empty() : estimates[inputs.indexOf(input)]), estimates[1]);
  assert.equal(await searchFlightCandidates(inputs, async () => empty()), null);
  assert.equal(await searchFlightCandidates([], async () => { throw new Error("must not search"); }), null);
});
