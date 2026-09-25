import assert from "node:assert/strict";
import test from "node:test";
import { searchFlightCandidates } from "../../artifacts/api-server/src/lib/live-data";
import type { FlightSearchInput, FlightSearchResult } from "../../artifacts/api-server/src/lib/flights";
import { flightOffer, flightResult } from "./flight-fixtures";

const inputs: FlightSearchInput[] = ["A", "B", "C"].map((origin) => ({
  origin, destination: "D", departure_date: "2026-10-01", return_date: "2026-10-05", traveler_count: 1,
}));
function result(price: number, stops = 0, minutes = 60, status: FlightSearchResult["status"] = "live"): FlightSearchResult {
  return { ...flightResult([flightOffer(String(price), price, minutes, stops, "A", "D")], "A", "D"), status };
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
    return input.origin === "B" ? slow : { ...fast, origin: input.origin };
  }, 25);
  assert.equal(selected?.selected_offer, fast.selected_offer);
  assert.deepEqual(calls, ["A", "B", "C"]);
  // Late rejection is handled even after the comparison has returned.
  rejectSlow(new Error("late provider failure"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("completed live routes use price plus stops and duration scoring", async () => {
  const candidates = [result(100, 3, 600), result(180, 0, 60), result(170, 0, 180)];
  assert.equal((await searchFlightCandidates(inputs, async (input) => ({ ...candidates[inputs.indexOf(input)], origin: input.origin })))?.selected_offer, candidates[1].selected_offer);
});

test("score ties use stable route order rather than completion order", async () => {
  const first = result(200);
  const second = result(200);
  assert.equal((await searchFlightCandidates(inputs.slice(0, 2), async (input) => {
    if (input === inputs[0]) await new Promise((resolve) => setImmediate(resolve));
    return { ...(input === inputs[0] ? first : second), origin: input.origin };
  }))?.origin, "A");
});

test("synchronous and asynchronous candidate failures do not reject selection", async () => {
  const live = result(200);
  assert.equal((await searchFlightCandidates(inputs, (input) => {
    if (input.origin === "A") throw new Error("sync failure");
    if (input.origin === "B") return Promise.reject(new Error("async failure"));
    return Promise.resolve({ ...live, origin: input.origin });
  }))?.selected_offer, live.selected_offer);
});

test("deadline still invokes nearby fallback on the first input when no live result completes", { timeout: 2000 }, async () => {
  const nearbyResult = result(300, 0, 60, "unavailable");
  const nearbyInputs: FlightSearchInput[] = [];
  assert.equal(await searchFlightCandidates(inputs, async (input, nearby) => {
    if (!nearby) return new Promise<FlightSearchResult>(() => {});
    nearbyInputs.push(input);
    return nearbyResult;
  }, 25, 50), nearbyResult);
  assert.deepEqual(nearbyInputs, [inputs[0]]);
});

test("empty nearby fallback preserves the cheapest completed estimate", async () => {
  const estimates = [result(300, 0, 60, "unavailable"), result(200, 0, 60, "unavailable")];
  assert.equal(await searchFlightCandidates(inputs.slice(0, 2), async (input, nearby) =>
    nearby ? empty() : Object.assign(estimates[inputs.indexOf(input)], { origin: input.origin })), estimates[1]);
  assert.equal(await searchFlightCandidates(inputs, async () => empty()), null);
  assert.equal(await searchFlightCandidates([], async () => { throw new Error("must not search"); }), null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("grace reuses pending searches and ranks all grace results independent of arrival order", async () => {
  for (const order of [[0, 1, 2], [2, 1, 0]]) {
    const pending = inputs.map(() => deferred<FlightSearchResult>());
    const candidates = [result(500, 0, 600), result(400, 3, 1200), result(700, 0, 120)];
    const calls: string[] = [];
    const selection = searchFlightCandidates(inputs, async (input, nearby) => {
      assert.equal(nearby, false);
      calls.push(input.origin);
      return pending[inputs.indexOf(input)].promise;
    }, 20, 500);
    await delay(40); // All successes occur after the primary window.
    for (const index of order) {
      pending[index].resolve({ ...candidates[index], origin: inputs[index].origin });
      await new Promise((resolve) => setImmediate(resolve));
    }
    const selected = await selection;
    assert.equal(selected?.selected_offer, candidates[0].selected_offer);
    assert.deepEqual(selected?.alternatives?.map((alternative) => alternative.kind), ["cheapest", "fastest"]);
    assert.deepEqual(calls, ["A", "B", "C"]);
  }
});

test("a single live result during grace avoids fallback as soon as all requests settle", async () => {
  const pending = deferred<FlightSearchResult>();
  const selection = searchFlightCandidates(inputs.slice(0, 1), async (_, nearby) => {
    assert.equal(nearby, false);
    return pending.promise;
  }, 20, 500);
  await delay(40);
  pending.resolve(result(200));
  assert.equal((await selection)?.status, "live");
});

test("empty requests settling during grace trigger fallback immediately", async () => {
  const pending = deferred<FlightSearchResult>();
  let fallback = false;
  const selection = searchFlightCandidates(inputs.slice(0, 1), async (_, nearby) => {
    if (nearby) { fallback = true; return empty(); }
    return pending.promise;
  }, 20, 500);
  await delay(40);
  assert.equal(fallback, false);
  pending.resolve(empty());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fallback, true);
  assert.equal(await selection, null);
});

test("total deadline bounds grace and excludes late successes while fallback is pending", { timeout: 2000 }, async () => {
  const pending = deferred<FlightSearchResult>();
  const recheck = deferred<FlightSearchResult>();
  const fallbackStarted = deferred<void>();
  const calls: boolean[] = [];
  const selection = searchFlightCandidates(inputs.slice(0, 1), async (_, nearby) => {
    calls.push(Boolean(nearby));
    if (nearby) { fallbackStarted.resolve(); return recheck.promise; }
    return pending.promise;
  }, 20, 60);
  await fallbackStarted.promise;
  // The original provider may still cache its response, but this generation is closed.
  pending.resolve(result(100));
  await new Promise((resolve) => setImmediate(resolve));
  recheck.resolve(empty());
  assert.equal(await selection, null);
  assert.deepEqual(calls, [false, true]);
});

test("fallback recheck preserves live results and provider metadata", async () => {
  const live = result(200);
  const calls: boolean[] = [];
  const selected = await searchFlightCandidates(inputs.slice(0, 1), async (_, nearby) => {
    calls.push(Boolean(nearby));
    return nearby ? live : empty();
  });
  assert.equal(selected?.status, "live");
  assert.equal(selected?.selected_offer, live.selected_offer);
  assert.deepEqual(selected?.source_metadata, live.source_metadata);
  assert.deepEqual(calls, [false, true]);
});
