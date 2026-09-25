import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { readSessionToken } from "../lib/session";

export type AuthUser = {
  id: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionId?: string;
    }
  }
}

export async function optionalSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readSessionToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const [row] = await db
      .select({
        sessionId: sessionsTable.id,
        expiresAt: sessionsTable.expiresAt,
        userId: usersTable.id,
        email: usersTable.email,
      })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
      .where(eq(sessionsTable.id, token))
      .limit(1);

    if (!row) {
      next();
      return;
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      await db.delete(sessionsTable).where(eq(sessionsTable.id, row.sessionId));
      next();
      return;
    }

    req.sessionId = row.sessionId;
    req.authUser = { id: row.userId, email: row.email };
    next();
  } catch (err) {
    next(err);
  }
}
