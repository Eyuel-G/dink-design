import raw from "@/catalog/items.json";
import { CatalogItemSchema, type CatalogItem } from "@/lib/schemas";

export const CATALOG_REV = "2026-11-21-place";

export const CATALOG: CatalogItem[] = CatalogItemSchema.array().parse(raw);

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((item) => [item.id, item]),
);

const EXTRA_CATALOG = new Map<string, CatalogItem>();

/** Pieces named in chat and backed by a library or downloaded model. */
export function rememberCatalog(items: readonly CatalogItem[] | undefined) {
  if (!items) return;
  for (const item of items) {
    if (!CATALOG_BY_ID.has(item.id)) EXTRA_CATALOG.set(item.id, item);
  }
}

export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG_BY_ID.get(id) ?? EXTRA_CATALOG.get(id);
}

export function catalogManifest(): string {
  return CATALOG.map(
    (item) =>
      `${item.id} | ${item.name} | ${item.category} | ${item.dimW}x${item.dimL}x${item.dimH}m | ${item.placeable ? "placeable" : "measured"}${item.tags.includes("uploaded") ? " | uploaded, include only when the user names this piece" : ""}`,
  ).join("\n");
}

const KEYWORDS: { phrase: string; id: string }[] = [
  { phrase: "curtain", id: "curtain" },
  { phrase: "carpet", id: "rug" },
  { phrase: "rug", id: "rug" },
  { phrase: "television", id: "tv" },
  { phrase: "tv", id: "tv" },
  { phrase: "sink", id: "sink" },
  { phrase: "chandelier", id: "light_highbay" },
  { phrase: "lamp", id: "light_highbay" },
  { phrase: "art deco coffee table", id: "coffee_table_art_deco" },
  { phrase: "coffee table", id: "coffee_table_art_deco" },
  { phrase: "offee table", id: "coffee_table_art_deco" },
  { phrase: "cutting table", id: "cutting_table" },
  { phrase: "sewing station", id: "sewing_industrial" },
  { phrase: "sewing machine", id: "sewing_industrial" },
  { phrase: "sewing", id: "sewing_industrial" },
  { phrase: "fabric rack", id: "fabric_rack" },
  { phrase: "pallet", id: "pallet_rack" },
  { phrase: "shelf", id: "shelf_industrial" },
  { phrase: "shelves", id: "shelf_industrial" },
  { phrase: "storage", id: "shelf_industrial" },
  { phrase: "ironing", id: "ironing_station" },
  { phrase: "packing", id: "packing_table" },
  { phrase: "deck oven", id: "oven_deck" },
  { phrase: "oven", id: "oven_deck" },
  { phrase: "mixer", id: "mixer_spiral" },
  { phrase: "proofer", id: "proofer" },
  { phrase: "proofing", id: "proofer" },
  { phrase: "work table", id: "worktable_steel" },
  { phrase: "worktable", id: "worktable_steel" },
  { phrase: "fridge", id: "fridge_display" },
  { phrase: "refrigerator", id: "fridge_display" },
  { phrase: "display counter", id: "display_counter" },
  { phrase: "roaster", id: "coffee_roaster" },
  { phrase: "office desk", id: "office_desk" },
  { phrase: "desk", id: "office_desk" },
  { phrase: "office chair", id: "office_chair" },
  { phrase: "chair", id: "office_chair" },
  { phrase: "file cabinet", id: "file_cabinet" },
  { phrase: "reception", id: "reception_desk" },
  { phrase: "sofa", id: "sofa" },
  { phrase: "bed", id: "bed_double" },
  { phrase: "wardrobe", id: "wardrobe" },
  { phrase: "dining table", id: "dining_table" },
  { phrase: "dining chair", id: "dining_chair" },
  { phrase: "kitchen", id: "kitchen_counter" },
  { phrase: "student desk", id: "student_desk" },
  { phrase: "student", id: "student_desk" },
  { phrase: "teacher", id: "teacher_desk" },
  { phrase: "gondola", id: "gondola" },
  { phrase: "checkout", id: "pos_counter" },
  { phrase: "counter", id: "pos_counter" },
  { phrase: "fan", id: "fan_exhaust" },
  { phrase: "light", id: "light_highbay" },
  { phrase: "table", id: "worktable_steel" },
];

export function matchCatalogPhrase(text: string): string | null {
  const hay = text.toLowerCase();
  const hit = KEYWORDS.find((entry) => hay.includes(entry.phrase));
  return hit?.id ?? null;
}

export const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  thirty: 30,
};
