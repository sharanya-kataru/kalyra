import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;

export function assertPasswordLength(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES) {
    return "Password must be at most 72 bytes.";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

export async function verifyPasswordAgainstKnownUser(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (!passwordHash) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}
