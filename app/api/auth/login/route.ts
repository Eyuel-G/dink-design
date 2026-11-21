import { authenticate } from "@/lib/accounts";
import { withSession } from "@/lib/auth-cookie";
import { json } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const account = body ? authenticate(body.email ?? "", body.password ?? "") : null;
  if (!account) return json({ error: "Email or password is incorrect." }, 401);
  return withSession({ name: account.name, email: account.email }, account);
}
