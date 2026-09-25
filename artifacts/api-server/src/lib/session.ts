import { randomBytes } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";

export const SESSION_COOKIE_NAME = "kalyra_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export function readSessionToken(req: Request): string | undefined {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
}
