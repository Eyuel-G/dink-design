import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { PRESETS } from "@/lib/intent/presets";
import { layoutSpec } from "@/lib/layout/place";
import { buildProjectView } from "@/lib/project-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const projectId = (await context.params).projectId;
  const body = z.object({ preset: z.enum(["garment", "bakery", "apartment", "retail", "classroom", "roastery", "living"]) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Choose a template." }, 400);
  const store = await getStore();
  const owner = ownerKey(identity);
  const project = await store.getProject(owner, projectId);
  if (!project) return json({ error: "That project is not on this account." }, 404);
  const spec = structuredClone(PRESETS[body.data.preset]);
  const layout = layoutSpec(spec);
  await store.saveVersion(projectId, spec, layout.objects, `Template: ${body.data.preset}`);
  return json(await buildProjectView(store, owner, projectId));
}
