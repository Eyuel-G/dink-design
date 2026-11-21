"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useDink } from "@/lib/client/store";
import { requestThumbnail } from "@/lib/client/thumbnails";
import type { ProjectView } from "@/lib/client/types";
import type { PlacedObject } from "@/lib/layout/place";
import type { CatalogItem } from "@/lib/schemas";

interface LibraryOption {
  file: string;
  label: string;
}

export function AlternativesPanel() {
  const view = useDink((state) => state.view);
  const selectedId = useDink((state) => state.selectedId);
  const object = view?.layout?.objects.find((item) => item.id === selectedId);
  const [options, setOptions] = useState<LibraryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const current = object ? currentFile(view, object.catalogId) : "";

  useEffect(() => {
    if (!object) {
      setOptions([]);
      return;
    }
    const query = new URLSearchParams({ q: `${object.name} ${object.kind} ${object.catalogId}`, file: current });
    let cancel = false;
    setLoading(true);
    api<{ options: LibraryOption[] }>(`/api/models/options?${query.toString()}`)
      .then((result) => {
        if (!cancel) setOptions(result.options);
      })
      .catch(() => {
        if (!cancel) setOptions([]);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [object?.id, object?.catalogId, object?.name, object?.kind, current]);

  if (!view || !object) {
    return <p className="p-4 text-sm text-muted">Select a piece to see other models of the same kind from the asset folder.</p>;
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto px-3 py-3 text-sm">
      <div>
        <h3 className="font-display text-2xl">Alternatives</h3>
        <p className="text-xs text-muted">Other {object.name} models in the asset folder. Choosing one replaces the selected piece.</p>
      </div>
      {loading ? <p className="text-xs text-muted">Looking through the asset folder…</p> : null}
      {!loading && options.length === 0 ? <p className="text-xs text-muted">No other matching models are in the asset folder.</p> : null}
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.file}
            type="button"
            disabled={view.project.readOnly}
            title={option.label}
            className="overflow-hidden rounded-xl border border-line bg-chip text-left hover:border-ink"
            onClick={() => void useOption(view, object, option)}
          >
            <ModelThumb file={option.file} label={option.label} />
            <span className="line-clamp-2 px-2 py-1.5 text-[11px] capitalize leading-snug">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelThumb({ file, label }: { file: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancel = false;
    setSrc(null);
    setFailed(false);
    requestThumbnail(file).then((image) => {
      if (cancel) return;
      if (image) setSrc(image);
      else setFailed(true);
    });
    return () => {
      cancel = true;
    };
  }, [file]);

  return (
    <span className="block aspect-square bg-[#e7e2d8]">
      {src ? <img src={src} alt={label} className="h-full w-full object-contain" /> : null}
      {!src && !failed ? <span className="block h-full w-full animate-pulse bg-[#ddd7ce]" /> : null}
      {failed ? <span className="flex h-full items-center px-2 text-center text-[11px] text-muted">Preview unavailable</span> : null}
    </span>
  );
}

function currentFile(view: ProjectView | null, catalogId: string): string {
  const linked = view?.models?.[catalogId]?.url ?? "";
  const fromUrl = linked.match(/[?&]file=([^&]+)/);
  if (fromUrl) return decodeURIComponent(fromUrl[1]);
  return view?.spec?.extras?.find((item) => item.id === catalogId)?.glbPath?.split(/[/\\]/).pop() ?? "";
}

function optionItem(file: string, label: string, object: PlacedObject): CatalogItem {
  const slug = file.replace(/\.glb$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  return {
    id: `asset_${slug}`.slice(0, 64),
    name: label.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
    category: "furniture",
    group: "interior",
    tags: ["uploaded"],
    dimW: Math.max(0.15, object.w),
    dimL: Math.max(0.05, object.l),
    dimH: Math.max(0.15, object.h),
    unit: "unit",
    basePriceEtb: 2500,
    glbPath: file,
    queryEn: label,
    queryAm: "",
    color: object.color,
    kind: object.kind,
    placeable: true,
    mount: object.mount,
    cheaperId: null,
  };
}

async function useOption(view: ProjectView, object: PlacedObject, option: LibraryOption) {
  const item = optionItem(option.file, option.label, object);
  const extras = [...(view.spec?.extras ?? []).filter((entry) => entry.id !== item.id), item];
  try {
    const fresh = await api<ProjectView>(`/api/projects/${view.project.id}/patch`, {
      method: "POST",
      body: JSON.stringify({ extras, swap: { objectId: object.id, catalogId: item.id }, note: `Swapped to ${item.name}` }),
    });
    useDink.getState().hydrate(fresh);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "That model could not replace the piece.");
  }
}
