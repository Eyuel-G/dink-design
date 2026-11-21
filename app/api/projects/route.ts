import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(1).max(80).optional(),
  prompt: z.string().min(1).max(4000).optional(),
  images: z.array(z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(1_600_000) })).max(2).optional(),
});

export async function GET(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const store = await getStore();
  const projects = await store.listProjects(ownerKey(identity));
  return json({ projects, persistence: store.persistence });
}

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const parsed = CreateBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "Check the project name and try again." }, 400);
  const store = await getStore();
  const name = (parsed.data.name || parsed.data.prompt || "Untitled room").slice(0, 48);
  const project = await store.createProject(ownerKey(identity), name);
  if (parsed.data.prompt) {
    await store.addMessage({
      projectId: project.id,
      role: "user",
      content: parsed.data.prompt,
      images: parsed.data.images ?? null,
      status: "pending",
    });
  }
  return json({ id: project.id, name: project.name, persistence: store.persistence });
}
