import type { CatalogItem } from "@/lib/schemas";

const ALIAS: Record<string, string> = {
  offee: "coffee",
  kichen: "kitchen",
  wodden: "wooden",
  cortina: "curtain",
  television: "tv",
  televisions: "tv",
  couch: "sofa",
  pillar: "column",
  pillars: "column",
  columns: "column",
  chandelier: "lamp",
  led: "lamp",
  shelves: "shelf",
  racks: "rack",
  cabinets: "cabinet",
  windows: "window",
  lamps: "lamp",
  desks: "desk",
  chairs: "chair",
  tables: "table",
};

const DROP = new Set([
  "glb",
  "mb",
  "free",
  "game",
  "ready",
  "gameready",
  "low",
  "poly",
  "model",
  "models",
  "3d",
  "the",
  "and",
  "with",
  "new",
  "set",
  "pack",
  "unity",
  "pkg",
  "included",
  "collection",
  "part",
  "vr",
  "experience",
  "assets",
  "design",
  "minimalis",
  "clean",
  "baked",
  "immersive",
  "visualisation",
  "visualization",
  "texture",
  "textures",
]);

const SCENE = new Set(["living", "room", "hallway", "racing", "bmw", "uaz", "underwater", "steampunk", "cartoon", "laser", "vehicle", "bricks", "flooring", "scene"]);

export interface ModelCandidate {
  name: string;
  bytes?: number;
}

export function expandAliases(phrase: string): string {
  return phrase.toLowerCase().replace(/[a-z0-9]+/g, (word) => ALIAS[word] ?? word);
}

const OBJECT_NOUNS = new Set([
  "lamp",
  "kitchen",
  "bed",
  "sofa",
  "wardrobe",
  "sewing",
  "window",
  "sink",
  "curtain",
  "carpet",
  "rug",
  "tv",
  "table",
  "chair",
  "desk",
  "column",
  "door",
  "cabinet",
  "shelf",
  "rack",
  "car",
  "bmw",
]);

/** The library file whose name says the same thing the user asked for. */
export function pickByPhrase<T extends ModelCandidate>(phrase: string, files: T[]): T | null {
  const raw = phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !DROP.has(word));
  const wanted = tokensOf(phrase);
  if (!wanted.length) return null;
  const must = wanted.some((token) => token.length >= 3) ? wanted.filter((token) => token.length >= 3) : wanted;
  let best: { file: T; score: number; tokens: number; bytes: number } | null = null;
  for (const file of files) {
    if (file.bytes === 0) continue;
    if (/\(\d+\)/.test(file.name)) continue;
    const fileTokens = tokensOf(file.name);
    if (!must.every((token) => fileTokens.includes(token))) continue;
    const lower = file.name.toLowerCase();
    let score = must.length * 12;
    for (const word of raw) {
      if (lower.includes(word)) score += 6;
    }
    for (const token of fileTokens) {
      if (wanted.includes(token)) continue;
      score -= SCENE.has(token) ? 6 : 2;
      if (OBJECT_NOUNS.has(token)) score -= 8;
    }
    if (fileTokens.includes("damaged") || fileTokens.includes("sci")) score -= 6;
    if (/unity|gameready|collection/i.test(file.name)) score -= 10;
    if (score < 8) continue;
    const bytes = file.bytes ?? Number.MAX_SAFE_INTEGER;
    const better =
      !best ||
      score > best.score ||
      (score === best.score && fileTokens.length < best.tokens) ||
      (score === best.score && fileTokens.length === best.tokens && bytes < best.bytes);
    if (better) best = { file, score, tokens: fileTokens.length, bytes };
  }
  return best?.file ?? null;
}

