import "server-only";
import { createHash } from "node:crypto";
import { CATALOG_REV, getCatalogItem } from "@/lib/catalog";
import { computeCost, type PriceQuote } from "@/lib/cost/compute";
import { acquireModelLink } from "@/lib/assets/resolve";
import { readyModel, toModelLink, type ModelLink } from "@/lib/assets/library";
import type { Store } from "@/lib/db/types";
import { bareRoomPrompt, fallbackSpec } from "@/lib/intent/fallback";
import { interpretEdit, suggestionChips } from "@/lib/intent/patch";
import { layoutSpec } from "@/lib/layout/place";
import { llmConfigured, planPatch, planSpec, writeReply, type LlmUsage } from "@/lib/llm";
import { quoteCatalogItem, type ExtractionBudget } from "@/lib/prices/engine";
import { dailyLimitUsd } from "@/lib/ratelimit";
import { localReply } from "@/lib/reply";
import { BuildingSpecSchema, type BuildingSpec, type UserSettings } from "@/lib/schemas";

export type SseEvent =
  | { type: "step"; step: string; label: string; detail?: string }
  | { type: "token"; text: string }
  | { type: "asset_progress"; done: number; total: number; id: string; source: string; ms: number; status: string }
  | { type: "scene_patch"; spec: BuildingSpec; layout: ReturnType<typeof layoutSpec>; cost: ReturnType<typeof computeCost>; version: number; note: string; warnings: string[]; models: Record<string, ModelLink> }
  | { type: "price_update"; objectId: string; catalogId: string; quote: PriceQuote }
  | { type: "confirm"; reading: string }
  | { type: "suggestions"; chips: string[] }
  | { type: "done"; version: number | null }
  | { type: "error"; message: string };

const running = new Set<string>();

export async function runPipeline(input: {
  store: Store;
  owner: string;
  projectId: string;
  ipHash: string;
  content?: string;
  images?: { mime: string; data: string }[];
  confirm?: boolean;
  emit: (event: SseEvent) => void;
}): Promise<void> {
  if (running.has(input.projectId)) {
    input.emit({ type: "error", message: "This project is already updating." });
    return;
  }
  running.add(input.projectId);
  try {
    await execute(input);
  } catch (error) {
    input.emit({ type: "error", message: error instanceof Error ? error.message : "The pipeline stopped." });
  } finally {
    running.delete(input.projectId);
  }
}

async function execute(input: {
  store: Store;
  owner: string;
  projectId: string;
  ipHash: string;
  content?: string;
  images?: { mime: string; data: string }[];
  confirm?: boolean;
  emit: (event: SseEvent) => void;
}) {
  const project = await input.store.getProject(input.owner, input.projectId);
  if (!project) {
    input.emit({ type: "error", message: "That project is not on this account." });
    return;
  }
  const settings = await input.store.getSettings(input.owner);
  let content = input.content?.trim() || "";
  let images = input.images ?? [];
  let messageId: string | null = null;
  if (content) {
    messageId = await input.store.addMessage({ projectId: project.id, role: "user", content, images, status: "pending" });
  } else {
    const pending = await input.store.latestPending(project.id);
    if (!pending && !input.confirm) {
      input.emit({ type: "error", message: "There is no message to build from." });
      return;
    }
    if (pending) {
      content = pending.content;
      images = pending.images;
      messageId = pending.id;
    }
  }

  const versions = await input.store.listVersions(project.id);
  const current = versions.find((version) => version.version === project.currentVersion) ?? null;
  input.emit({ type: "step", step: "intent", label: "Understanding" });

  if (input.confirm && project.draft) {
    await buildFromSpec(input, project.id, settings, project.draft, "Confirmed the reading", "Using the reading you confirmed.");
    if (messageId) await input.store.setMessageStatus(messageId, "done");
    return;
  }

  if (current && content && !images.length) {
    const edited = await editSpec(input, current.spec, content, settings);
    if (edited) {
      await buildFromSpec(input, project.id, settings, edited.spec, edited.label, edited.note);
      if (messageId) await input.store.setMessageStatus(messageId, "done");
      return;
    }
    const help = "Tell me what to place, in ordinary words. I use a model from the asset folder when one matches, and look for one when it does not. I can also raise the roof, switch the floor, remove something, resize the room, or reduce cost by a percent.";
    await input.store.addMessage({ projectId: project.id, role: "assistant", content: help, status: "done" });
    input.emit({ type: "token", text: help });
    input.emit({ type: "suggestions", chips: suggestionChips(current.spec) });
    input.emit({ type: "done", version: project.currentVersion });
    if (messageId) await input.store.setMessageStatus(messageId, "done");
    return;
  }

  const planned = await plan(input, content, images);
  if ("reading" in planned) {
    await input.store.setDraft(project.id, planned.spec);
    const reading = planned.reading;
    await input.store.addMessage({ projectId: project.id, role: "assistant", content: `${reading}\n\nCorrect?`, status: "done" });
    input.emit({ type: "confirm", reading });
    input.emit({ type: "token", text: `${reading}\n\nCorrect?` });
    input.emit({ type: "done", version: null });
    if (messageId) await input.store.setMessageStatus(messageId, "done");
    return;
  }
  await buildFromSpec(input, project.id, settings, planned.spec, "Initial layout", planned.note);
  if (messageId) await input.store.setMessageStatus(messageId, "done");
}

