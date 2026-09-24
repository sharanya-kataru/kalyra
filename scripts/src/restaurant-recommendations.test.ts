import assert from "node:assert/strict";
import test from "node:test";
import { distributeRestaurants } from "../../artifacts/api-server/src/lib/restaurant-recommendations";

test("multiple days receive distinct restaurants when enough exist", () => {
  const names = Array.from({ length: 9 }, (_, i) => `Restaurant ${i + 1}`);
  const result = distributeRestaurants(["A", "A", "A"], new Map([["A", names]]));
  assert.deepEqual(result, [names.slice(0, 3), names.slice(3, 6), names.slice(6, 9)]);
  assert.equal(new Set(result.flat()).size, 9);
  assert.deepEqual(distributeRestaurants(["A", "A", "A"], new Map([["A", names.slice(0, 4)]])),
    [["Restaurant 1"], ["Restaurant 2"], ["Restaurant 3"]]);
});

test("multi-city days use only their location's pool, including return visits", () => {
  assert.deepEqual(distributeRestaurants(["A", "B", "A"], new Map([
    ["A", ["A1", "A2"]], ["B", ["B1", "B2", "B3"]],
  ])), [["A1"], ["B1", "B2", "B3"], ["A2"]]);
});

test("insufficient results wrap gracefully after deduplicating names", () => {
  assert.deepEqual(distributeRestaurants(["A", "A", "A"], new Map([
    ["A", [" First  restaurant ", "first restaurant", "", "Second restaurant"]],
  ])), [["First restaurant"], ["Second restaurant"], ["First restaurant"]]);
  assert.deepEqual(distributeRestaurants(["A", "A"], new Map([["A", ["Only restaurant"]]])),
    [["Only restaurant"], ["Only restaurant"]]);
});

test("zero results and missing locations produce empty arrays", () => {
  assert.deepEqual(distributeRestaurants(["A", "B"], new Map([["A", []]])), [[], []]);
  assert.deepEqual(distributeRestaurants(["A"], new Map([["A", [" "]]])), [[]]);
  assert.deepEqual(distributeRestaurants([], new Map()), []);
});

test("identical inputs produce identical recommendations without mutating inputs", () => {
  const locations = ["A", "A", "B"];
  const pools = new Map([["A", ["Z", "Y", "X"]], ["B", ["Q"]]]);
  const original = structuredClone(pools);
  assert.deepEqual(distributeRestaurants(locations, pools), distributeRestaurants(locations, pools));
  assert.deepEqual(pools, original);
  assert.deepEqual(locations, ["A", "A", "B"]);
});
