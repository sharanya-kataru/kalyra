import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPasswordLength,
  hashPassword,
  verifyPassword,
  verifyPasswordAgainstKnownUser,
} from "../../artifacts/api-server/src/lib/password";

test("password hashes are salted bcrypt strings, never plaintext", async () => {
  const password = "correct-horse-battery";
  const hash = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.match(hash, /^\$2[aby]\$/);
  assert.notEqual(hash, second);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("missing users still run a password comparison", async () => {
  assert.equal(await verifyPasswordAgainstKnownUser("any-password", null), false);
});

test("password length is rejected outside bcrypt-safe bounds", () => {
  assert.ok(assertPasswordLength("short"));
  assert.equal(assertPasswordLength("long-enough-password"), null);
});
