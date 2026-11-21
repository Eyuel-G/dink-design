import { r2 } from "@/lib/num";
import { verifiedLink } from "@/lib/prices/link";

export interface RawListing {
  title: string;
  price: number;
  currency: string;
  url: string;
  condition?: "new" | "used" | "unknown";
  unit?: string | null;
  imageUrl?: string | null;
  relevance?: number;
  negotiable?: boolean;
  text?: string;
}

export interface RankedListing {
  title: string;
  price: number;
  currency: string;
  url: string | null;
  condition: "new" | "used" | "unknown";
  relevance: number;
  imageUrl: string | null;
}

export interface RankResult {
  listings: RankedListing[];
  min: number | null;
  median: number | null;
  max: number | null;
  confidence: "high" | "medium" | "low" | "none";
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u1200-\u137f]+/i)
    .filter((token) => token.length > 2);
}

export function keywordScore(title: string, query: string): number {
  const tokens = words(query);
  if (tokens.length === 0) return 0;
  const titleWords = words(title);
  const hits = tokens.filter((token) => titleWords.some((word) => word.includes(token))).length;
  const coverage = hits / tokens.length;
  const focus = titleWords.length === 0 ? 0 : hits / titleWords.length;
  return coverage * 0.55 + Math.min(1, focus * 2) * 0.45;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return r2(sorted[mid]);
  return r2((sorted[mid - 1] + sorted[mid]) / 2);
}

const COLOR_SWATCHES: { name: string; rgb: [number, number, number] }[] = [
  { name: "black", rgb: [20, 20, 20] },
  { name: "white", rgb: [244, 244, 244] },
  { name: "gray", rgb: [140, 140, 140] },
  { name: "beige", rgb: [214, 196, 163] },
  { name: "brown", rgb: [110, 75, 58] },
  { name: "wood", rgb: [184, 136, 88] },
  { name: "orange", rgb: [196, 98, 45] },
  { name: "red", rgb: [154, 64, 48] },
  { name: "blue", rgb: [58, 110, 160] },
  { name: "green", rgb: [62, 83, 72] },
  { name: "cream", rgb: [239, 232, 220] },
  { name: "silver", rgb: [197, 204, 209] },
];

const COLOR_WORDS = ["black", "white", "gray", "grey", "beige", "brown", "wood", "oak", "walnut", "orange", "red", "blue", "green", "cream", "silver", "gold", "pink", "yellow"];

/** The shop word closest to a piece color, so a dark chair prefers a black listing. */
export function nearestColorName(hex: string | null | undefined): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  const rgb: [number, number, number] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (lum < 48) return "black";
  if (lum > 232) return "white";
  let best = COLOR_SWATCHES[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const swatch of COLOR_SWATCHES) {
    const dist = swatch.rgb.reduce((sum, channel, index) => sum + (channel - rgb[index]) ** 2, 0);
    if (dist < bestDist) {
      best = swatch;
      bestDist = dist;
    }
  }
  return best.name;
}

function mentionedColors(text: string): string[] {
  const hay = text.toLowerCase();
  return COLOR_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(hay)).map((word) => (word === "grey" ? "gray" : word === "oak" || word === "walnut" ? "wood" : word));
}

const COLOR_FAMILY: Record<string, string> = {
  cream: "light",
  beige: "light",
  white: "light",
  gray: "metal",
  silver: "metal",
  brown: "warm",
  wood: "warm",
  orange: "warm",
};

function colorAgrees(wanted: string, mentioned: string): boolean {
  return mentioned === wanted || (COLOR_FAMILY[mentioned] != null && COLOR_FAMILY[mentioned] === COLOR_FAMILY[wanted]);
}

export function rankListings(raw: RawListing[], query: string, sourceBaseUrl: string, hint?: { color?: string | null }): RankResult {
  const wanted = nearestColorName(hint?.color);
  const scored = raw
    .filter((listing) => listing.price > 0 && Number.isFinite(listing.price))
    .filter((listing) => !listing.negotiable && !/negotiable/i.test(listing.title))
    .filter((listing) => listing.currency === "ETB" || listing.currency === "USD")
    .map((listing) => {
      const keyword = keywordScore(listing.title, query);
      let relevance = listing.relevance == null ? keyword : Math.min(1, keyword * 0.45 + listing.relevance * 0.55);
      if (wanted) {
        const colors = mentionedColors(`${listing.title} ${listing.text ?? ""}`);
        if (colors.some((color) => colorAgrees(wanted, color))) relevance = Math.min(1, relevance + 0.2);
        else if (colors.length > 0) relevance = Math.max(0, relevance - 0.25);
      }
      const queryTokens = words(query);
      const titleTokens = words(listing.title);
      const missed = queryTokens.filter((token) => token.length > 4 && !titleTokens.some((word) => word.includes(token)));
      if (missed.length > 0) relevance = Math.max(0, relevance - 0.08 * missed.length);
      const queryText = query.toLowerCase();
      for (const word of ["shower", "bathroom", "bath", "baby", "car", "vehicle", "phone", "makeup", "lipstick", "glitter", "shoe", "hat", "led", "lamp", "bulb", "waterfall"]) {
        if (new RegExp(`\\b${word}\\b`, "i").test(listing.title) && !queryText.includes(word)) {
          relevance = Math.max(0, relevance - 0.45);
          break;
        }
      }
      return { listing, relevance };
    })
    .filter((row) => row.relevance > 0.7);

  const prices = scored.map((row) => (row.listing.currency === "USD" ? row.listing.price : row.listing.price));
  const mid = median(prices);
  const kept = mid == null ? [] : scored.filter((row) => row.listing.price >= mid * 0.4 && row.listing.price <= mid * 2.5);
  const keptPrices = kept.map((row) => row.listing.price);
  const listings: RankedListing[] = kept
    .map((row) => ({
      title: row.listing.title.slice(0, 180),
      price: r2(row.listing.price),
      currency: row.listing.currency,
      url: verifiedLink({ price: row.listing.price, url: row.listing.url }, sourceBaseUrl),
      condition: row.listing.condition ?? "unknown",
      relevance: Math.round(row.relevance * 100) / 100,
      imageUrl: null,
    }))
    .filter((listing) => listing.url !== null)
    .sort((a, b) => a.price - b.price || b.relevance - a.relevance);

  const count = listings.length;
  return {
    listings,
    min: count ? r2(Math.min(...keptPrices)) : null,
    median: median(keptPrices),
    max: count ? r2(Math.max(...keptPrices)) : null,
    confidence: count >= 5 ? "high" : count >= 2 ? "medium" : count === 1 ? "low" : "none",
  };
}
