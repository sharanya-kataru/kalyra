import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";
import app from "../../artifacts/api-server/src/app";
import { SESSION_COOKIE_NAME } from "../../artifacts/api-server/src/lib/session";

const createdEmails: string[] = [];

function uniqueEmail(): string {
  const email = `stage1-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  createdEmails.push(email);
  return email;
}

function cookieFrom(res: Response): string {
  const parts = res.headers.getSetCookie().map((header) => header.split(";")[0]);
  return parts.join("; ");
}

function sessionSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((header) => header.startsWith(`${SESSION_COOKIE_NAME}=`));
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

async function cleanup(): Promise<void> {
  for (const email of createdEmails) {
    await db.delete(usersTable).where(eq(usersTable.email, email));
  }
}

test("signup, session cookie, me, logout, and login", async (t) => {
  t.after(cleanup);
  const { baseUrl, close } = await listen();
  t.after(close);

  const email = uniqueEmail();
  const password = "demo-password-1";

  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signup.status, 201);
  const signupBody = await signup.json() as { id: string; email: string };
  assert.equal(signupBody.email, email);
  assert.ok(signupBody.id);
  assert.equal("password" in signupBody, false);
  assert.equal("password_hash" in signupBody, false);
  assert.equal("passwordHash" in signupBody, false);

  const setCookie = sessionSetCookie(signup);
  assert.ok(setCookie, "signup must set an httpOnly session cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.doesNotMatch(JSON.stringify(signupBody), new RegExp(setCookie.split(";")[0].split("=")[1] ?? "no-token"));

  const cookie = cookieFrom(signup);
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { id: signupBody.id, email });

  const unauth = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(unauth.status, 401);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(logout.status, 204);
  const afterLogout = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  assert.equal(afterLogout.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.toUpperCase(), password }),
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json() as { id: string; email: string };
  assert.equal(loginBody.id, signupBody.id);
  assert.equal(loginBody.email, email);
  const loginCookie = sessionSetCookie(login);
  assert.ok(loginCookie);
  assert.match(loginCookie, /HttpOnly/i);

  const meAfterLogin = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: cookieFrom(login) },
  });
  assert.equal(meAfterLogin.status, 200);

  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
  assert.equal(badLogin.status, 401);
  const badBody = await badLogin.json() as { error: string };
  assert.equal("password_hash" in badBody, false);

  const duplicate = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(duplicate.status, 409);

  const stored = await db
    .select({ passwordHash: usersTable.passwordHash, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  assert.equal(stored[0]?.email, email);
  assert.notEqual(stored[0]?.passwordHash, password);
  assert.match(stored[0]?.passwordHash ?? "", /^\$2[aby]\$/);

  const leftoverSessions = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(usersTable.email, email));
  assert.ok(leftoverSessions.length >= 1);
});

test("anonymous trip create still works without a session", async (t) => {
  t.after(cleanup);
  const { baseUrl, close } = await listen();
  t.after(close);

  const created = await fetch(`${baseUrl}/api/trips`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      destination: "Portugal",
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
    }),
  });
  assert.equal(created.status, 201);
  const trip = await created.json() as { id: string };
  const fetched = await fetch(`${baseUrl}/api/trips/${trip.id}`);
  assert.equal(fetched.status, 200);
});
