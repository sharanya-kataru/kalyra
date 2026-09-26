import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getPlacesProvider, discoverNearbyAirports, resolveLocation } from "../../artifacts/api-server/src/lib/places";
import { searchFlights, type FlightSearchInput } from "../../artifacts/api-server/src/lib/flights";

function key(t: TestContext, name: string) {
  const previous = process.env[name];
  process.env[name] = t.name;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
}
const flight: FlightSearchInput = { origin: "XYZ", destination: "ABC", departure_date: "2026-12-21", return_date: "2026-12-26", traveler_count: 2 };

test("flight cache shares concurrent equivalent requests, isolates dates, expires failures, and preserves nearby fallback", async (t) => {
  key(t, "IGNAV_API_KEY");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ itineraries: [] }); });
  await Promise.all([
    searchFlights(flight, false),
    searchFlights({ ...flight, origin: " xyz ", cabin_class: "economy", market: "US", currency: "USD" }, false),
  ]);
  assert.equal(calls, 1);
  await searchFlights(flight, false);
  assert.equal(calls, 1);
  await searchFlights({ ...flight, return_date: "2026-12-25" }, false);
  assert.equal(calls, 2, "changed return dates must requery exact fares");
  await searchFlights(flight, true);
  assert.equal(calls, 9, "an exact negative cache entry must not suppress nearby estimates");
  now += 60_001;
  await searchFlights(flight, false);
  assert.equal(calls, 10);
});

test("only explicit unsupported-airport responses are reused across dates and routes", async (t) => {
  key(t, "IGNAV_API_KEY");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    const input = JSON.parse(String(init?.body));
    return Response.json({ error: { code: input.origin === "XYZ" ? "invalid_airport_code" : "invalid_request", field: "origin" } }, { status: 400 });
  });
  await searchFlights(flight, false);
  await searchFlights({ ...flight, destination: "DEF", return_date: "2026-12-25" }, false);
  assert.equal(calls, 1);
  await searchFlights({ ...flight, origin: "GHI" }, false);
  await searchFlights({ ...flight, origin: "GHI", return_date: "2026-12-25" }, false);
  assert.equal(calls, 3, "generic bad requests must not blacklist airports");
  now += 6 * 60 * 60 * 1000 + 1;
  await searchFlights(flight, false);
  assert.equal(calls, 4, "provider support is periodically rechecked");
});

test("place cache survives provider lookups and concurrent geocoding is shared", async (t) => {
  key(t, "GEOAPIFY_API_KEY");
  let geocodes = 0, searches = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("geocode")) {
      geocodes++;
      return Response.json({ features: [{ geometry: { coordinates: [20, 10] }, properties: { lat: 10, lon: 20 } }] });
    }
    searches++;
    return Response.json({ features: [{ properties: { name: "Cafe", lat: 10, lon: 20 } }] });
  });
  await Promise.all([resolveLocation("Cache fixture"), resolveLocation(" cache fixture ")]);
  assert.equal(geocodes, 1);
  const first = await getPlacesProvider()!.search_restaurants("Cache fixture", 10);
  assert.deepEqual(await getPlacesProvider()!.search_restaurants("Cache fixture", 10), first);
  assert.equal(searches, 1);
});

test("airport discovery avoids overlapping detail lookups and expands only when necessary", async (t) => {
  key(t, "GEOAPIFY_API_KEY");
  let radii = 0, details = 0;
  const feature = (id: string, iata?: string) => ({ properties: { place_id: id, name: id, categories: ["airport"], lat: 10, lon: 20, distance: 1000, iata } });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("place-details")) {
      details++;
      return Response.json({ properties: {} }); // no IATA; repeated in both radius responses
    }
    radii++;
    return Response.json({ features: [feature("no-code"), feature("one", "AAA"), feature("two", "BBB")] });
  });
  const location = { query: "Airport cache fixture", lat: 10, lon: 20, source: "Geoapify" as const };
  const nearest = await discoverNearbyAirports(location, 2);
  assert.equal(nearest.length, 2);
  assert.equal(radii, 1, "the farther radius cannot improve two nearer candidates");
  assert.equal(details, 1);
  await discoverNearbyAirports(location, 2);
  assert.equal(radii, 1);
  await discoverNearbyAirports({ ...location, query: "Airport expansion fixture" }, 3);
  assert.equal(radii, 3, "both radii are searched if too few candidates exist");
  assert.equal(details, 2, "missing metadata is looked up once across overlapping radii");
});
