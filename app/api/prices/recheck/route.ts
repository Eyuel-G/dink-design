import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { recheckListing } from "@/lib/prices/engine";
import { allowRequest } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  sourceId: z.string().min(8),
  listingId: z.string().uuid().optional(),
  url: z.string().url(),
});

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  if (!allowRequest(`recheck:${ownerKey(identity)}`, 10)) return json({ error: "Recheck is cooling down." }, 429);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Choose a listing to recheck." }, 400);
  const store = await getStore();
  const sources = await store.listSources(ownerKey(identity));
  const source = sources.find((item) => item.id === body.data.sourceId);
  if (!source) return json({ error: "That source is not available." }, 404);
  const status = await recheckListing(store, source, { id: body.data.listingId ?? "", url: body.data.url });
  const message = {
    ok: "The listing still answers.",
    stale: "The listing returned 404 and is marked stale.",
    blocked: "The site blocked the recheck. The estimate stays, with no link.",
    slow: "The recheck timed out.",
  }[status];
  return json({ status, message });
}
