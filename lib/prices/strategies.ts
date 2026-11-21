import * as cheerio from "cheerio";
import { sanitizeUntrusted } from "@/lib/sanitize";
import type { RawListing } from "@/lib/prices/rank";

export interface SelectorConfig {
  item?: string;
  title?: string;
  price?: string;
  link?: string;
}

const USER_AGENT = "DinkDesignBot/0.1 (local price check; one request at a time; respects robots and bot challenges)";

export function parseStructured(html: string, pageUrl: string): RawListing[] {
  const $ = cheerio.load(html);
  const found: RawListing[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const text = $(element).text();
    try {
      collectJsonLd(JSON.parse(text), found, pageUrl);
    } catch {
      /* untrusted page JSON is skipped when it does not parse */
    }
  });
  const nextData = $("#__NEXT_DATA__").text();
  if (nextData) {
    try {
      walkNextData(JSON.parse(nextData), found, pageUrl, 0);
    } catch {
      /* ignore */
    }
  }
  const amount = $("meta[property='product:price:amount']").attr("content");
  const title = $("meta[property='og:title']").attr("content");
  const url = $("meta[property='og:url']").attr("content") || pageUrl;
  const price = Number(amount);
  if (title && price > 0) {
    found.push({ title: sanitizeUntrusted(title, 180), price, currency: "ETB", url, condition: "unknown" });
  }
  return found.slice(0, 20);
}

function collectJsonLd(node: unknown, found: RawListing[], pageUrl: string) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((entry) => collectJsonLd(entry, found, pageUrl));
    return;
  }
  const record = node as Record<string, unknown>;
  const type = String(record["@type"] || "");
  if (type === "Product" || type === "Offer" || type === "ItemList") {
    const offer = (record.offers && typeof record.offers === "object" ? record.offers : record) as Record<string, unknown>;
    const price = Number(offer.price ?? offer.lowPrice);
    const title = String(record.name || offer.name || "");
    const url = String(record.url || offer.url || pageUrl);
    if (title && price > 0) {
      found.push({
        title: sanitizeUntrusted(title, 180),
        price,
        currency: String(offer.priceCurrency || "ETB").slice(0, 3).toUpperCase(),
        url: resolveUrl(url, pageUrl),
        condition: /used/i.test(String(offer.itemCondition || "")) ? "used" : "unknown",
        negotiable: /negotiable/i.test(title),
      });
    }
    if (Array.isArray(record.itemListElement)) collectJsonLd(record.itemListElement, found, pageUrl);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collectJsonLd(value, found, pageUrl);
  }
}

function walkNextData(node: unknown, found: RawListing[], pageUrl: string, depth: number) {
  if (!node || depth > 6 || found.length > 20) return;
  if (Array.isArray(node)) {
    node.slice(0, 30).forEach((entry) => walkNextData(entry, found, pageUrl, depth + 1));
    return;
  }
  if (typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const title = record.title || record.name;
  const price = Number(record.price ?? record.price_amount ?? record.amount);
  const url = record.url || record.link;
  if (typeof title === "string" && price > 0 && typeof url === "string") {
    found.push({
      title: sanitizeUntrusted(title, 180),
      price,
      currency: String(record.currency || "ETB").slice(0, 3).toUpperCase(),
      url: resolveUrl(url, pageUrl),
      negotiable: /negotiable/i.test(title),
    });
  }
  for (const value of Object.values(record)) walkNextData(value, found, pageUrl, depth + 1);
}

/** Jiji Ethiopia renders each advert as a link with a title and an ETB price. */
export function jijiSelectors(baseUrl: string): SelectorConfig {
  if (!/jiji\.com\.et$/i.test(baseUrl.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, ""))) return {};
  return {
    item: "a.qa-advert-list-item",
    title: ".qa-advert-title",
    price: ".qa-advert-price",
    link: "a.qa-advert-list-item",
  };
}

