import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { layoutSpec } from "@/lib/layout/place";
import { buildProjectView } from "@/lib/project-data";
import { verifiedLink } from "@/lib/prices/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  projectId: z.string().uuid(),
  objectId: z.string().min(1),
  price: z.number().positive(),
  currency: z.string().length(3),
  title: z.string().min(1).max(180),
  url: z.string().nullable(),
  sourceBaseUrl: z.string().url().nullable(),
});

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "That price could not be pinned." }, 400);
  const link = body.data.url && body.data.sourceBaseUrl ? verifiedLink({ price: body.data.price, url: body.data.url }, body.data.sourceBaseUrl) : null;
  if (body.data.url && !link) return json({ error: "That link is not on the source domain, so it was not pinned." }, 400);
  const store = await getStore();
  const owner = ownerKey(identity);
  const project = await store.getProject(owner, body.data.projectId);
  if (!project) return json({ error: "That project is not on this account." }, 404);
  const versions = await store.listVersions(project.id);
  const current = versions.find((version) => version.version === project.currentVersion);
  if (!current) return json({ error: "Build a scene before pinning a price." }, 400);
  const spec = {
    ...current.spec,
    pins: {
      ...(current.spec.pins ?? {}),
      [body.data.objectId]: { price: body.data.price, currency: body.data.currency.toUpperCase(), title: body.data.title, url: link, sourceName: "Pinned" },
    },
  };
  const layout = layoutSpec(spec);
  await store.saveVersion(project.id, spec, layout.objects, `Pinned price for ${body.data.objectId}`);
  return json(await buildProjectView(store, owner, project.id));
}
