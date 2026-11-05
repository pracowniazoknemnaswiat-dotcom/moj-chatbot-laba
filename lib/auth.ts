import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "chat_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const MIN_SECRET_LENGTH = 32;

type AuthConfig = { password: string; secret: string };

// Brak lub zbyt krótka konfiguracja zwraca null, co blokuje dostęp.
export function getAuthConfig(): AuthConfig | null {
  const password = process.env.CHAT_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  return { password, secret };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function isPasswordCorrect(input: string, config: AuthConfig): boolean {
  return timingSafeEqual(sha256(input), sha256(config.password));
}

// Cookie zawiera tylko czas wygaśnięcia i podpis HMAC, nigdy hasło.
export function createSessionToken(config: AuthConfig): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload, config.secret)}`;
}

export function isSessionValid(
  token: string | undefined,
  config: AuthConfig,
): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = Buffer.from(sign(payload, config.secret));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return false;
  }

  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
