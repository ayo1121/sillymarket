import { NextRequest } from "next/server";
import { buildCorsHeaders, isOriginAllowed } from "@/lib/server/cors";
import { rateLimitOk, rateLimitHeaders } from "@/lib/server/rateLimit";

export const runtime = "nodejs"; // ensure Node runtime (not edge) for compatibility

function getClientIp(req: NextRequest): string {
  // Common headers if behind a proxy (Vercel, etc.)
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = buildCorsHeaders(origin);
  return new Response(null, { status: 204, headers });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = buildCorsHeaders(origin);

  if (!origin || !isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: "CORS: origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) {
    return new Response(JSON.stringify({ error: "Server misconfig: RPC_URL missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  const ip = getClientIp(req);
  if (!rateLimitOk(ip)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...headers, ...rateLimitHeaders(ip) },
    });
  }

  // Enforce JSON only
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return new Response(JSON.stringify({ error: "Content-Type must be application/json" }), {
      status: 415,
      headers: { "Content-Type": "application/json", ...headers, ...rateLimitHeaders(ip) },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...headers, ...rateLimitHeaders(ip) },
    });
  }

  // Forward to your private RPC_URL with a short timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000); // 12s timeout

  try {
    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Optionally forward an auth header if your provider needs it:
        // "Authorization": req.headers.get("authorization") ?? "",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // No need to forward credentials/cookies
    });

    const text = await upstream.text(); // pass-through (may be JSON or error text)
    clearTimeout(timeout);

    // Mirror upstream status but keep our CORS + RL headers
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        ...headers,
        ...rateLimitHeaders(ip),
      },
    });
  } catch (e: any) {
    clearTimeout(timeout);
    const msg = e?.name === "AbortError" ? "Upstream timeout" : (e?.message || "Upstream error");
    return new Response(JSON.stringify({ error: msg }), {
      status: 504,
      headers: { "Content-Type": "application/json", ...headers, ...rateLimitHeaders(ip) },
    });
  }
}
