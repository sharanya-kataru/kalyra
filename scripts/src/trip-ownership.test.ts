import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, tripsTable, usersTable } from "@workspace/db";
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

  const [savedTrip] = await db
    .select({ userId: tripsTable.userId })
    .from(tripsTable)
    .where(eq(tripsTable.id, anonymousTripId))
    .limit(1);

  assert.equal(savedTrip?.userId, storedOwnedTrip?.userId);

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
});
