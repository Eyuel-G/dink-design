import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { applyPatch } from "@/lib/intent/patch";
import { layoutSpec } from "@/lib/layout/place";
import { buildProjectView } from "@/lib/project-data";
import { SpecPatchSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const projectId = (await context.params).projectId;
  const body = SpecPatchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "That change could not be read." }, 400);
  const store = await getStore();
  const owner = ownerKey(identity);
  const project = await store.getProject(owner, projectId);
  if (!project) return json({ error: "That project is not on this account." }, 404);
  const versions = await store.listVersions(projectId);
  const current = versions.find((version) => version.version === project.currentVersion);
  if (!current) return json({ error: "Build a scene before editing it." }, 400);
  const settings = await store.getSettings(owner);
  let edited;
  try {
    edited = applyPatch(current.spec, body.data, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct });
  } catch {
    return json({ error: "That change does not fit the spec." }, 400);
  }
  const layout = layoutSpec(edited.spec);
  await store.saveVersion(projectId, edited.spec, layout.objects, edited.label);
  return json(await buildProjectView(store, owner, projectId));
}
