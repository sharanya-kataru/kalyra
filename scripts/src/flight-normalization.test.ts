import assert from "node:assert/strict";
import test from "node:test";
import { searchFlights } from "../../artifacts/api-server/src/lib/flights";

const segment = (origin: string, destination: string) => ({ departure_airport: origin, arrival_airport: destination,
  departure_time_local: "2026-10-01T10:00:00", arrival_time_local: "2026-10-01T12:00:00",
  marketing_carrier_code: "XX", flight_number: "123", duration_minutes: 120 });
test("Ignav normalization preserves current party-total semantics and tracks incomplete metrics", async () => {
  const oldFetch = globalThis.fetch, oldKey = process.env.IGNAV_API_KEY;
  process.env.IGNAV_API_KEY = "test-only";
  let calls = 0;
  const raw = (id: string, amount: unknown = 1000) => ({ ignav_id: id, price: { amount, currency: "USD" },
    outbound: { duration_minutes: 180 as unknown, segments: [segment("AAA", "BBB")] as unknown[] },
    inbound: { duration_minutes: 240 as unknown, segments: [segment("BBB", "AAA")] as unknown[] } });
  const missing = raw("missing"); missing.inbound.duration_minutes = null;
  const malformed = raw("malformed"); malformed.outbound.segments.push({ departure_airport: "BBB" });
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).adults, 3);
    return Response.json({ itineraries: [raw("complete"), missing, malformed, raw("null-price", null), raw("empty-price", "")] });
  };
  try {
    const result = await searchFlights({ origin: "AAA", destination: "BBB", departure_date: "2026-10-01", return_date: "2026-10-05", traveler_count: 3 }, false);
    assert.equal(calls, 1);
    const complete = result.offers.find((o) => o.provider_offer_id === "complete")!;
    // Existing app contract: returned amount is party total, not multiplied by adults.
    assert.equal(complete.total_price_usd, 1000);
    assert.equal(complete.total_price_usd / 3, 1000 / 3);
    assert.equal(complete.total_duration_minutes, 420);
    assert.equal(complete.duration_complete, true);
    assert.equal(complete.stops_complete, true);
    const partial = result.offers.find((o) => o.provider_offer_id === "missing")!;
    assert.equal(partial.total_duration_minutes, null);
    assert.equal(partial.duration_complete, false);
    assert.equal(result.offers.find((o) => o.provider_offer_id === "malformed")?.stops_complete, false);
    assert.equal(result.selected_offer?.provider_offer_id, "complete");
    assert.equal(result.offers.length, 3);
    await searchFlights({ origin: "AAA", destination: "BBB", departure_date: "2026-10-01", return_date: "2026-10-05", traveler_count: 3 }, false);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.IGNAV_API_KEY; else process.env.IGNAV_API_KEY = oldKey; }
});

test("nearby-date normalization preserves the existing estimate without alternatives or extra searches", async () => {
  const oldFetch = globalThis.fetch, oldKey = process.env.IGNAV_API_KEY;
  process.env.IGNAV_API_KEY = "test-only";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const input = JSON.parse(String(init?.body));
    if (input.departure_date === "2026-11-10") return Response.json({ itineraries: [] });
    return Response.json({ itineraries: [{ ignav_id: input.departure_date, price: { amount: 800, currency: "USD" },
      outbound: { duration_minutes: 180, segments: [segment("EEE", "FFF")] },
      inbound: { duration_minutes: 240, segments: [segment("FFF", "EEE")] } }] });
  };
  try {
    const result = await searchFlights({ origin: "EEE", destination: "FFF", departure_date: "2026-11-10", return_date: "2026-11-14", traveler_count: 2 }, true);
    assert.equal(calls, 7); // Existing exact request plus six nearby-date requests.
    assert.equal(result.status, "unavailable");
    assert.equal(result.selected_offer?.total_price_usd, 800);
    assert.equal(result.selected_offer?.total_duration_minutes, null);
    assert.equal(result.alternatives, undefined);
    assert.deepEqual(result.offers, []);
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.IGNAV_API_KEY; else process.env.IGNAV_API_KEY = oldKey; }
});
