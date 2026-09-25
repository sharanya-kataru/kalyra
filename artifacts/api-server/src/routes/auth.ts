import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { GetMeResponse, LogInBody, SignUpBody } from "@workspace/api-zod";
import { hashPassword, verifyPasswordAgainstKnownUser } from "../lib/password";
import {
  SESSION_TTL_MS,
  clearSessionCookie,
  createSessionToken,
  setSessionCookie,
} from "../lib/session";

const router: IRouter = Router();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(user: { id: string; email: string }) {
  return GetMeResponse.parse({ id: user.id, email: user.email });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  if ("code" in err && err.code === "23505") return true;

  if ("cause" in err) {
    const cause = err.cause;
    return (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "23505"
    );
  }

  return false;
}

async function createSession(userId: string): Promise<string> {
  const token = createSessionToken();
  await db.insert(sessionsTable).values({
    id: token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const passwordHash = await hashPassword(parsed.data.password);

  try {
    const [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash })
      .returning({ id: usersTable.id, email: usersTable.email });

    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json(publicUser(user));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    throw err;
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LogInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const ok = await verifyPasswordAgainstKnownUser(parsed.data.password, user?.passwordHash ?? null);
  if (!user || !ok) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json(publicUser({ id: user.id, email: user.email }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  if (req.sessionId) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, req.sessionId));
  }
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/auth/me", (req, res): void => {
  if (!req.authUser) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  res.json(publicUser(req.authUser));
});

export default router;