export function parseSelectors(html: string, pageUrl: string, selectors: SelectorConfig): RawListing[] {
  if (!selectors.item || !selectors.title || !selectors.price) return [];
  const $ = cheerio.load(html);
  const found: RawListing[] = [];
  $(selectors.item).each((_, element) => {
    const title = $(element).find(selectors.title!).text();
    const priceText = $(element).find(selectors.price!).text();
    const href = $(element).find(selectors.link || "a").attr("href") || $(element).attr("href") || pageUrl;
    const price = Number(priceText.replace(/[^0-9.]/g, ""));
    if (!title || !(price > 0)) return;
    const url = listingUrl(resolveUrl(href, pageUrl));
    found.push({
      title: sanitizeUntrusted(title, 180),
      price,
      currency: "ETB",
      url,
      text: sanitizeUntrusted($(element).text(), 400),
      negotiable: /negotiable/i.test(title) || /negotiable/i.test(priceText),
    });
  });
  return found.slice(0, 20);
}

function listingUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function resolveUrl(value: string, pageUrl: string): string {
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return value;
  }
}

export function looksBlocked(status: number, body: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  return /cf-mitigated|captcha|just a moment|attention required|access denied/i.test(body.slice(0, 4000));
}

export function robotsAllow(body: string, pathName: string): boolean {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  let applies = false;
  const rules: { allow: boolean; path: string }[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      applies = value === "*" || /dink/i.test(value);
      continue;
    }
    if (!applies) continue;
    if (key === "disallow" && value) rules.push({ allow: false, path: value });
    if (key === "allow" && value) rules.push({ allow: true, path: value });
  }
  const matches = rules.filter((rule) => pathName.startsWith(rule.path));
  if (matches.length === 0) return true;
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0].allow;
}

const MAX_PAGE_BYTES = 256_000;

async function readCapped(response: Response, maxBytes = MAX_PAGE_BYTES): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = maxBytes - total;
      chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
      total += Math.min(value.byteLength, room);
      if (value.byteLength > room) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function politeGet(url: string, timeoutMs = 9000): Promise<{ status: number; text: string; finalUrl: string; blocked: boolean }> {
  const { assertPublicHttpUrl } = await import("@/lib/ssrf");
  let current = await assertPublicHttpUrl(url);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location) return { status: response.status, text: "", finalUrl: current.toString(), blocked: true };
      current = await assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    const text = await readCapped(response);
    return { status: response.status, text, finalUrl: current.toString(), blocked: looksBlocked(response.status, text) };
  }
  return { status: 0, text: "", finalUrl: current.toString(), blocked: true };
}

export async function renderedHtml(url: string): Promise<{ html: string | null; reason: string }> {
  const { assertPublicHttpUrl } = await import("@/lib/ssrf");
  const safe = await assertPublicHttpUrl(url);
  if (process.env.FIRECRAWL_API_KEY) {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ url: safe.toString(), formats: ["html"] }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { html: null, reason: "Rendered fetch was refused." };
    }
    const raw = await readCapped(response);
    try {
      const payload = JSON.parse(raw) as { data?: { html?: string } };
      const html = payload.data?.html?.slice(0, MAX_PAGE_BYTES) ?? null;
      return { html, reason: html ? "firecrawl" : "Rendered fetch returned no HTML." };
    } catch {
      return { html: null, reason: "Rendered fetch returned no HTML." };
    }
  }
  if (process.env.BROWSERLESS_TOKEN) {
    const response = await fetch(`https://chrome.browserless.io/content?token=${encodeURIComponent(process.env.BROWSERLESS_TOKEN)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: safe.toString() }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { html: null, reason: "Rendered fetch was refused." };
    }
    return { html: await readCapped(response), reason: "browserless" };
  }
  return { html: null, reason: "Rendered fetch is not configured. Add FIRECRAWL_API_KEY or BROWSERLESS_TOKEN." };
}

export { USER_AGENT };