async function editSpec(
  input: { store: Store; owner: string; ipHash: string; emit: (event: SseEvent) => void },
  spec: BuildingSpec,
  content: string,
  settings: UserSettings,
): Promise<{ spec: BuildingSpec; label: string; note: string } | null> {
  if (bareRoomPrompt(content)) {
    const local = interpretEdit(content, spec, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct });
    if (local) return { spec: local.spec, label: local.label, note: local.note };
  }
  const budget = await withinBudget(input.store, input.owner);
  if (llmConfigured() && budget) {
    const planned = await planPatch(content, spec);
    if (planned) {
      await charge(input, planned.usage, "patch");
      try {
        const { applyPatch } = await import("@/lib/intent/patch");
        const applied = applyPatch(spec, planned.patch, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct });
        return { spec: applied.spec, label: applied.label, note: planned.patch.note || applied.note };
      } catch {
        /* fall through to the local editor */
      }
    }
  }
  const local = interpretEdit(content, spec, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct });
  if (!local) return null;
  return { spec: local.spec, label: local.label, note: `${local.note} Edited locally.` };
}

async function plan(
  input: { store: Store; owner: string; ipHash: string; emit: (event: SseEvent) => void },
  content: string,
  images: { mime: string; data: string }[],
): Promise<{ spec: BuildingSpec; note: string } | { confirm: true; reading: string; spec: BuildingSpec }> {
  const hash = createHash("sha256").update(`${CATALOG_REV}|${content.toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex");
  if (!images.length) {
    const cached = await input.store.cacheGet<BuildingSpec>(`spec:${hash}`);
    if (cached) {
      const spec = BuildingSpecSchema.parse(cached);
      return { spec, note: "Loaded a saved reading of this prompt." };
    }
  }
  const budget = await withinBudget(input.store, input.owner);
  if (llmConfigured() && budget) {
    const planned = await planSpec(content, images);
    if (planned) {
      await charge(input, planned.usage, "plan");
      if ("confirm" in planned) return { confirm: true, reading: planned.reading, spec: planned.spec };
      await input.store.cacheSet(`spec:${hash}`, planned.spec, 24 * 14);
      return { spec: planned.spec, note: "Planned with the model." };
    }
  }
  const fallback = fallbackSpec(content || "A plain work room");
  const note = images.length
    ? `${fallback.note} The attached photo was not read, because the vision model is unavailable.`
    : budget
      ? fallback.note
      : "The daily planning budget is used up, so this is a built-in layout.";
  if (!images.length) await input.store.cacheSet(`spec:${hash}`, fallback.spec, 24 * 14);
  return { spec: fallback.spec, note };
}

async function buildFromSpec(
  input: { store: Store; owner: string; ipHash: string; emit: (event: SseEvent) => void },
  projectId: string,
  settings: UserSettings,
  spec: BuildingSpec,
  label: string,
  note: string,
  price = true,
) {
  input.emit({ type: "step", step: "layout", label: "Planning" });
  const layout = layoutSpec(spec);
  const ids = [...new Set(layout.objects.map((object) => object.catalogId))];
  input.emit({ type: "step", step: "assets", label: "Fetching assets", detail: `0/${ids.length}` });
  const models: Record<string, ModelLink> = {};
  const missing: string[] = [];
  ids.forEach((id, index) => {
    const item = getCatalogItem(id);
    const ready = item ? readyModel(item) : null;
    if (ready) models[id] = toModelLink(ready);
    else missing.push(id);
    input.emit({
      type: "asset_progress",
      done: index + 1,
      total: ids.length,
      id,
      source: ready ? ready.source : "stand-in",
      ms: 0,
      status: ready ? "ready" : "fallback",
    });
  });
  await mapPool(missing, 2, async (id) => {
    const item = getCatalogItem(id);
    if (!item) return;
    const started = Date.now();
    const link = await acquireModelLink(item).catch(() => null);
    if (link) models[id] = link;
    input.emit({
      type: "asset_progress",
      done: ids.length,
      total: ids.length,
      id,
      source: link?.source ?? "stand-in",
      ms: Date.now() - started,
      status: link ? "ready" : "fallback",
    });
  });
  input.emit({ type: "step", step: "scene", label: "Building" });
  const version = await input.store.saveVersion(projectId, spec, layout.objects, label);
  input.emit({ type: "step", step: "cost", label: "Costing" });
  const cost = computeCost(spec, layout, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct });
  input.emit({ type: "scene_patch", spec, layout, cost, version, note, warnings: layout.warnings, models });

  if (price && settings.priceMode !== "estimate") {
    input.emit({ type: "step", step: "prices", label: "Checking prices" });
    const catalogIds = [...new Set(layout.objects.map((object) => object.catalogId))].slice(0, 12);
    const sources = await input.store.listSources(input.owner);
    const budget = extractionBudget(input);
    await mapPool(catalogIds, 2, async (catalogId) => {
      const item = getCatalogItem(catalogId);
      if (!item) return;
      const quote = await quoteCatalogItem(input.store, item, sources, settings.priceMode, budget).catch(() => null);
      if (!quote) return;
      for (const object of layout.objects.filter((candidate) => candidate.catalogId === catalogId)) {
        input.emit({ type: "price_update", objectId: object.id, catalogId, quote });
      }
    });
  } else {
    input.emit({ type: "step", step: "prices", label: "Checking prices", detail: "Catalog estimates" });
  }

  input.emit({ type: "step", step: "reply", label: "Reply" });
  const freshCost = computeCost(spec, layout, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct });
  const facts = localReply({ spec, layout, cost: freshCost, note, currency: settings.currency, rate: settings.usdEtbRate });
  let text = facts.text;
  if (llmConfigured() && (await withinBudget(input.store, input.owner))) {
    const written = await writeReply(facts.text);
    if (written) {
      await charge(input, written.usage, "reply");
      text = written.text;
    }
  }
  for (const chunk of chunkText(text)) input.emit({ type: "token", text: chunk });
  await input.store.addMessage({ projectId, role: "assistant", content: text, status: "done" });
  input.emit({ type: "suggestions", chips: suggestionChips(spec) });
  input.emit({ type: "done", version });
}

function extractionBudget(input: { store: Store; owner: string; ipHash: string }): ExtractionBudget {
  let slots = 2;
  return {
    async allow() {
      if (slots <= 0) return false;
      slots -= 1;
      if (await withinBudget(input.store, input.owner)) return true;
      slots += 1;
      return false;
    },
    async charge(usage) {
      await charge(input, usage, "extract");
    },
  };
}

async function withinBudget(store: Store, owner: string): Promise<boolean> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const spent = await store.spendSince(owner, start);
  return spent < dailyLimitUsd();
}

async function charge(input: { store: Store; owner: string; ipHash: string }, usage: LlmUsage, kind: string) {
  await input.store.logUsage(input.owner, input.ipHash, usage.inputTokens + usage.outputTokens, usage.costUsd, kind);
}

function chunkText(text: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += 48) parts.push(text.slice(i, i + 48));
  return parts.length ? parts : [text];
}

async function mapPool<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next !== undefined) await task(next);
    }
  });
  await Promise.all(workers);
}
