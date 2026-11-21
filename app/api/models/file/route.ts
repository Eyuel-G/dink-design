import { readFile } from "node:fs/promises";
import { guard } from "@/lib/auth";
import { getCatalogItem } from "@/lib/catalog";
import { modelFileFor } from "@/lib/assets/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const url = new URL(request.url);
  const catalogId = url.searchParams.get("catalogId") ?? "";
  if (!/^[a-z0-9_]+$/i.test(catalogId)) return new Response("Not found", { status: 404 });
  const file = modelFileFor(catalogId, getCatalogItem(catalogId), url.searchParams.get("file"));
  if (!file) return new Response("Not found", { status: 404 });
  const bytes = await readFile(file);
  return new Response(bytes, {
    headers: {
      "content-type": "model/gltf-binary",
      "cache-control": "private, max-age=3600",
    },
  });
}
