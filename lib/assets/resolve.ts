import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import sources from "@/catalog/model-sources.json";
import { fetchMissingModel } from "@/lib/assets/online";
import { readyModel, toModelLink, type ModelLink } from "@/lib/assets/library";
import type { CatalogItem } from "@/lib/schemas";

export type { ModelLink };

/** Library file first. Otherwise download a matching online model, or generate one when a provider key is set. */
export async function acquireModelLink(item: CatalogItem): Promise<ModelLink | null> {
  const ready = readyModel(item);
  if (ready) return toModelLink(ready);
  const fetched = await fetchMissingModel(item);
  return fetched ? toModelLink(fetched) : null;
}

const MODEL_SOURCES = sources as Record<string, { name: string; author: string; href: string; license?: string; credit?: string }>;

export interface ResolvedAsset {
  catalogId: string;
  tier: 1 | 2 | 3 | 4;
  url: string | null;
  fidelity: "representative" | "generated" | "exact";
  license: string;
  attribution: string;
  status: "ready" | "fallback" | "unavailable";
  ms: number;
}

export function resolveLocalAsset(item: CatalogItem): ResolvedAsset {
  const started = Date.now();
  const file = path.join(process.cwd(), "public", "catalog", `${item.id}.glb`);
  if (item.placeable && existsSync(file)) {
    const source = MODEL_SOURCES[item.id];
    return {
      catalogId: item.id,
      tier: 1,
      url: `/catalog/${item.id}.glb`,
      fidelity: "representative",
      license: source?.license ?? (source ? "CC0" : "Stand-in"),
      attribution: source
        ? source.credit ?? `${source.name} by ${source.author}. CC0, Poly Haven. Fit to the catalog size. Not a manufacturer model.`
        : "Dimension-fit stand-in built for Dink. Not a manufacturer model.",
      status: "ready",
      ms: Date.now() - started,
    };
  }
  return {
    catalogId: item.id,
    tier: 4,
    url: null,
    fidelity: "exact",
    license: "Stand-in",
    attribution: "Procedural block from the catalog dimensions.",
    status: "fallback",
    ms: Date.now() - started,
  };
}
