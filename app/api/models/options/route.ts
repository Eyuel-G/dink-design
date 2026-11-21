import { guard, json } from "@/lib/auth";
import { libraryOptions } from "@/lib/assets/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const url = new URL(request.url);
  const phrase = url.searchParams.get("q") ?? "";
  const file = url.searchParams.get("file") ?? "";
  return json({ options: libraryOptions(phrase, file) });
}
