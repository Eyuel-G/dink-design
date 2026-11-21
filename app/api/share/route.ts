import { z } from "zod";
import { guard, json, ownerKey, viewerLabel } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { buildProjectView } from "@/lib/project-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const body = z.object({ projectId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Choose a project to share." }, 400);
  const store = await getStore();
  const owner = ownerKey(identity);
  const project = await store.getProject(owner, body.data.projectId);
  if (!project || project.currentVersion < 1) return json({ error: "Build the scene before sharing it." }, 400);
  const token = await store.createShare(owner, project.id, project.currentVersion);
  return json({ token, path: `/s/${token}` });
}

export async function GET(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ error: "That share link is not valid." }, 404);
  const store = await getStore();
  const share = await store.getShare(token);
  if (!share) return json({ error: "That share link is not valid." }, 404);
  const view = await buildProjectView(store, ownerKey(identity), share.projectId, true, share.version);
  if (!view) return json({ error: "That shared scene is gone." }, 404);
  return json({ ...view, viewer: { name: viewerLabel(identity), simulated: identity.simulated } });
}
