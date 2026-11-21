export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
