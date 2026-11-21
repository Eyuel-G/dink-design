import { readFileSync } from "node:fs";
import path from "node:path";
import { guard, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const id = (await context.params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const store = await getStore();
  const asset = await store.getAsset(ownerKey(identity), id);
  if (!asset) return new Response("Not found", { status: 404 });
  const root = path.resolve(process.cwd(), "storage");
  const file = path.resolve(asset.path);
  if (!file.startsWith(`${root}${path.sep}`)) return new Response("Not found", { status: 404 });
  const bytes = readFileSync(file);
  return new Response(bytes, {
    headers: {
      "content-type": asset.mime || "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
