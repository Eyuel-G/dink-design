import "server-only";
import { readyModelLinks } from "@/lib/assets/library";
import { getCatalogItem } from "@/lib/catalog";
import { computeCost, type PriceQuote } from "@/lib/cost/compute";
import { layoutSpec } from "@/lib/layout/place";
import { quoteCatalogItem } from "@/lib/prices/engine";
import { rankListings } from "@/lib/prices/rank";
import { verifiedLink } from "@/lib/prices/link";
import type { Store } from "@/lib/db/types";
import type { BuildingSpec, UserSettings } from "@/lib/schemas";

export async function buildProjectView(store: Store, owner: string, projectId: string, readOnly = false, version?: number) {
  const project = readOnly ? await store.getProjectById(projectId) : await store.getProject(owner, projectId);
  if (!project) return null;
  const settings = await store.getSettings(readOnly ? project.ownerSub : owner);
  const versions = await store.listVersions(project.id);
  const selected = version ?? project.currentVersion;
  const current = versions.find((row) => row.version === selected) ?? null;
  const spec = current?.spec ?? null;
  const layout = spec ? layoutSpec(spec) : null;
  const quotes = spec && layout ? await quotesFor(store, readOnly ? project.ownerSub : owner, spec, layout.objects, settings) : {};
  const cost = spec && layout ? computeCost(spec, layout, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct, quotes }) : null;
  const messages = await store.listMessages(project.id);
  const pending = await store.latestPending(project.id);
  const modelIds = layout ? [...new Set(layout.objects.map((object) => object.catalogId))] : [];
  return {
    persistence: store.persistence,
    project: { id: project.id, name: project.name, currentVersion: project.currentVersion, readOnly },
    messages,
    versions: versions.map((row) => ({ version: row.version, parent: row.parent, label: row.label, createdAt: row.createdAt })),
    spec,
    layout,
    cost,
    quotes,
    settings,
    pending: Boolean(pending),
    draft: project.draft,
    models: readyModelLinks(modelIds.map((id) => getCatalogItem(id)).filter((item): item is NonNullable<typeof item> => Boolean(item))),
  };
}

async function quotesFor(store: Store, owner: string, spec: BuildingSpec, objects: { id: string; catalogId: string; color: string; tint?: string }[], settings: UserSettings): Promise<Record<string, PriceQuote>> {
  const ids = new Set<string>([
    "wall_masonry",
    "floor_slab",
    spec.style.roof === "slab" ? "roof_slab" : "roof_sheet",
    "column_steel",
    ...spec.items.map((item) => item.catalogId),
    ...objects.map((object) => object.catalogId),
  ]);
  const quotes: Record<string, PriceQuote> = {};
  const sources = await store.listSources(owner);
  const mode = settings.priceMode === "lowest" ? "lowest" : "median";
  const shopIds = [...new Set([...objects.map((object) => object.catalogId), ...spec.items.map((item) => item.catalogId)])].filter((id) => {
    const item = getCatalogItem(id);
    return item && (item.placeable || item.category === "openings" || item.category === "equipment" || item.category === "furniture");
  }).slice(0, 40);
  for (const id of shopIds) {
    const item = getCatalogItem(id);
    if (!item) continue;
    const placed = objects.find((object) => object.catalogId === id);
    const quote = await quoteCatalogItem(store, item, sources, mode, undefined, { color: placed?.tint || placed?.color || item.color }).catch(() => null);
    if (quote?.kind === "marketplace" && quote.url) quotes[id] = quote;
  }
  for (const id of ids) {
    if (quotes[id]) continue;
    const item = getCatalogItem(id);
    if (!item) continue;
    const listings = await store.listListings(id);
    const fresh = listings.filter((listing) => !listing.stale);
    const placed = objects.find((object) => object.catalogId === id);
    const ranked = rankListings(
      fresh.map((listing) => ({
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        url: listing.url,
        condition: listing.condition,
        relevance: listing.relevance,
      })),
      item.queryEn,
      "https://jiji.com.et",
      { color: placed?.tint || placed?.color || item.color },
    );
    const closest = [...ranked.listings].sort((a, b) => b.relevance - a.relevance || a.price - b.price)[0];
    const link = closest?.url ? verifiedLink({ price: closest.price, url: closest.url }, "https://jiji.com.et") : null;
    if (closest && link) {
      quotes[id] = {
        unitPrice: closest.price,
        kind: "marketplace",
        url: link,
        title: closest.title,
        confidence: ranked.confidence,
        listingCount: ranked.listings.length,
        min: ranked.min ?? undefined,
        max: ranked.max ?? undefined,
        checkedAt: fresh[0]?.fetchedAt ?? null,
        stale: false,
        sourceName: "Jiji Ethiopia",
        sourceBaseUrl: "https://jiji.com.et",
        listings: ranked.listings,
      };
    }
  }
  return quotes;
}
