"use client";

import type { PriceQuote } from "@/lib/cost/compute";
import type { BuildingSpec } from "@/lib/schemas";
import type { ModelLink, ProjectView } from "@/lib/client/types";

export type StreamEvent =
  | { type: "step"; step: string; label: string; detail?: string }
  | { type: "token"; text: string }
  | { type: "asset_progress"; done: number; total: number; id: string; source: string; ms: number; status: string }
  | { type: "scene_patch"; spec: BuildingSpec; layout: NonNullable<ProjectView["layout"]>; cost: NonNullable<ProjectView["cost"]>; version: number; note: string; warnings: string[]; models?: Record<string, ModelLink> }
  | { type: "price_update"; objectId: string; catalogId: string; quote: PriceQuote }
  | { type: "confirm"; reading: string }
  | { type: "suggestions"; chips: string[] }
  | { type: "done"; version: number | null }
  | { type: "error"; message: string };

export async function streamChat(body: unknown, onEvent: (event: StreamEvent) => void): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "The chat request failed.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((row) => row.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)) as StreamEvent);
    }
  }
}
