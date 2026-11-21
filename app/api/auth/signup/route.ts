import { createAccount } from "@/lib/accounts";
import { withSession } from "@/lib/auth-cookie";
import { json } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: string; email?: string; password?: string } | null;
  if (!body) return json({ error: "Enter your name, email, and password." }, 400);
  const created = createAccount(body.name ?? "", body.email ?? "", body.password ?? "");
  if ("error" in created) return json({ error: created.error }, created.error.includes("already") ? 409 : 400);
  return withSession({ name: created.name, email: created.email }, created);
}
