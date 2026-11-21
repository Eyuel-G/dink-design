import { z } from "zod";
import { guard, json, ownerKey, viewerLabel } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { buildProjectView } from "@/lib/project-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({ projectId: z.string().uuid() });

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const params = Params.safeParse(await context.params);
  if (!params.success) return json({ error: "Unknown project." }, 404);
  const store = await getStore();
  const view = await buildProjectView(store, ownerKey(identity), params.data.projectId);
  if (!view) return json({ error: "That project is not on this account." }, 404);
  return json({ ...view, viewer: { name: viewerLabel(identity), simulated: identity.simulated } });
}

const PatchBody = z.object({ name: z.string().min(1).max(80).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const params = Params.safeParse(await context.params);
  if (!params.success) return json({ error: "Unknown project." }, 404);
  const body = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success || !body.data.name) return json({ error: "Give the project a name." }, 400);
  const store = await getStore();
  const ok = await store.renameProject(ownerKey(identity), params.data.projectId, body.data.name);
  if (!ok) return json({ error: "That project is not on this account." }, 404);
  return json({ ok: true });
}
