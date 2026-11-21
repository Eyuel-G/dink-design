import { z } from "zod";
import { guard, json, ownerKey } from "@/lib/auth";
import { allowRequest } from "@/lib/ratelimit";
import { rankListings } from "@/lib/prices/rank";
import { looksBlocked, parseStructured, politeGet, renderedHtml } from "@/lib/prices/strategies";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  step: z.enum(["detect", "test"]),
  url: z.string().min(4).max(500),
  strategy: z.enum(["api", "structured", "html", "rendered", "llm"]).optional(),
  query: z.string().min(2).max(80).optional(),
});

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  if (!allowRequest(`wizard:${ownerKey(identity)}`, 8)) return json({ error: "The wizard is cooling down. Try again in a minute." }, 429);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Enter a public http(s) URL." }, 400);
  try {
    await assertPublicHttpUrl(body.data.url);
  } catch (error) {
    return json({ error: error instanceof UnsafeUrlError ? error.message : "That URL is blocked." }, 400);
  }
  if (body.data.step === "detect") return detect(body.data.url);
  return testSearch(body.data.url, body.data.strategy || "structured", body.data.query || "chair");
}

async function detect(url: string) {
  const page = await politeGet(url, 8000).catch(() => null);
  if (!page) return json({ error: "The site did not answer in time.", strategy: "rendered", status: "slow" });
  if (page.blocked || looksBlocked(page.status, page.text)) {
    return json({
      status: "blocked",
      strategy: "rendered",
      message: "This site answered with a bot challenge. Dink will not try to get past it. You can still save the source; checks will stay on the catalog estimate.",
      template: templateFrom(url),
    });
  }
  const structured = parseStructured(page.text, page.finalUrl);
  const scriptHeavy = page.text.length < 1500 && /<script/i.test(page.text);
  const strategy = structured.length ? "structured" : scriptHeavy ? "rendered" : "llm";
  return json({
    status: "ok",
    strategy,
    listings: structured.length,
    template: templateFrom(page.finalUrl),
    message: structured.length
      ? "Structured product data was found on the page."
      : scriptHeavy
        ? "The page looks like it needs a rendered fetch."
        : "No structured data. LLM extraction can read the text when a model key is set.",
  });
}

async function testSearch(templateOrUrl: string, strategy: string, query: string) {
  const url = templateOrUrl.includes("{query}") ? templateOrUrl.replaceAll("{query}", encodeURIComponent(query)) : templateOrUrl;
  try {
    await assertPublicHttpUrl(url);
  } catch (error) {
    return json({ error: error instanceof UnsafeUrlError ? error.message : "That URL is blocked." }, 400);
  }
  let html = "";
  let finalUrl = url;
  if (strategy === "rendered") {
    const rendered = await renderedHtml(url);
    if (!rendered.html) return json({ status: "unavailable", message: rendered.reason, results: [] });
    html = rendered.html;
  } else if (strategy === "api") {
    return json({ status: "unavailable", message: "No official feed is wired for this site yet. Choose structured data, HTML, rendered fetch, or LLM extraction.", results: [] });
  } else {
    const page = await politeGet(url, 9000).catch(() => null);
    if (!page) return json({ status: "slow", message: "The test search timed out.", results: [] });
    if (page.blocked) return json({ status: "blocked", message: "The site blocked the test. No listings were invented.", results: [] });
    html = page.text;
    finalUrl = page.finalUrl;
  }
  const ranked = rankListings(parseStructured(html, finalUrl), query, finalUrl);
  return json({
    status: ranked.listings.length ? "ok" : "empty",
    message: ranked.listings.length ? "Parsed results. A link is shown only when the host matches." : "Nothing priced on this host matched the query.",
    results: ranked.listings.slice(0, 5).map((listing) => ({ title: listing.title, price: listing.price, currency: listing.currency, url: listing.url })),
  });
}

function templateFrom(url: string): string {
  try {
    const parsed = new URL(url);
    const keys = ["query", "q", "search", "s", "keyword"];
    for (const key of keys) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "{query}");
        return parsed.toString();
      }
    }
    return `${parsed.origin}/search?query={query}`;
  } catch {
    return url;
  }
}
