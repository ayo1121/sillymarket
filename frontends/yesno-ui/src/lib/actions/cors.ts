// src/lib/actions/cors.ts
// Unified CORS + JSON helpers for all API routes

import { NextRequest, NextResponse } from "next/server";

/**
 * Configure allowed origins.
 * - By default we allow same-origin and localhost/dev URLs.
 * - Set CORS_ALLOW_ORIGIN to a specific origin (e.g., https://app.example.com) to lock it down.
 * - Set CORS_ALLOW_ORIGIN="*" only if you truly need public access.
 */
const ENV_ALLOW = (process.env.CORS_ALLOW_ORIGIN || "").trim();

function isDevHost(origin: string) {
  try {
    const u = new URL(origin);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.endsWith(".ngrok-free.app") || // optional: common tunnels
      u.hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function resolveAllowOrigin(req: NextRequest): string {
  if (ENV_ALLOW) return ENV_ALLOW; // explicit override
  const origin = req.headers.get("origin") || "";
  if (!origin) return "*"; // server-to-server call
  // Allow same-origin and common local dev origins
  if (isDevHost(origin)) return origin;
  // Fallback to same-origin only
  const url = new URL(req.url);
  return url.origin;
}

/**
 * Standard CORS response with JSON body.
 */
export function cors(body: any, status = 200, req?: NextRequest): NextResponse {
  // If req not provided, fabricate a minimal Origin based on body (rare). Prefer to pass req.
  const allowOrigin = req ? resolveAllowOrigin(req) : "*";

  const res = NextResponse.json(body, {
    status,
  });

  res.headers.set("Access-Control-Allow-Origin", allowOrigin);
  res.headers.set("Access-Control-Allow-Credentials", "false");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "content-type, authorization, x-requested-with"
  );
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Vary", "Origin");

  // Make sure JSON content-type is set
  if (!res.headers.has("Content-Type")) {
    res.headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return res;
}

/**
 * Handle OPTIONS preflight. Return a response if it's a preflight; otherwise null to continue.
 */
export function preflight(req: NextRequest): NextResponse | null {
  if (req.method !== "OPTIONS") return null;

  const allowOrigin = resolveAllowOrigin(req);
  const res = new NextResponse(null, { status: 204 });

  res.headers.set("Access-Control-Allow-Origin", allowOrigin);
  res.headers.set("Access-Control-Allow-Credentials", "false");
  res.headers.set(
    "Access-Control-Allow-Headers",
    req.headers.get("Access-Control-Request-Headers") ||
      "content-type, authorization, x-requested-with"
  );
  res.headers.set(
    "Access-Control-Allow-Methods",
    req.headers.get("Access-Control-Request-Method") || "GET, POST, OPTIONS"
  );
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Max-Age", "600"); // cache preflight 10 minutes

  return res;
}

/**
 * Convenience error helper (adds CORS + consistent structure).
 */
export function jsonErr(message: string, status = 400, req?: NextRequest) {
  return cors({ error: message }, status, req);
}
