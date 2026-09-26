/// <reference lib="dom" />
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, pool, tripsTable, itinerariesTable, tripModificationsTable } from "@workspace/db";
import { createTrip, generateItinerary, getTrip, modifyItinerary } from "../../lib/api-client-react/src/generated/api";
import { setBaseUrl } from "../../lib/api-client-react/src/custom-fetch";

// Exercise the executable used by `api-server start`, not a source-only app import.
// Build the API before running this test. External providers are disabled so the
// persisted/versioned refinement contract does not depend on live availability.
test("built API shortens a generated six-day trip through the browser client and persists it", async (t) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const server = spawn(process.execPath, [fileURLToPath(new URL("../../artifacts/api-server/dist/index.mjs", import.meta.url))], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "production", GEOAPIFY_API_KEY: "", IGNAV_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  const ids: string[] = [];
  t.after(async () => {
    setBaseUrl(null);
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    for (const id of ids) {
      await db.delete(tripModificationsTable).where(eq(tripModificationsTable.tripId, id));
      await db.delete(itinerariesTable).where(eq(itinerariesTable.tripId, id));
      await db.delete(tripsTable).where(eq(tripsTable.id, id));
    }
    await pool.end();
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, output);
    try { ready = (await fetch(`${baseUrl}/api/healthz`)).ok; } catch { /* Server is starting. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  setBaseUrl(baseUrl);

  for (const removeFirst of [false, true]) {
    await t.test(removeFirst ? "saved trip after destination removal" : "newly generated trip", async () => {
      const trip = await createTrip({
        destination: "Portugal coast", starting_location: "Boston, MA, United States",
        start_date: "2026-12-21", end_date: "2026-12-26", traveler_count: 2,
        budget: 1600, budget_preference: "Balance",
        traveler_profile: { interests: ["Photography"], preferences: [], travel_style: "Balanced" },
      });
      ids.push(trip.id);
      let before = await generateItinerary(trip.id);
      if (removeFirst) {
        const removed = await modifyItinerary(trip.id, { user_request: "Remove a destination" });
        assert.equal(removed.itinerary.total_days, 6);
        assert.equal(removed.itinerary.daily_itinerary.length, 6);
        assert.equal((await getTrip(trip.id)).end_date, "2026-12-26");
        before = (await getTrip(trip.id)).latest_itinerary!;
      }
      assert.equal(before.total_days, 6);

      // Identical client and payload to useModifyItinerary / handleChatSubmit.
      const result = await modifyItinerary(trip.id, { user_request: "Reduce travel days" });
      const after = result.itinerary;
      assert.equal(after.version, before.version + 1);
      assert.equal(after.total_days, 5);
      assert.equal(after.total_nights, 4);
      assert.deepEqual(after.daily_itinerary.map((day) => day.day), [1, 2, 3, 4, 5]);
      assert.equal(after.daily_schedule.length, 5);
      assert.equal(after.daily_itinerary[0].date, "2026-12-21");
      assert.equal(after.daily_itinerary.at(-1)!.date, "2026-12-25");
      assert.match(after.daily_itinerary.at(-1)!.transportation.mode, /^Depart from/);
      assert.match(after.trip_strategy, /5-day/);
      assert.equal(after.route.reduce((sum, stop) => sum + stop.nights, 0), 4);
      assert.deepEqual(after.destinations.map((dest) => dest.name), after.route.map((stop) => stop.location));
      assert.deepEqual(after.health_score, result.score_after);
      assert.deepEqual(before.health_score, result.score_before);
      assert.match(result.reasoning, /Shortened the trip by one day/);

      const reopened = await getTrip(trip.id);
      assert.equal(reopened.start_date, "2026-12-21");
      assert.equal(reopened.end_date, "2026-12-25");
      assert.deepEqual(reopened.latest_itinerary, after);
      const [stored] = await db.select().from(itinerariesTable).where(eq(itinerariesTable.id, after.id));
      assert.equal(stored.totalDays, 5);
      assert.equal(stored.totalNights, 4);
      assert.equal(stored.version, before.version + 1);
      assert.deepEqual(stored.dailyItinerary, after.daily_itinerary);
      assert.deepEqual(stored.dailySchedule, after.daily_schedule);
      assert.deepEqual(stored.route, after.route);
      assert.deepEqual(stored.budgetSummary, after.budget_summary);
      const [history] = await db.select().from(tripModificationsTable).where(eq(tripModificationsTable.updatedItineraryId, after.id));
      assert.equal(history.previousItineraryId, before.id);
      assert.equal(history.userRequest, "Reduce travel days");
      assert.deepEqual(history.changesMade, result.changes_made);
      assert.equal(history.reasoning, result.reasoning);
    });
  }
});
