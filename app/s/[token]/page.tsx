import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getIdentity } from "../../../cursor/identity";
import { SignedOut } from "@/components/auth/SignedOut";
import { Workspace } from "@/components/workspace/Workspace";
import { viewerLabel } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { buildProjectView } from "@/lib/project-data";

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const identity = await getIdentity(await headers());
  if (!identity.verified) return <SignedOut />;
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) notFound();
  const store = await getStore();
  const link = await store.getShare(token);
  if (!link) notFound();
  const view = await buildProjectView(store, link.ownerSub, link.projectId, true, link.version);
  if (!view) notFound();
  return <Workspace initial={{ ...view, viewer: { name: viewerLabel(identity), simulated: identity.simulated } }} />;
}
