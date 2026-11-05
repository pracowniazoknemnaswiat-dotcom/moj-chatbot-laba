import { NextResponse } from "next/server";
import {
  createSessionToken,
  getAuthConfig,
  isPasswordCorrect,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth";
import {
  clearLoginFailures,
  isLoginBlocked,
  recordLoginFailure,
} from "@/lib/rate-limit";

const FAILURE_DELAY_MS = 1000;

function backToStart(req: Request, error?: string) {
  const url = new URL("/", req.url);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  const config = getAuthConfig();
  if (!config) return backToStart(req, "config");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (isLoginBlocked(ip)) return backToStart(req, "limit");

  const form = await req.formData();
  const password = form.get("password");

  if (typeof password !== "string" || !isPasswordCorrect(password, config)) {
    recordLoginFailure(ip);
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return backToStart(req, "password");
  }

  clearLoginFailures(ip);
  const response = backToStart(req);
  response.cookies.set(
    SESSION_COOKIE,
    createSessionToken(config),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  );
  return response;
}
