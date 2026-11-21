import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {}

function ipv4Private(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

/** Expand a compressed IPv6 address, including a dotted IPv4 tail, into eight groups. */
function expandIpv6(ip: string): number[] | null {
  let body = ip.toLowerCase().split("%")[0];
  const dotted = body.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2].split(".").map((part) => Number(part));
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const hi = (octets[0] << 8) | octets[1];
    const lo = (octets[2] << 8) | octets[3];
    body = `${dotted[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = body.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((group) => Number.parseInt(group || "0", 16));
  if (nums.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return nums;
}

function embeddedIpv4(high: number, low: number): string {
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function ipv6Private(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (groups.every((group) => group === 0)) return true;
  if (g7 === 1 && groups.slice(0, 7).every((group) => group === 0)) return true;
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96), dotted or hex.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    return ipv4Private(embeddedIpv4(g6, g7));
  }
  // NAT64 and 6to4 embed an IPv4 address in the same way.
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return ipv4Private(embeddedIpv4(g6, g7));
  }
  if (g0 === 0x2002) return ipv4Private(embeddedIpv4(g1, g2));
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) return ipv6Private(ip);
  return ipv4Private(ip);
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That is not a usable URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("Only http and https sites can be checked.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with passwords are blocked.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
    throw new UnsafeUrlError("That host is not a public website.");
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f.]+$/i.test(host)) {
    throw new UnsafeUrlError("That address is not a public website.");
  }
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  if (ips.length === 0 || ips.some((ip) => isPrivateAddress(ip))) {
    throw new UnsafeUrlError("That address is not a public website.");
  }
  return url;
}
