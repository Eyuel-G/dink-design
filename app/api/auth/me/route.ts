import { currentAccount } from "@/lib/auth-cookie";
import { json } from "@/lib/auth";

export async function GET() {
  const account = await currentAccount();
  if (!account) return json({ account: null });
  return json({ account: { name: account.name, email: account.email } });
}
