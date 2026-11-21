import { randomUUID } from "node:crypto";
import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { sourceHostname } from "@/lib/prices/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const store = await getStore();
  const sources = await store.listSources(ownerKey(identity));
  return json({
    sources: sources.map((source) => ({
      ...source,
      host: sourceHostname(source.baseUrl),
    })),
  });
}

const Create = z.object({
  name: z.string().min(2).max(80),
  baseUrl: z.string().url(),
  searchUrlTemplate: z.string().min(8).max(500),
  currency: z.string().length(3),
  categories: z.array(z.string()).max(8),
  priority: z.number().int().min(1).max(100),
  refreshHours: z.number().int().min(6).max(24),
  strategy: z.enum(["api", "structured", "html", "rendered", "llm"]),
});

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const body = Create.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "The source needs a name, a search template with {query}, and a currency." }, 400);
  if (!body.data.searchUrlTemplate.includes("{query}")) return json({ error: "The search URL must contain {query}." }, 400);
  const store = await getStore();
  const id = randomUUID();
  await store.insertSource({
    id,
    ownerSub: ownerKey(identity),
    name: body.data.name,
    baseUrl: body.data.baseUrl,
    searchUrlTemplate: body.data.searchUrlTemplate,
    currency: body.data.currency.toUpperCase(),
    categories: body.data.categories,
    priority: body.data.priority,
    refreshHours: body.data.refreshHours,
    strategy: body.data.strategy,
    enabled: true,
    robotsOk: null,
    status: "unknown",
    config: null,
  });
  return json({ id });
}
