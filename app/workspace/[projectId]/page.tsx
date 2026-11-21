import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getIdentity } from "../../../cursor/identity";
import { SignedOut } from "@/components/auth/SignedOut";
import { Workspace } from "@/components/workspace/Workspace";
import { ownerKey, viewerLabel } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { buildProjectView } from "@/lib/project-data";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const identity = await getIdentity(await headers());
  if (!identity.verified) return <SignedOut />;
  const { projectId } = await params;
  const store = await getStore();
  const view = await buildProjectView(store, ownerKey(identity), projectId);
  if (!view) notFound();
  return <Workspace initial={{ ...view, viewer: { name: viewerLabel(identity), simulated: identity.simulated } }} />;
}
