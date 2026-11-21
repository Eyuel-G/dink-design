import { z } from "zod";
import { clientIpHash, guard, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { runPipeline, type SseEvent } from "@/lib/pipeline";
import { allowRequest } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  projectId: z.string().uuid(),
  content: z.string().max(4000).optional(),
  confirm: z.boolean().optional(),
  images: z.array(z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(1_600_000) })).max(2).optional(),
});

export async function POST(request: Request) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  if (!allowRequest(`chat:${ownerKey(identity)}`)) {
    return Response.json({ error: "Too many messages. Wait a minute and try again." }, { status: 429, headers: { "cache-control": "private, no-store" } });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "That message could not be read." }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }
  const store = await getStore();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      await runPipeline({
        store,
        owner: ownerKey(identity),
        projectId: parsed.data.projectId,
        ipHash: clientIpHash(request),
        content: parsed.data.content,
        images: parsed.data.images,
        confirm: parsed.data.confirm,
        emit,
      });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store",
      connection: "keep-alive",
    },
  });
}
