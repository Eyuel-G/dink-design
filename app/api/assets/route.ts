import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { acquireModelLink, resolveLocalAsset } from "@/lib/assets/resolve";
import { guard, json, ownerKey } from "@/lib/auth";
import { getCatalogItem } from "@/lib/catalog";
import { getStore } from "@/lib/db";
import { layoutSpec } from "@/lib/layout/place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), catalogId: z.string() }),
  z.object({ action: z.literal("replace"), projectId: z.string().uuid(), objectId: z.string(), catalogId: z.string() }),
  z.object({ action: z.literal("regenerate"), projectId: z.string().uuid(), catalogId: z.string(), objectId: z.string().optional() }),
  z.object({ action: z.literal("status"), jobId: z.string().uuid() }),
  z.object({
    action: z.literal("upload"),
    projectId: z.string().uuid(),
    objectId: z.string(),
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z.string().max(1_600_000),
  }),
]);

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "That asset request could not be read." }, 400);
  const store = await getStore();
  const owner = ownerKey(identity);
  if (body.data.action === "resolve") {
    const item = getCatalogItem(body.data.catalogId);
    if (!item) return json({ error: "Unknown catalog item." }, 404);
    const linked = await acquireModelLink(item);
    return json(linked ?? resolveLocalAsset(item));
  }
  if (body.data.action === "status") {
    const job = await store.getJob(owner, body.data.jobId);
    if (!job) return json({ error: "No such generation job." }, 404);
    return json(job);
  }
  if (body.data.action === "upload") {
    const project = await store.getProject(owner, body.data.projectId);
    if (!project) return json({ error: "That project is not on this account." }, 404);
    const id = randomUUID();
    const ext = body.data.mime === "image/png" ? "png" : body.data.mime === "image/webp" ? "webp" : "jpg";
    const dir = path.join(process.cwd(), "storage", "uploads");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.${ext}`);
    writeFileSync(file, Buffer.from(body.data.data, "base64"));
    await store.saveAsset({
      id,
      ownerSub: owner,
      projectId: project.id,
      objectId: body.data.objectId,
      catalogId: "upload",
      sourceTier: 0,
      path: file,
      thumbnail: null,
      license: "User upload",
      attribution: "Uploaded by the signed-in viewer. Not sent to a marketplace.",
      fidelity: "representative",
      polyCount: null,
      mime: body.data.mime,
    });
    return json({ id, message: "Photo saved for reference. It is not used for 3D generation unless you press Regenerate." });
  }
  if (body.data.action === "replace") {
    const project = await store.getProject(owner, body.data.projectId);
    if (!project) return json({ error: "That project is not on this account." }, 404);
    const item = getCatalogItem(body.data.catalogId);
    if (!item?.placeable) return json({ error: "Pick a placeable catalog item." }, 400);
    const versions = await store.listVersions(project.id);
    const current = versions.find((version) => version.version === project.currentVersion);
    if (!current) return json({ error: "Build a scene first." }, 400);
    const replacedId = body.data.objectId.split("#")[0];
    const items = current.spec.items.map((entry) => (entry.catalogId === replacedId ? { ...entry, catalogId: item.id } : entry));
    const spec = { ...current.spec, items, placements: [] };
    const layout = layoutSpec(spec);
    await store.saveVersion(project.id, spec, layout.objects, `Replaced with ${item.name}`);
    return json({ ok: true, asset: resolveLocalAsset(item) });
  }
  if (body.data.action !== "regenerate") return json({ error: "That asset action is not supported." }, 400);
  const item = getCatalogItem(body.data.catalogId);
  if (!item) return json({ error: "Unknown catalog item." }, 404);
  const linked = await acquireModelLink(item);
  if (linked) {
    return json({
      status: "ready",
      tier: linked.source === "generated" ? 3 : linked.source === "online" ? 2 : 1,
      message: linked.source === "library" ? `Using ${linked.label} from your model folder.` : `Using ${linked.label}.`,
      asset: { ...resolveLocalAsset(item), url: linked.url, tier: linked.source === "generated" ? 3 : 1, status: "ready", attribution: linked.label },
    });
  }
  const count = await store.countJobs(body.data.projectId);
  if (count >= 2) {
    return json({
      status: "unavailable",
      tier: 4,
      message: "This project already used its two generation slots. Showing the dimension-fit stand-in.",
      asset: resolveLocalAsset(item),
    });
  }
  const provider = process.env.MESHY_API_KEY ? "meshy" : process.env.TRIPO_API_KEY ? "tripo" : null;
  if (!provider) {
    return json({
      status: "unavailable",
      tier: 4,
      message: "AI model generation is not configured. Showing a dimension-fit stand-in.",
      asset: resolveLocalAsset(item),
    });
  }
  const id = randomUUID();
  await store.createJob({
    id,
    ownerSub: owner,
    projectId: body.data.projectId,
    catalogId: item.id,
    objectId: body.data.objectId ?? null,
    provider,
    status: "unavailable",
    progress: 0,
    resultPath: null,
    error: "The provider call is not confirmed for this key. The stand-in stays in the scene.",
  });
  return json({
    status: "unavailable",
    jobId: id,
    tier: 4,
    message: "The generation service did not accept a job. The dimension-fit stand-in stays. No model was invented.",
    asset: resolveLocalAsset(item),
  });
}
