import { guard, json, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { SettingsSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const store = await getStore();
  return json(await store.getSettings(ownerKey(identity)));
}

export async function PUT(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const body = SettingsSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Those settings could not be saved." }, 400);
  const store = await getStore();
  await store.saveSettings(ownerKey(identity), body.data);
  return json(body.data);
}
