import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pickByPhrase, pickModel, tokensOf } from "@/lib/assets/match";
import type { CatalogItem } from "@/lib/schemas";

export type ModelSource = "library" | "online" | "generated";

export interface PlacedModel {
  catalogId: string;
  source: ModelSource;
  label: string;
  file: string;
}

const LIBRARY_DIR = path.join(process.cwd(), "catalog", "models");
const CACHE_DIR = path.join(process.cwd(), "storage", "models");

let listed: { name: string; bytes: number; file: string }[] | null = null;
let listedMtime = 0;

export function libraryDir(): string {
  return LIBRARY_DIR;
}

export function cacheDir(): string {
  return CACHE_DIR;
}

export function invalidateLibraryIndex(): void {
  listed = null;
}

function libraryFiles(): { name: string; bytes: number; file: string }[] {
  let mtime = 0;
  try {
    mtime = statSync(LIBRARY_DIR).mtimeMs;
  } catch {
    listed = [];
    listedMtime = 0;
    return listed;
  }
  if (listed && mtime === listedMtime) return listed;
  let names: string[] = [];
  try {
    names = readdirSync(LIBRARY_DIR);
  } catch {
    listed = [];
    return listed;
  }
  listed = names
    .filter((name) => name.toLowerCase().endsWith(".glb"))
    .filter((name) => !name.toLowerCase().includes("crdownload") && !name.toLowerCase().startsWith("unconfirmed"))
    .filter((name) => !/^[0-9a-f]{16,}(?: \(\d+\))?\.glb$/i.test(name))
    .map((name) => {
      const file = path.join(LIBRARY_DIR, name);
      let bytes = 0;
      try {
        bytes = statSync(file).size;
      } catch {
        bytes = 0;
      }
      return { name, bytes, file };
    })
    .filter((entry) => entry.bytes >= 1024);
  listedMtime = mtime;
  return listed;
}

const OPTION_NOUNS = ["sewing", "curtain", "window", "column", "chair", "sofa", "bed", "desk", "table", "lamp", "tv", "rug", "carpet", "sink", "cabinet", "wardrobe", "shelf", "rack", "door", "bmw", "car"];

/** Other files in catalog/models that name the same kind of object. */
export function libraryOptions(phrase: string, currentFile?: string): { file: string; label: string }[] {
  const tokens = tokensOf(phrase);
  const noun = OPTION_NOUNS.find((name) => tokens.includes(name));
  if (!noun) return [];
  const current = currentFile?.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return libraryFiles()
    .filter((entry) => entry.name.toLowerCase() !== current && !/\(\d+\)/.test(entry.name) && tokensOf(entry.name).includes(noun))
    .map((entry) => ({
      file: entry.name,
      label: entry.name.replace(/\.glb$/i, "").replace(/[_-]+/g, " "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 40);
}

export function matchLibraryPhrase(phrase: string): { name: string; file: string } | null {
  const chosen = pickByPhrase(phrase, libraryFiles());
  return chosen ? { name: chosen.name, file: chosen.file } : null;
}

function pinnedLibraryFile(item: CatalogItem): string | null {
  const name = item.glbPath?.split(/[/\\]/).pop() ?? "";
  if (!name.toLowerCase().endsWith(".glb") || name.includes("..")) return null;
  return libraryFiles().find((file) => file.name === name)?.file ?? null;
}

export function libraryModel(item: CatalogItem): PlacedModel | null {
  const pinned = pinnedLibraryFile(item);
  if (pinned) {
    return {
      catalogId: item.id,
      source: "library",
      label: item.name,
      file: pinned,
    };
  }
  const chosen = pickModel(item, libraryFiles());
  if (!chosen) return null;
  return {
    catalogId: item.id,
    source: "library",
    label: chosen.name.replace(/\.glb$/i, "").replace(/[_-]+/g, " "),
    file: chosen.file,
  };
}

export function cachedModel(item: CatalogItem): PlacedModel | null {
  const file = path.join(CACHE_DIR, `${item.id}.glb`);
  try {
    if (statSync(file).size < 1024) return null;
  } catch {
    return null;
  }
  let source: ModelSource = "online";
  let label = item.name;
  try {
    const meta = JSON.parse(readFileSync(path.join(CACHE_DIR, `${item.id}.json`), "utf8")) as { source?: ModelSource; label?: string };
    if (meta.source === "online" || meta.source === "generated" || meta.source === "library") source = meta.source;
    if (meta.label) label = meta.label;
  } catch {
    source = "online";
  }
  return { catalogId: item.id, source, label, file };
}

/** A model that is already on disk: the user's folder wins over a previous download. */
export function readyModel(item: CatalogItem): PlacedModel | null {
  return libraryModel(item) ?? cachedModel(item);
}

export interface ModelLink {
  url: string;
  source: ModelSource;
  label: string;
}

export function modelUrl(catalogId: string): string {
  return `/api/models/file?catalogId=${encodeURIComponent(catalogId)}`;
}

export function toModelLink(model: PlacedModel): ModelLink {
  const file = model.file.split(/[/\\]/).pop() ?? "";
  const url = `${modelUrl(model.catalogId)}&file=${encodeURIComponent(file)}`;
  return { url, source: model.source, label: model.label };
}

export function readyModelLinks(items: CatalogItem[]): Record<string, ModelLink> {
  const links: Record<string, ModelLink> = {};
  for (const item of items) {
    const model = readyModel(item);
    if (model) links[item.id] = toModelLink(model);
  }
  return links;
}

export function modelFileFor(catalogId: string, item: CatalogItem | undefined, requestedName?: string | null): string | null {
  if (item && item.id === catalogId) {
    const ready = readyModel(item);
    if (ready) return ready.file;
  }
  const safe = requestedName?.split(/[/\\]/).pop() ?? "";
  if (safe.toLowerCase().endsWith(".glb") && !safe.includes("..")) {
    const found = libraryFiles().find((file) => file.name === safe);
    if (found) return found.file;
  }
  const cached = path.join(CACHE_DIR, `${catalogId}.glb`);
  try {
    if (statSync(cached).size >= 1024) return cached;
  } catch {
    /* no download yet */
  }
  return null;
}
