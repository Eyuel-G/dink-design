import "server-only";
import { createHash } from "node:crypto";
import { requireIdentity, type VerifiedIdentity } from "../cursor/identity";

export function ownerKey(identity: VerifiedIdentity): string {
  return `${identity.stage}:${identity.sub}`;
}

export function viewerLabel(identity: VerifiedIdentity): string {
  return identity.name || (identity.kind === "key" ? "API key" : "Signed-in viewer");
}

export async function guard(request: Request): Promise<VerifiedIdentity | Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const blocked = crossSite(request);
    if (blocked) return blocked;
  }
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    identity.headers.set("cache-control", "private, no-store");
    return identity;
  }
  return identity;
}

function crossSite(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    if (!host || new URL(origin).host !== host) {
      return Response.json({ error: "Cross-site request blocked." }, { status: 403, headers: { "cache-control": "private, no-store" } });
    }
  } catch {
    return Response.json({ error: "Bad origin." }, { status: 403 });
  }
  return null;
}

export function clientIpHash(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return createHash("sha256").update(forwarded).digest("hex");
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}
