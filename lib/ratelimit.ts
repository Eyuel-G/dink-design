const hits = new Map<string, number[]>();

export function allowRequest(key: string, limit = Number(process.env.RATE_LIMIT_PER_MIN || 20), windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function dailyLimitUsd(): number {
  const value = Number(process.env.DAILY_SPEND_LIMIT_USD || 5);
  return Number.isFinite(value) && value > 0 ? value : 5;
}
