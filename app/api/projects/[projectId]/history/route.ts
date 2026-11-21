import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { buildProjectView } from "@/lib/project-data";
import { redoVersion, undoVersion } from "@/lib/versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["undo", "redo", "restore"]),
  version: z.number().int().positive().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const projectId = (await context.params).projectId;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Choose undo, redo, or restore." }, 400);
  const store = await getStore();
  const owner = ownerKey(identity);
  const project = await store.getProject(owner, projectId);
  if (!project) return json({ error: "That project is not on this account." }, 404);
  const versions = await store.listVersions(projectId);
  let next = project.currentVersion;
  if (body.data.action === "undo") next = undoVersion(versions, project.currentVersion);
  if (body.data.action === "redo") next = redoVersion(versions, project.currentVersion);
  if (body.data.action === "restore") {
    if (!versions.some((version) => version.version === body.data.version)) return json({ error: "That version is not in this project." }, 404);
    next = body.data.version as number;
  }
  await store.setCurrentVersion(projectId, next);
  const view = await buildProjectView(store, owner, projectId);
  return json(view);
}
