import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, tripsTable, usersTable, itinerariesTable, tripModificationsTable } from "@workspace/db";
import app from "../../artifacts/api-server/src/app";

const createdEmails: string[] = [];
const createdTripIds: string[] = [];

function uniqueEmail(label: string): string {
  const email = `stage2-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  createdEmails.push(email);
  return email;
}

function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
}

async function listen(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function signup(baseUrl: string, email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "demo-password-1",
    }),
  });

  assert.equal(res.status, 201);
  return cookieFrom(res);
}

function tripBody(destination: string) {
  return {
    destination,
    starting_location: "Boston, MA, United States",
    start_date: "2026-10-01",
    end_date: "2026-10-08",
    traveler_count: 1,
    budget: 2500,
    budget_preference: "Balance",
    traveler_profile: {
      interests: ["Food"],
      optimization_mode: "stay_local",
      travel_style: "Balanced",
      preferences: [],
    },
  };
}

async function createTrip(
  baseUrl: string,
  destination: string,
  cookie?: string,
): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (cookie) headers.cookie = cookie;

  const res = await fetch(`${baseUrl}/api/trips`, {
    method: "POST",
    headers,
    body: JSON.stringify(tripBody(destination)),
  });

  assert.equal(res.status, 201);

  const body = await res.json() as { id: string };
  createdTripIds.push(body.id);
  return body.id;
}

async function cleanup(): Promise<void> {
  for (const tripId of createdTripIds) {
    await db.delete(tripModificationsTable).where(eq(tripModificationsTable.tripId, tripId));
    await db.delete(itinerariesTable).where(eq(itinerariesTable.tripId, tripId));
    await db.delete(tripsTable).where(eq(tripsTable.id, tripId));
  }

  for (const email of createdEmails) {
    await db.delete(usersTable).where(eq(usersTable.email, email));
  }
}

test("trip ownership, anonymous access, saving, and listing", async (t) => {
  t.after(cleanup);

  const { baseUrl, close } = await listen();
  t.after(close);

  const userAEmail = uniqueEmail("a");
  const userBEmail = uniqueEmail("b");

  const userACookie = await signup(baseUrl, userAEmail);
  const userBCookie = await signup(baseUrl, userBEmail);

  // Anonymous trips remain anonymously accessible.
  const anonymousTripId = await createTrip(baseUrl, "Portugal");

  const anonymousFetch = await fetch(`${baseUrl}/api/trips/${anonymousTripId}`);
  assert.equal(anonymousFetch.status, 200);

  // Logged-in creation automatically belongs to that user.
  const ownedTripId = await createTrip(baseUrl, "Japan", userACookie);

  const [storedOwnedTrip] = await db
    .select({ userId: tripsTable.userId })
    .from(tripsTable)
    .where(eq(tripsTable.id, ownedTripId))
    .limit(1);

  assert.ok(storedOwnedTrip?.userId);

  // Owner can access their trip.
  const ownerFetch = await fetch(`${baseUrl}/api/trips/${ownedTripId}`, {
    headers: { cookie: userACookie },
  });
  assert.equal(ownerFetch.status, 200);
  assert.equal((await ownerFetch.json() as { traveler_profile: { optimization_mode?: string } }).traveler_profile.optimization_mode, "stay_local");

  // Owned trips are hidden without authentication.
  const noSessionFetch = await fetch(`${baseUrl}/api/trips/${ownedTripId}`);
  assert.equal(noSessionFetch.status, 404);

  // Other users cannot access owned trips.
  const otherUserFetch = await fetch(`${baseUrl}/api/trips/${ownedTripId}`, {
    headers: { cookie: userBCookie },
  });
  assert.equal(otherUserFetch.status, 404);

  // User A can claim an anonymous trip.
  const save = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/save`, {
    method: "POST",
    headers: { cookie: userACookie },
  });
  assert.equal(save.status, 200);
  const reopened = await fetch(`${baseUrl}/api/trips/${anonymousTripId}`, { headers: { cookie: userACookie } });
  assert.equal((await reopened.json() as { traveler_profile: { optimization_mode?: string } }).traveler_profile.optimization_mode, "stay_local");

  const [savedTrip] = await db
    .select({ userId: tripsTable.userId })
    .from(tripsTable)
    .where(eq(tripsTable.id, anonymousTripId))
    .limit(1);

  assert.equal(savedTrip?.userId, storedOwnedTrip?.userId);

  await t.test("refine and date regeneration retain the persisted daily planning mode", async () => {
    const geo = process.env.GEOAPIFY_API_KEY, ignav = process.env.IGNAV_API_KEY;
    delete process.env.GEOAPIFY_API_KEY;
    delete process.env.IGNAV_API_KEY;
    try {
      const generated = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/generate`, { method: "POST", headers: { cookie: userACookie } });
      assert.equal(generated.status, 200);
      for (const user_request of ["Slow down day 3", "Change dates to 2026-10-02 to 2026-10-09"]) {
        const modified = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/modify`, { method: "POST", headers: { cookie: userACookie, "content-type": "application/json" }, body: JSON.stringify({ user_request }) });
        assert.equal(modified.status, 200);
        const modification = await modified.json() as { itinerary: { id: string; version: number; daily_itinerary: Array<{ day: number; morning: { activity: string } }> } };
        if (user_request === "Slow down day 3") {
          assert.equal(modification.itinerary.version, 2);
          assert.match(modification.itinerary.daily_itinerary.find((day) => day.day === 3)!.morning.activity, /Slow morning/);
          const [persisted] = await db.select().from(itinerariesTable).where(eq(itinerariesTable.id, modification.itinerary.id));
          assert.deepEqual(persisted.dailyItinerary, modification.itinerary.daily_itinerary);
        }
        const response = await fetch(`${baseUrl}/api/trips/${anonymousTripId}`, { headers: { cookie: userACookie } });
        const body = await response.json() as { traveler_profile: { optimization_mode?: string }; latest_itinerary: { trip_strategy: string } };
        assert.equal(body.traveler_profile.optimization_mode, "stay_local");
        assert.match(body.latest_itinerary.trip_strategy, /stronger weight to geographic grouping/);
      }
      for (let days = 7; days >= 2; days--) {
        const shortened = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/modify`, { method: "POST", headers: { cookie: userACookie, "content-type": "application/json" }, body: JSON.stringify({ user_request: "Reduce travel days" }) });
        assert.equal(shortened.status, 200);
        const result = await shortened.json() as { itinerary: { id: string; total_days: number; total_nights: number; daily_itinerary: Array<{ date: string; transportation: { mode: string } }> } };
        assert.equal(result.itinerary.total_days, days);
        assert.equal(result.itinerary.total_nights, days - 1);
        assert.equal(result.itinerary.daily_itinerary.length, days);
        assert.match(result.itinerary.daily_itinerary.at(-1)!.transportation.mode, /^Depart from/);
        const reopened = await fetch(`${baseUrl}/api/trips/${anonymousTripId}`, { headers: { cookie: userACookie } });
        const saved = await reopened.json() as { end_date: string; latest_itinerary: { id: string; total_days: number } };
        assert.equal(saved.end_date, result.itinerary.daily_itinerary.at(-1)!.date);
        assert.equal(saved.latest_itinerary.id, result.itinerary.id);
        assert.equal(saved.latest_itinerary.total_days, days);
      }
      const minimum = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/modify`, { method: "POST", headers: { cookie: userACookie, "content-type": "application/json" }, body: JSON.stringify({ user_request: "Reduce travel days" }) });
      assert.equal(minimum.status, 400);
    } finally {
      if (geo !== undefined) process.env.GEOAPIFY_API_KEY = geo;
      if (ignav !== undefined) process.env.IGNAV_API_KEY = ignav;
    }
  });

  // Saving again as the same owner is idempotent.
  const saveAgain = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/save`, {
    method: "POST",
    headers: { cookie: userACookie },
  });
  assert.equal(saveAgain.status, 200);

  // User B cannot claim User A's saved trip.
  const stealAttempt = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/save`, {
    method: "POST",
    headers: { cookie: userBCookie },
  });
  assert.equal(stealAttempt.status, 404);

  // Saving requires authentication.
  const unauthenticatedSave = await fetch(`${baseUrl}/api/trips/${anonymousTripId}/save`, {
    method: "POST",
  });
  assert.equal(unauthenticatedSave.status, 401);

  // My Trips contains User A's trips.
  const userAList = await fetch(`${baseUrl}/api/trips`, {
    headers: { cookie: userACookie },
  });
  assert.equal(userAList.status, 200);

  const userATrips = await userAList.json() as Array<{ id: string }>;
  const userAIds = userATrips.map((trip) => trip.id);

  assert.ok(userAIds.includes(ownedTripId));
  assert.ok(userAIds.includes(anonymousTripId));

  // User B's list must not expose User A's trips.
  const userBList = await fetch(`${baseUrl}/api/trips`, {
    headers: { cookie: userBCookie },
  });
  assert.equal(userBList.status, 200);

  const userBTrips = await userBList.json() as Array<{ id: string }>;
  const userBIds = userBTrips.map((trip) => trip.id);

  assert.equal(userBIds.includes(ownedTripId), false);
  assert.equal(userBIds.includes(anonymousTripId), false);

  // My Trips itself requires authentication.
  const anonymousList = await fetch(`${baseUrl}/api/trips`);
  assert.equal(anonymousList.status, 401);

  await t.test("owner-only deletion rejects anonymous, other-account, and missing targets", async () => {
    const anonymousId = await createTrip(baseUrl, "Delete anonymous test");
    assert.equal((await fetch(`${baseUrl}/api/trips/${ownedTripId}`, { method: "DELETE" })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/trips/${ownedTripId}`, { method: "DELETE", headers: { cookie: userBCookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/trips/${anonymousId}`, { method: "DELETE", headers: { cookie: userACookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/trips/00000000-0000-4000-8000-000000000000`, { method: "DELETE", headers: { cookie: userACookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/trips/${anonymousId}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/trips/${ownedTripId}`, { headers: { cookie: userACookie } })).status, 200);
  });

  const versions = await db.insert(itinerariesTable).values([1, 2].map((version) => ({
    tripId: ownedTripId, tripStrategy: "Test", route: [], destinations: [], dailySchedule: [],
    budgetBreakdown: {}, reasoning: "Test", tradeoffs: [], version,
  }))).returning();
  await db.insert(tripModificationsTable).values({ tripId: ownedTripId, userRequest: "Test refinement",
    previousItineraryId: versions[0].id, updatedItineraryId: versions[1].id, changesMade: [], reasoning: "Test" });

  await t.test("failure after child deletion rolls the whole database transaction back", async (subtest) => {
    const originalTransaction = db.transaction.bind(db);
    // Inject a failure at the final delete while using a real PostgreSQL transaction.
    const mock = subtest.mock.method(db, "transaction", (callback: Parameters<typeof db.transaction>[0]) =>
      originalTransaction(async (tx) => {
        const originalDelete = tx.delete.bind(tx);
        subtest.mock.method(tx, "delete", (table: Parameters<typeof tx.delete>[0]) => {
          if (table === tripsTable) throw new Error("Injected deletion failure");
          return originalDelete(table);
        });
        return callback(tx);
      }));
    try {
      assert.equal((await fetch(`${baseUrl}/api/trips/${ownedTripId}`, { method: "DELETE", headers: { cookie: userACookie } })).status, 500);
    } finally { mock.mock.restore(); }
    assert.equal((await db.select().from(tripsTable).where(eq(tripsTable.id, ownedTripId))).length, 1);
    assert.equal((await db.select().from(itinerariesTable).where(eq(itinerariesTable.tripId, ownedTripId))).length, 2);
    assert.equal((await db.select().from(tripModificationsTable).where(eq(tripModificationsTable.tripId, ownedTripId))).length, 1);
  });

  await t.test("owner deletes all versions/history, receives 204, and cannot reopen or list the trip", async () => {
    const response = await fetch(`${baseUrl}/api/trips/${ownedTripId}`, { method: "DELETE", headers: { cookie: userACookie } });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal((await fetch(`${baseUrl}/api/trips/${ownedTripId}`, { headers: { cookie: userACookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/trips/${ownedTripId}`)).status, 404);
    const list = await (await fetch(`${baseUrl}/api/trips`, { headers: { cookie: userACookie } })).json() as Array<{ id: string }>;
    assert.equal(list.some((trip) => trip.id === ownedTripId), false);
    assert.equal(list.some((trip) => trip.id === anonymousTripId), true);
    assert.equal((await db.select().from(itinerariesTable).where(eq(itinerariesTable.tripId, ownedTripId))).length, 0);
    assert.equal((await db.select().from(tripModificationsTable).where(eq(tripModificationsTable.tripId, ownedTripId))).length, 0);
    assert.equal((await fetch(`${baseUrl}/api/trips/${anonymousTripId}`, { headers: { cookie: userACookie } })).status, 200);
  });

});
