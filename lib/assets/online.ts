import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { pickModel } from "@/lib/assets/match";
import { cacheDir, type ModelSource, type PlacedModel } from "@/lib/assets/library";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import type { CatalogItem } from "@/lib/schemas";

const MAX_BYTES = 40 * 1024 * 1024;
const FETCH_MS = 12_000;

interface PolyAsset {
  name?: string;
  tags?: string[];
}

let polyIndex: { at: number; data: Record<string, PolyAsset> } | null = null;

export async function fetchMissingModel(item: CatalogItem): Promise<PlacedModel | null> {
  const online = await fetchOnline(item).catch(() => null);
  if (online) return online;
  return generateModel(item).catch(() => null);
}

async function fetchOnline(item: CatalogItem): Promise<PlacedModel | null> {
  const haven = await polyHaven(item).catch(() => null);
  if (haven) return save(item, haven.bytes, "online", haven.label);
  const sketchfab = await sketchfabModel(item).catch(() => null);
  if (sketchfab) return save(item, sketchfab.bytes, "online", sketchfab.label);
  return null;
}

async function polyHaven(item: CatalogItem): Promise<{ bytes: Buffer; label: string } | null> {
  const index = await polyhavenIndex();
  const files = Object.entries(index).map(([id, meta]) => ({
    name: `${id} ${meta.name ?? ""} ${(meta.tags ?? []).join(" ")}.glb`,
    id,
    label: meta.name || id,
  }));
  const chosen = pickModel(item, files);
  if (!chosen) return null;
  const filesDoc = await fetchJson(`https://api.polyhaven.com/files/${chosen.id}`);
  const gltf = nestedGltf(filesDoc);
  if (!gltf?.url) return null;
  const bytes = await packGltf(gltf.url, gltf.include ?? {});
  return bytes ? { bytes, label: `${chosen.label} (Poly Haven, CC0)` } : null;
}

function nestedGltf(doc: unknown): { url?: string; include?: Record<string, { url?: string }> } | null {
  if (!doc || typeof doc !== "object") return null;
  const gltf = (doc as { gltf?: Record<string, { gltf?: { url?: string; include?: Record<string, { url?: string }> } }> }).gltf;
  if (!gltf) return null;
  return gltf["1k"]?.gltf ?? gltf["2k"]?.gltf ?? gltf["4k"]?.gltf ?? null;
}

async function polyhavenIndex(): Promise<Record<string, PolyAsset>> {
  if (polyIndex && Date.now() - polyIndex.at < 6 * 3600_000) return polyIndex.data;
  const data = (await fetchJson("https://api.polyhaven.com/assets?t=models")) as Record<string, PolyAsset>;
  polyIndex = { at: Date.now(), data };
  return data;
}

async function sketchfabModel(item: CatalogItem): Promise<{ bytes: Buffer; label: string } | null> {
  const token = process.env.SKETCHFAB_TOKEN?.trim();
  if (!token) return null;
  const search = new URL("https://api.sketchfab.com/v3/search");
  search.searchParams.set("type", "models");
  search.searchParams.set("q", item.queryEn || item.name);
  search.searchParams.set("downloadable", "true");
  search.searchParams.set("count", "8");
  const body = (await fetchJson(search.toString(), { Authorization: `Token ${token}` })) as {
    results?: { uid?: string; name?: string }[];
  };
  for (const result of body.results ?? []) {
    if (!result.uid) continue;
    const download = (await fetchJson(`https://api.sketchfab.com/v3/models/${result.uid}/download`, {
      Authorization: `Token ${token}`,
    }).catch(() => null)) as { glb?: { url?: string } } | null;
    const url = download?.glb?.url;
    if (!url) continue;
    const bytes = await downloadBytes(url);
    if (!bytes) continue;
    return { bytes, label: `${result.name ?? item.name} (Sketchfab)` };
  }
  return null;
}

