import { headers } from "next/headers";
import { getIdentity } from "../../cursor/identity";
import { Landing } from "@/components/landing/Landing";
import { SignedOut } from "@/components/auth/SignedOut";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const identity = await getIdentity(await headers());
  if (!identity.verified) return <SignedOut />;
  return <Landing />;
}
