"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CATALOG, getCatalogItem } from "@/lib/catalog";
import { api } from "@/lib/client/api";
import { useDink } from "@/lib/client/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const FIDELITY: Record<string, string> = {
  representative: "Representative",
  generated: "Generated from your photo",
  exact: "Exact-fit dimensions",
};

export function AssetsPanel() {
  const view = useDink((state) => state.view);
  const assets = useDink((state) => state.assets);
  const selected = useDink((state) => state.selectedId);
  const [replaceWith, setReplaceWith] = useState("sewing_basic");
  if (!view?.layout) return <p className="p-4 text-sm text-muted">Assets show up with the scene.</p>;
  const ids = [...new Set(view.layout.objects.map((object) => object.catalogId))];
  return (
    <div className="h-full space-y-3 overflow-y-auto px-3 py-3">
      {ids.map((id) => {
        const item = getCatalogItem(id);
        const progress = assets.find((asset) => asset.id === id);
        const linked = view.models?.[id];
        const tier = linked?.source ?? progress?.source ?? (item?.glbPath ? "stand-in" : "T4");
        const fidelity = tier === "generated" || tier === "T3" ? "generated" : tier === "T4" ? "exact" : "representative";
        const caption =
          linked?.source === "library"
            ? `Your model: ${linked.label}`
            : linked?.source === "online"
              ? `Online model: ${linked.label}`
              : linked?.source === "generated"
                ? `Generated model: ${linked.label}`
                : tier === "T4"
                  ? "Procedural block from the catalog dimensions."
                  : "Dimension-fit stand-in. No matching file in catalog/models, and no online model was downloaded.";
        return (
          <article key={id} className="rounded-2xl border border-line bg-bg p-3">
            <div className="flex gap-3">
              {item?.glbPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={`/catalog/${id}.svg`} className="h-16 w-20 rounded-xl bg-chip object-cover" />
              ) : (
                <div className="grid h-16 w-20 place-items-center rounded-xl text-xs" style={{ background: item?.color ?? "#ccc" }}>
                  T4
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm">{item?.name ?? id}</h3>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge>{tier}</Badge>
                  <Badge>{FIDELITY[fidelity]}</Badge>
                  <Badge>{progress?.status ?? "ready"}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted">{caption} {progress ? `${progress.ms} ms` : ""}</p>
              </div>
            </div>
          </article>
        );
      })}
      {view.project.readOnly ? null : (
        <div className="space-y-2 rounded-2xl border border-line p-3">
          <p className="text-xs text-muted">A matching file in catalog/models is used before anything is generated. If that folder has no match, the app looks online, then generates a model when a provider key is set.</p>
          <label className="block text-xs">
            Replacement
            <select className="mt-1 h-10 w-full rounded-xl border border-line bg-bg px-2" value={replaceWith} onChange={(event) => setReplaceWith(event.target.value)} aria-label="Replacement catalog item">
              {CATALOG.filter((item) => item.placeable && item.id !== "column_steel").map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!selected} onClick={() => void replace(view.project.id, selected, replaceWith)}>Replace</Button>
            <Button size="sm" variant="outline" disabled={!selected} onClick={() => void regenerate(view.project.id, selected)}>Regenerate</Button>
            <label className="inline-flex">
              <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(view.project.id, selected, event.target.files?.[0])} />
              <span className="inline-flex h-8 cursor-pointer items-center rounded-full border border-line px-3 text-xs">Upload reference</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

async function replace(projectId: string, objectId: string | null, catalogId: string) {
  if (!objectId) return;
  try {
    await api("/api/assets", { method: "POST", body: JSON.stringify({ action: "replace", projectId, objectId, catalogId }) });
    const fresh = await api<NonNullable<ReturnType<typeof useDink.getState>["view"]>>(`/api/projects/${projectId}`);
    useDink.getState().hydrate(fresh);
    toast.success("Replaced. A new version was saved.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Replace failed.");
  }
}

async function regenerate(projectId: string, objectId: string | null) {
  if (!objectId) return;
  const catalogId = objectId.split("#")[0];
  try {
    const result = await api<{ message?: string; status?: string }>("/api/assets", { method: "POST", body: JSON.stringify({ action: "regenerate", projectId, objectId, catalogId }) });
    const fresh = await api<NonNullable<ReturnType<typeof useDink.getState>["view"]>>(`/api/projects/${projectId}`);
    useDink.getState().hydrate(fresh);
    toast.message(result.message || "Generation is unavailable. The stand-in stays.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Regenerate failed.");
  }
}

async function upload(projectId: string, objectId: string | null, file?: File) {
  if (!objectId || !file) return;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  try {
    const result = await api<{ id: string; message: string }>("/api/assets", {
      method: "POST",
      body: JSON.stringify({ action: "upload", projectId, objectId, mime: "image/jpeg", data: btoa(binary) }),
    });
    useDink.getState().setUpload(objectId, result.id);
    toast.success(result.message);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Upload failed.");
  }
}