async function generateModel(item: CatalogItem): Promise<PlacedModel | null> {
  const prompt = `${item.name}, one object, no room, no background`;
  const meshy = process.env.MESHY_API_KEY?.trim();
  const tripo = process.env.TRIPO_API_KEY?.trim();
  const bytes = meshy ? await meshyGlb(meshy, prompt) : tripo ? await tripoGlb(tripo, prompt) : null;
  if (!bytes) return null;
  return save(item, bytes, "generated", `${item.name} (generated)`);
}

async function meshyGlb(key: string, prompt: string): Promise<Buffer | null> {
  const created = (await fetchJson("https://api.meshy.ai/openapi/v2/text-to-3d", {
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
  }, { mode: "preview", prompt, art_style: "realistic", should_remesh: true })) as { result?: string };
  if (!created.result) return null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const task = (await fetchJson(`https://api.meshy.ai/openapi/v2/text-to-3d/${created.result}`, {
      Authorization: `Bearer ${key}`,
    })) as { status?: string; model_urls?: { glb?: string } };
    if (task.status === "SUCCEEDED" && task.model_urls?.glb) return downloadBytes(task.model_urls.glb);
    if (task.status === "FAILED" || task.status === "CANCELED") return null;
    await delay(2000);
  }
  return null;
}

async function tripoGlb(key: string, prompt: string): Promise<Buffer | null> {
  const created = (await fetchJson(
    "https://api.tripo3d.ai/v2/openapi/task",
    { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    { type: "text_to_model", prompt },
  )) as { data?: { task_id?: string } };
  const taskId = created.data?.task_id;
  if (!taskId) return null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const task = (await fetchJson(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
      Authorization: `Bearer ${key}`,
    })) as { data?: { status?: string; output?: { model?: string; pbr_model?: string } } };
    const status = task.data?.status;
    const url = task.data?.output?.pbr_model || task.data?.output?.model;
    if ((status === "success" || status === "succeeded") && url) return downloadBytes(url);
    if (status === "failed" || status === "banned" || status === "expired") return null;
    await delay(2000);
  }
  return null;
}

async function packGltf(gltfUrl: string, include: Record<string, { url?: string }>): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "dink-model-"));
  try {
    const gltfName = path.basename(new URL(gltfUrl).pathname);
    const gltfFile = path.join(dir, gltfName);
    if (!(await downloadTo(gltfUrl, gltfFile))) return null;
    for (const [relative, file] of Object.entries(include)) {
      if (!file.url || relative.includes("..")) continue;
      const dest = path.join(dir, relative);
      mkdirSync(path.dirname(dest), { recursive: true });
      await downloadTo(file.url, dest);
    }
    const io = new NodeIO();
    const document = await io.read(gltfFile);
    await io.write(path.join(dir, "packed.glb"), document);
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(path.join(dir, "packed.glb"));
    return bytes.byteLength >= 1024 && bytes.byteLength <= MAX_BYTES ? bytes : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function save(item: CatalogItem, bytes: Buffer, source: ModelSource, label: string): PlacedModel {
  mkdirSync(cacheDir(), { recursive: true });
  const file = path.join(cacheDir(), `${item.id}.glb`);
  writeFileSync(file, bytes);
  writeFileSync(path.join(cacheDir(), `${item.id}.json`), JSON.stringify({ source, label }));
  return { catalogId: item.id, source, label, file };
}

async function downloadBytes(raw: string): Promise<Buffer | null> {
  let current = await assertPublicHttpUrl(raw);
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetch(current, { signal: AbortSignal.timeout(FETCH_MS), redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = await assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 1024 || bytes.byteLength > MAX_BYTES) return null;
    return bytes;
  }
  return null;
}

async function downloadTo(raw: string, dest: string): Promise<boolean> {
  const bytes = await downloadBytes(raw);
  if (!bytes) return false;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(dest, bytes);
  return true;
}

async function fetchJson(raw: string, headers?: Record<string, string>, body?: unknown): Promise<unknown> {
  const url = await assertPublicHttpUrl(raw);
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Model host returned ${response.status}`);
  return response.json();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
