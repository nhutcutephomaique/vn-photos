import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "vnphotos_admin";
const TTL_MS = 8 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.ADMIN_COOKIE_SECRET ?? process.env.ADMIN_PASSWORD;
  if (!value) throw new Error("Thiếu ADMIN_COOKIE_SECRET / ADMIN_PASSWORD");
  return value;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}

/** Cookie = `<expires>.<hmac>` — không lưu mật khẩu trong cookie. */
export function issueToken(): { value: string; maxAge: number } {
  const expires = Date.now() + TTL_MS;
  const signature = createHmac("sha256", secret()).update(String(expires)).digest("hex");
  return { value: `${expires}.${signature}`, maxAge: Math.floor(TTL_MS / 1000) };
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [expiresRaw, signature] = token.split(".");
  if (!expiresRaw || !signature) return false;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  const expected = createHmac("sha256", secret()).update(expiresRaw).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const ADMIN_COOKIE = COOKIE_NAME;

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(COOKIE_NAME)?.value);
}