export function tokensOf(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (!raw || DROP.has(raw) || /^\d+$/.test(raw)) continue;
    const token = ALIAS[raw] ?? raw;
    if (token.length < 2 || DROP.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

function requiredNouns(item: CatalogItem): string[] {
  const id = item.id;
  if (id.includes("sewing")) return ["sewing"];
  if (id.includes("bed")) return ["bed"];
  if (id.includes("sofa")) return ["sofa"];
  if (id.includes("wardrobe")) return ["wardrobe"];
  if (id.includes("window") || id.includes("shutter")) return ["window"];
  if (id.includes("column")) return ["column"];
  if (id.includes("light") || id.includes("lamp")) return ["lamp"];
  if (id.includes("chair")) return ["chair"];
  if (id.includes("desk")) return ["desk"];
  if (id.includes("kitchen")) return ["kitchen", "cabinet"];
  if (id.includes("cabinet")) return ["cabinet"];
  if (id.includes("curtain")) return ["curtain"];
  if (id.includes("carpet") || id.includes("rug") || id.includes("floor")) return ["carpet", "rug"];
  if (id.includes("sink")) return ["sink"];
  if (id.includes("fan")) return ["fan"];
  if (id.includes("door")) return ["door"];
  if (id.includes("tv")) return ["tv"];
  if (id.includes("table") || id.includes("counter")) return ["table"];
  if (id.includes("shelf") || id.includes("rack") || id.includes("gondola")) return ["shelf", "rack"];
  return tokensOf(`${item.queryEn} ${item.name}`).filter((token) => token.length >= 3).slice(0, 3);
}

function wants(item: CatalogItem, token: string): boolean {
  const id = `${item.id} ${item.tags.join(" ")} ${item.queryEn}`.toLowerCase();
  return id.includes(token);
}

/** Pick the library file that names the same object. A weak overlap returns null. */
export function pickModel<T extends ModelCandidate>(item: CatalogItem, files: T[]): T | null {
  const required = requiredNouns(item);
  if (!required.length) return null;
  const itemTokens = new Set(tokensOf(`${item.id} ${item.name} ${item.tags.join(" ")} ${item.queryEn}`));
  let best: { file: T; score: number; tokens: number; bytes: number } | null = null;
  for (const file of files) {
    if (file.bytes === 0) continue;
    if (/\(\d+\)/.test(file.name)) continue;
    const fileTokens = tokensOf(file.name);
    if (!required.some((noun) => fileTokens.includes(noun))) continue;
    let score = 12;
    for (const token of fileTokens) {
      if (itemTokens.has(token)) score += 4;
    }
    if (fileTokens.includes("hanging") && wants(item, "light")) score += 6;
    if (fileTokens.includes("dining") || fileTokens.includes("dinner")) score += wants(item, "dining") ? 8 : -6;
    if (fileTokens.includes("coffee")) score += wants(item, "coffee") ? 10 : -8;
    const workSurface = item.id.includes("cutting") || item.id.includes("worktable") || item.id.includes("packing");
    if (workSurface && fileTokens.includes("modern") && !fileTokens.includes("dining")) score += 10;
    if (workSurface && file.name === "table.glb") score -= 10;
    if (fileTokens.includes("school") || fileTokens.includes("classroom")) score += wants(item, "student") || wants(item, "school") || wants(item, "classroom") ? 8 : -10;
    if (fileTokens.includes("desk")) score += wants(item, "desk") ? 4 : -8;
    if (fileTokens.includes("chair") && !wants(item, "chair")) score -= 7;
    if (fileTokens.includes("table") && wants(item, "chair") && !wants(item, "table")) score -= 6;
    if (fileTokens.includes("curtain") && !wants(item, "window") && !wants(item, "curtain")) score -= 8;
    if (fileTokens.includes("window") && required.includes("curtain") && !required.includes("window")) score -= 10;
    if (required.includes("curtain") && file.name.startsWith("indoor_curtain")) score += 3;
    if (fileTokens.includes("tv") && !wants(item, "tv")) score -= 8;
    for (const token of ["lamp", "kitchen", "bed", "sofa", "wardrobe", "sewing", "window", "sink", "curtain", "carpet", "rug", "tv"]) {
      if (fileTokens.includes(token) && !required.includes(token) && !itemTokens.has(token)) score -= 9;
    }
    for (const token of fileTokens) {
      if (SCENE.has(token)) score -= 8;
    }
    if (fileTokens.includes("damaged") || fileTokens.includes("sci")) score -= 6;
    if (/unity|gameready|collection/i.test(file.name)) score -= 10;
    if (item.id.includes("column") && fileTokens.includes("classical")) score += 8;
    if (item.id.includes("column") && fileTokens.includes("marble")) score += 6;
    if (score < 12) continue;
    const bytes = file.bytes ?? Number.MAX_SAFE_INTEGER;
    const better =
      !best ||
      score > best.score ||
      (score === best.score && fileTokens.length < best.tokens) ||
      (score === best.score && fileTokens.length === best.tokens && bytes < best.bytes);
    if (better) best = { file, score, tokens: fileTokens.length, bytes };
  }
  return best?.file ?? null;
}
