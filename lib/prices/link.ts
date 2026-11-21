export interface LinkInput {
  price: number;
  url: string;
}

export function sourceHostname(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function hostMatches(hostname: string, sourceHost: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  const source = sourceHost.replace(/^www\./, "").toLowerCase();
  if (!host || !source) return false;
  if (host === source) return true;
  return host.endsWith(`.${source}`);
}

/** A marketplace link exists only for a parsed positive price on the source's own host. */
export function verifiedLink(listing: LinkInput, sourceBaseUrl: string): string | null {
  if (!(listing.price > 0) || !Number.isFinite(listing.price)) return null;
  const sourceHost = sourceHostname(sourceBaseUrl);
  if (!sourceHost) return null;
  let parsed: URL;
  try {
    parsed = new URL(listing.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!hostMatches(parsed.hostname, sourceHost)) return null;
  return parsed.toString();
}
