import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { layoutSpec } from "@/lib/layout/place";
import { r3 } from "@/lib/num";
import { buildProjectView } from "@/lib/project-data";
import { BuildingSpecSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  objectId: z.string().min(1).max(80),
  x: z.number(),
  z: z.number(),
  rotationY: z.number(),
  w: z.number().positive().max(40).optional(),
  l: z.number().positive().max(40).optional(),
  h: z.number().positive().max(12).optional(),
  y: z.number().min(0).max(12).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const projectId = (await context.params).projectId;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "That move could not be read." }, 400);
  const store = await getStore();
  const owner = ownerKey(identity);
  const project = await store.getProject(owner, projectId);
  if (!project) return json({ error: "That project is not on this account." }, 404);
  const versions = await store.listVersions(projectId);
  const current = versions.find((version) => version.version === project.currentVersion);
  if (!current) return json({ error: "There is no scene to move yet." }, 400);
  const prior = (current.spec.placements ?? []).find((placement) => placement.objectId === body.data.objectId);
  const placement = {
    objectId: body.data.objectId,
    x: body.data.x,
    z: body.data.z,
    rotationY: body.data.rotationY,
    ...(body.data.w ?? prior?.w ? { w: body.data.w ?? prior?.w, l: body.data.l ?? prior?.l, h: body.data.h ?? prior?.h } : {}),
    ...((body.data.y ?? prior?.y) != null ? { y: body.data.y ?? prior?.y } : {}),
    ...(body.data.color ?? prior?.color ? { color: body.data.color ?? prior?.color } : {}),
  };
  const placements = [...(current.spec.placements ?? []).filter((entry) => entry.objectId !== body.data.objectId), placement];
  const spec = BuildingSpecSchema.parse({ ...current.spec, placements });
  const layout = layoutSpec(spec);
  const placed = layout.objects.find((object) => object.id === body.data.objectId);
  const yMoved = body.data.y != null && placed?.y !== r3(body.data.y);
  if (!placed || placed.x !== r3(body.data.x) || placed.z !== r3(body.data.z) || yMoved) {
    return json({ error: layout.warnings.at(-1) || "That spot is outside the room or overlaps another piece.", layout }, 409);
  }
  const label = body.data.color && body.data.color !== prior?.color ? `Recolored ${body.data.objectId}` : body.data.w ? `Resized ${body.data.objectId}` : `Moved ${body.data.objectId}`;
  await store.saveVersion(projectId, spec, layout.objects, label);
  return json(await buildProjectView(store, owner, projectId));
}
