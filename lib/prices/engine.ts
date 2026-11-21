import "server-only";
import { createHash } from "node:crypto";
import type { CatalogItem } from "@/lib/schemas";
import type { PriceQuote } from "@/lib/cost/compute";
import type { SourceRow, Store } from "@/lib/db/types";
import { extractListings, llmConfigured, type LlmUsage } from "@/lib/llm";
import { rankListings, type RawListing } from "@/lib/prices/rank";
import { jijiSelectors, parseSelectors, parseStructured, politeGet, renderedHtml, robotsAllow, type SelectorConfig } from "@/lib/prices/strategies";
import { nearestColorName } from "@/lib/prices/rank";
import { sanitizeUntrusted } from "@/lib/sanitize";
import { sourceHostname } from "@/lib/prices/link";

const hostLocks = new Map<string, Promise<void>>();

async function withHost<T>(host: string, task: () => Promise<T>): Promise<T> {
  const previous = hostLocks.get(host) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  hostLocks.set(host, previous.then(() => gate));
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

export interface ExtractionBudget {
  allow(): Promise<boolean>;
  charge(usage: LlmUsage): Promise<void>;
}

export async function quoteCatalogItem(
  store: Store,
  item: CatalogItem,
  sources: SourceRow[],
  mode: "estimate" | "lowest" | "median" | "pinned",
  budget?: ExtractionBudget,
  prefer?: { color?: string | null },
): Promise<PriceQuote> {
  const estimate = baseQuote(item);
  if (mode === "estimate") return estimate;
  const enabled = sources.filter((source) => source.enabled).sort((a, b) => a.priority - b.priority);
  if (enabled.length === 0) return { ...estimate, failure: "none" };
  const colorName = nearestColorName(prefer?.color || item.color);
  const cacheKey = createHash("sha256").update(`${item.id}|${colorName ?? ""}|${enabled.map((source) => source.id).join(",")}|${mode}|shop7`).digest("hex");
  const cached = await store.cacheGet<PriceQuote>(cacheKey);
  if (cached) return { ...cached, listings: cached.listings ?? [] };

  let failure: PriceQuote["failure"] = "none";
  let sourceName: string | null = null;
  const collected: RawListing[] = [];
  let base = enabled[0]?.baseUrl || "";

  for (const source of enabled) {
    if (source.strategy === "api") continue;
    sourceName = source.name;
    base = source.baseUrl;
    const queries = [colorName ? `${item.queryEn} ${colorName}` : "", item.queryEn, item.queryAm].filter((query, index, all) => query && all.indexOf(query) === index);
    const sourceRaw: RawListing[] = [];
    for (const query of queries) {
      const outcome = await searchSource(store, source, query, budget);
      if (outcome.blocked) {
        failure = "blocked";
        await store.updateSource(source.id, { status: "blocked", robotsOk: false });
        await store.cacheSet(`block:${source.id}`, { blocked: true }, source.refreshHours);
        break;
      }
      if (outcome.slow) failure = failure === "blocked" ? failure : "slow";
      sourceRaw.push(...outcome.listings);
      if (rankListings(sourceRaw, item.queryEn, source.baseUrl, { color: prefer?.color || item.color }).listings.length > 0) break;
    }
    const rankedSource = rankListings(sourceRaw, item.queryEn, source.baseUrl, { color: prefer?.color || item.color });
    collected.push(...sourceRaw);
    if (rankedSource.listings.length && source) {
      await store.replaceListings(
        source.id,
        item.id,
        rankedSource.listings.map((row) => ({
          sourceId: source.id,
          catalogId: item.id,
          title: row.title,
          price: row.price,
          currency: row.currency,
          url: row.url || "",
          host: sourceHostname(row.url || source.baseUrl) || "",
          condition: row.condition,
          relevance: row.relevance,
        })),
      );
    }
  }

  const ranked = rankListings(collected, item.queryEn, base, { color: prefer?.color || item.color });
  if (ranked.listings.length === 0) {
    const quote = { ...estimate, failure, sourceName, sourceBaseUrl: base, checkedAt: new Date().toISOString(), listings: [] };
    await store.cacheSet(cacheKey, quote, 6);
    return quote;
  }
  const closest = [...ranked.listings].sort((a, b) => b.relevance - a.relevance || a.price - b.price)[0];
  const quote: PriceQuote = {
    unitPrice: closest?.price ?? item.basePriceEtb,
    kind: closest?.url ? "marketplace" : "estimate",
    url: closest?.url ?? null,
    confidence: ranked.confidence,
    listingCount: ranked.listings.length,
    min: ranked.min ?? undefined,
    max: ranked.max ?? undefined,
    checkedAt: new Date().toISOString(),
    failure,
    sourceName,
    sourceBaseUrl: base,
    title: closest?.title ?? null,
    listings: ranked.listings,
  };
  await store.cacheSet(cacheKey, quote, enabled[0]?.refreshHours ?? 12);
  if (enabled[0]) {
    await store.addSnapshot({
      catalogId: item.id,
      currency: "ETB",
      min: ranked.min,
      median: ranked.median,
      max: ranked.max,
      count: ranked.listings.length,
      confidence: ranked.confidence,
    });
  }
  return quote;
}

async function searchSource(store: Store, source: SourceRow, query: string, budget?: ExtractionBudget): Promise<{ listings: RawListing[]; blocked: boolean; slow: boolean }> {
  const host = sourceHostname(source.baseUrl) || source.baseUrl;
  return withHost(host, async () => {
    const searchUrl = source.searchUrlTemplate.replaceAll("{query}", encodeURIComponent(query));
    try {
      const robotsUrl = new URL("/robots.txt", source.baseUrl).toString();
      const robots = await politeGet(robotsUrl, 6000);
      if (robots.blocked) return { listings: [], blocked: true, slow: false };
      const pathName = new URL(searchUrl).pathname;
      const allowed = robotsAllow(robots.text, pathName);
      await store.updateSource(source.id, { robotsOk: allowed, status: allowed ? "ok" : "robots" });
      if (!allowed) return { listings: [], blocked: false, slow: false };
      let html = "";
      let finalUrl = searchUrl;
      let blocked = false;
      if (source.strategy === "rendered") {
        const rendered = await renderedHtml(searchUrl);
        if (!rendered.html) return { listings: [], blocked: false, slow: true };
        html = rendered.html;
      } else {
        const page = await politeGet(searchUrl, 9000);
        html = page.text;
        finalUrl = page.finalUrl;
        blocked = page.blocked;
        if (page.status === 0) return { listings: [], blocked: false, slow: true };
      }
      if (blocked) return { listings: [], blocked: true, slow: false };
      const structured = parseStructured(html, finalUrl);
      const selectors = {
        ...jijiSelectors(source.baseUrl),
        ...((source.config?.selectors as SelectorConfig) || {}),
      };
      const selected = parseSelectors(html, finalUrl, selectors);
      let extracted: RawListing[] = [...structured, ...selected];
      if ((source.strategy === "llm" || source.strategy === "rendered") && llmConfigured() && budget && extracted.length < 3 && (await budget.allow())) {
        const llm = await extractListings(sanitizeUntrusted(html, 8000), query);
        if (llm) await budget.charge(llm.usage);
        if (llm) {
          extracted = extracted.concat(
            llm.listings.map((listing) => ({
              title: listing.title,
              price: listing.price,
              currency: listing.currency.toUpperCase(),
              url: listing.url,
              condition: listing.condition,
              relevance: listing.relevance,
            })),
          );
        }
      }
      return { listings: extracted, blocked: false, slow: false };
    } catch {
      return { listings: [], blocked: false, slow: true };
    }
  });
}

function baseQuote(item: CatalogItem): PriceQuote {
  return {
    unitPrice: item.basePriceEtb,
    kind: "estimate",
    url: null,
    confidence: "none",
    listingCount: 0,
    checkedAt: new Date().toISOString(),
    failure: null,
    sourceName: null,
    listings: [],
  };
}

export async function recheckListing(store: Store, source: SourceRow, listing: { id: string; url: string }): Promise<"ok" | "stale" | "blocked" | "slow"> {
  try {
    const page = await politeGet(listing.url, 8000);
    if (page.blocked) {
      await store.updateSource(source.id, { status: "blocked" });
      await store.cacheSet(`block:${source.id}`, { blocked: true }, source.refreshHours);
      return "blocked";
    }
    if (page.status === 404) {
      if (listing.id) await store.markListingStale(listing.id);
      return "stale";
    }
    if (page.status === 0) return "slow";
    return "ok";
  } catch {
    return "slow";
  }
}
