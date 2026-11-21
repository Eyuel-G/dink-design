import { bareRoomPrompt, emptyRoomSpec } from "@/lib/intent/fallback";
import { libraryModel, matchLibraryPhrase } from "@/lib/assets/library";
import { expandAliases, tokensOf } from "@/lib/assets/match";
import { getCatalogItem, matchCatalogPhrase, rememberCatalog, WORD_NUMBERS } from "@/lib/catalog";
import { reduceCost } from "@/lib/cost/reduce";
import { r3 } from "@/lib/num";
import { BuildingSpecSchema, type BuildingSpec, type CatalogItem, type CostStrategy, type Room, type SpecPatch } from "@/lib/schemas";

export interface EditResult {
  spec: BuildingSpec;
  label: string;
  note: string;
  before?: number;
  after?: number;
}

export function applyPatch(
  spec: BuildingSpec,
  patch: SpecPatch,
  rates: { laborPct: number; contingencyPct: number },
): EditResult {
  rememberCatalog(spec.extras);
  rememberCatalog(patch.extras);
  let next: BuildingSpec = {
    ...spec,
    room: { ...spec.room, ...patch.room },
    style: { ...spec.style, ...patch.style },
    openings: patch.openings ?? spec.openings,
    zones: patch.zones ?? spec.zones,
    items: patch.items ?? spec.items,
    assumptions: patch.assumptions ?? spec.assumptions,
    placements: patch.clearPlacements ? [] : spec.placements,
    removed: spec.removed,
    extras: patch.extras ?? spec.extras,
    photoPins: patch.photoPins ? { ...spec.photoPins, ...patch.photoPins } : spec.photoPins,
    replacements: patch.replacements ? { ...spec.replacements, ...patch.replacements } : spec.replacements,
  };
  let label = patch.note || "Edited the spec";
  if (patch.swap) {
    const item = getCatalogItem(patch.swap.catalogId);
    if (!item?.placeable) throw new Error("That piece cannot be placed.");
    next.replacements = { ...next.replacements, [patch.swap.objectId]: patch.swap.catalogId };
    label = patch.note || `Placed ${item.name}`;
  }
  if (patch.removeObjectId) {
    next.removed = [...new Set([...(next.removed ?? []), patch.removeObjectId])].slice(0, 400);
    next.placements = (next.placements ?? []).filter((placement) => placement.objectId !== patch.removeObjectId);
    if (next.replacements) {
      const replacements = { ...next.replacements };
      delete replacements[patch.removeObjectId];
      next.replacements = replacements;
    }
    label = patch.note || `Removed ${patch.removeObjectId}`;
  }
  let before: number | undefined;
  let after: number | undefined;
  if (patch.strategies?.length) {
    const reduced = reduceCost(next, patch.targetCostRatio ?? 0.85, patch.strategies, rates);
    next = reduced.spec;
    before = reduced.before;
    after = reduced.after;
    label = "Reduced cost";
    next.assumptions = [...next.assumptions, ...reduced.notes].slice(0, 16);
  }
  if (patch.room && (patch.room.width || patch.room.length || patch.room.floorType)) {
    next.placements = [];
  }
  return { spec: BuildingSpecSchema.parse(next), label, note: patch.note || label, before, after };
}

export function interpretEdit(
  prompt: string,
  spec: BuildingSpec,
  rates: { laborPct: number; contingencyPct: number },
): EditResult | null {
  const text = prompt.toLowerCase().trim();
  if (bareRoomPrompt(prompt)) {
    const next = emptyRoomSpec(prompt);
    const windows = next.openings.filter((opening) => opening.type === "window").length;
    return {
      spec: BuildingSpecSchema.parse({ ...next, placements: [], replacements: {}, removed: [] }),
      label: `Empty ${next.room.width} × ${next.room.length} m room`,
      note: `A ${next.room.width} × ${next.room.length} m room with ${windows} window${windows === 1 ? "" : "s"} and no furniture.`,
    };
  }
  if (/roof higher|raise the roof|higher ceiling|taller ceiling|higher roof|make the roof higher/.test(text)) {
    const amount = text.match(/(\d+(?:\.\d+)?)\s*m/);
    const add = amount ? Number(amount[1]) : 0.5;
    const height = Math.min(12, Math.round((spec.room.height + add) * 1000) / 1000);
    return applyPatch(spec, { room: { height }, note: `Raised the roof to ${height} m`, clearPlacements: false }, rates);
  }
  const cost = text.match(/reduce cost by\s*(\d+(?:\.\d+)?)\s*%/);
  if (cost) {
    const ratio = Math.max(0.5, 1 - Number(cost[1]) / 100);
    const strategies: CostStrategy[] = ["cheaper_alternate", "fewer_items", "smaller_room"];
    return applyPatch(spec, { strategies, targetCostRatio: ratio, note: `Reduced cost by ${cost[1]}%`, clearPlacements: true }, rates);
  }
  const floor = text.match(/floor to (tile|concrete|epoxy|wood)/);
  if (floor) {
    return applyPatch(
      spec,
      { room: { floorType: floor[1] as BuildingSpec["room"]["floorType"] }, note: `Floor set to ${floor[1]}`, clearPlacements: true },
      rates,
    );
  }
  const windows = text.match(/add\s+(\d+|a|an|one|two|three|four|five|six)\s+windows?(?:\s+on the\s+(north|south|east|west)\s+wall)?/);
  if (windows) {
    const count = Number(windows[1]) || WORD_NUMBERS[windows[1]] || 1;
    const wall = (windows[2] as BuildingSpec["openings"][number]["wall"]) || "east";
    const openings = [...spec.openings];
    for (let i = 0; i < count; i += 1) {
      openings.push({ type: "window", wall, position: Math.min(0.9, 0.2 + i * 0.22), width: 1.2, height: 1.2 });
    }
    return applyPatch(spec, { openings, note: `Added ${count} window${count === 1 ? "" : "s"} on the ${wall} wall`, clearPlacements: true }, rates);
  }
  const placed = placeRequest(text, spec);
  if (placed) {
    if (placed.opening) {
      const openings = [...spec.openings];
      for (let i = 0; i < placed.count; i += 1) {
        openings.push(
          placed.opening === "door"
            ? { type: "door", wall: "south", position: Math.min(0.9, 0.18 + openings.length * 0.16), width: 0.9, height: 2.1 }
            : { type: "window", wall: "east", position: Math.min(0.9, 0.2 + i * 0.22), width: 1.2, height: 1.2 },
        );
      }
      const name = placed.opening === "door" ? "door" : "window";
      return applyPatch(
        spec,
        { openings, note: `Placed ${placed.count} ${name}${placed.count === 1 ? "" : "s"}`, clearPlacements: true },
        rates,
      );
    }
    const piece = resolvePiece(placed.phrase, spec.room);
    if (piece?.placeable && piece.id !== "column_steel") {
      rememberCatalog([piece]);
      const items = [...spec.items.map((entry) => ({ ...entry }))];
      const existing = items.find((entry) => entry.catalogId === piece.id);
      if (existing) existing.count = Math.min(80, existing.count + placed.count);
      else items.push({ catalogId: piece.id, count: placed.count, layout: layoutFor(piece) });
      const extras = piece.id.startsWith("asset_") ? [...(spec.extras ?? []).filter((entry) => entry.id !== piece.id), piece] : spec.extras;
      const where = piece.id.startsWith("asset_") && piece.glbPath ? " from the asset folder" : "";
      return applyPatch(
        spec,
        { items, extras, note: `Placed ${placed.count} ${piece.name}${where}`, clearPlacements: true },
        rates,
      );
    }
  }
  const add = text.match(/add\s+(\d+|a|an|one|two|three|four|five|six|eight|ten|twelve)\s+(.+)/);
  if (add) {
    const count = Number(add[1]) || WORD_NUMBERS[add[1]] || 1;
    const id = matchCatalogPhrase(add[2]);
    const item = id ? getCatalogItem(id) : undefined;
    if (item?.placeable && item.id !== "column_steel") {
      const items = [...spec.items.map((entry) => ({ ...entry }))];
      const existing = items.find((entry) => entry.catalogId === item.id);
      if (existing) existing.count = Math.min(80, existing.count + count);
      else items.push({ catalogId: item.id, count, layout: layoutFor(item) });
      return applyPatch(spec, { items, note: `Added ${count} ${item.name}`, clearPlacements: true }, rates);
    }
  }
  const remove = text.match(/remove(?: the)?\s+(.+)/);
  if (remove) {
    const id = matchCatalogPhrase(remove[1]);
    if (id) {
      const items = spec.items.filter((item) => item.catalogId !== id);
      return applyPatch(spec, { items, note: `Removed ${getCatalogItem(id)?.name ?? id}`, clearPlacements: true }, rates);
    }
  }
  const resize = text.match(/(?:make (?:the )?room|resize to|size)\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
  if (resize) {
    const width = Number(resize[1]);
    const length = Number(resize[2]);
    const sx = width / spec.room.width;
    const sz = length / spec.room.length;
    return applyPatch(
      spec,
      {
        room: { width, length },
        zones: spec.zones.map((zone) => ({ ...zone, x: zone.x * sx, z: zone.z * sz, w: zone.w * sx, l: zone.l * sz })),
        note: `Room set to ${width} × ${length} m`,
        clearPlacements: true,
      },
      rates,
    );
  }
  return null;
}

const COUNTS = "(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)";
const VERBS = "place|put|insert|add|hang|drop|set|bring|include|install|load|give|get|fetch|show";
const PLACE = new RegExp(
  `^(?:please\\s+)?(?:can you\\s+|could you\\s+|would you\\s+)?(?:to\\s+)?(?:${VERBS})(?:\\s+me)?\\s+(?:(?:a|an|the|some)\\s+)?(?:${COUNTS}\\s+)?(.+)$`,
  "i",
);
const WANT = new RegExp(
  `^(?:please\\s+)?(?:i\\s+(?:want|need)|i(?:'d| would)\\s+like|we\\s+need)\\s+(?:(?:a|an|the|some)\\s+)?(?:${COUNTS}\\s+)?(.+)$`,
  "i",
);

function placeRequest(text: string, spec: BuildingSpec): { count: number; phrase: string } | { count: number; opening: "door" | "window" } | null {
  const match = text.match(PLACE) ?? text.match(WANT);
  if (!match) return null;
  let count = match[1] ? Number(match[1]) || WORD_NUMBERS[match[1]] || 1 : 1;
  if (/\beach\b/.test(text)) {
    const windows = spec.openings.filter((opening) => opening.type === "window").length;
    if (windows > 0 && /window|curtain/.test(text)) count = windows;
  }
  const phrase = match[2]
    .replace(/[.!?]+$/g, "")
    .replace(/\s+(?:in|on|into|inside|near|by|under|along|against|at)\s+.+$/i, "")
    .replace(/\b(please|thanks|thank you|for me|in here|here|the room|this room|our room)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase || phrase.length < 2) return null;
  if (/^windows?$/.test(phrase)) return { count, opening: "window" };
  if (/^doors?$/.test(phrase)) return { count, opening: "door" };
  return { count: Math.min(80, count), phrase };
}

function resolvePiece(phrase: string, room: Room): CatalogItem | null {
  const catalogId = matchCatalogPhrase(expandAliases(phrase));
  const catalogItem = catalogId ? getCatalogItem(catalogId) : undefined;
  const library = matchLibraryPhrase(phrase);
  if (catalogItem?.placeable && catalogItem.id !== "column_steel") {
    const catalogFile = libraryFileName(catalogItem);
    const rawWords = phrase.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
    const libraryNamesIt = library && rawWords.some((word) => library.name.toLowerCase().includes(word) && !catalogFile.includes(word));
    if (!libraryNamesIt) return catalogItem;
  }
  if (library) return pieceFromFile(phrase, library.name, room);
  if (catalogItem?.placeable && catalogItem.id !== "column_steel") return catalogItem;
  return pieceFromFile(phrase, null, room);
}

function libraryFileName(item: CatalogItem): string {
  return (libraryModel(item)?.file.split(/[/\\]/).pop() ?? "").toLowerCase();
}

function pieceFromFile(phrase: string, fileName: string | null, room: Room): CatalogItem {
  const tokens = tokensOf(`${phrase} ${fileName ?? ""}`);
  const size = sizeFor(tokens, room);
  const stem = (fileName ?? phrase).replace(/\.glb$/i, "");
  const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  const name = phrase.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  return {
    id: `asset_${slug}`.slice(0, 64),
    name,
    category: "furniture",
    group: "interior",
    tags: [...tokens, "uploaded"],
    dimW: size.w,
    dimL: size.l,
    dimH: size.h,
    unit: "unit",
    basePriceEtb: 2500,
    glbPath: fileName,
    queryEn: phrase,
    queryAm: "",
    color: colorFor(phrase),
    kind: size.kind,
    placeable: true,
    mount: size.mount,
    cheaperId: null,
  };
}

function sizeFor(tokens: string[], room: Room): { w: number; l: number; h: number; mount: CatalogItem["mount"]; kind: string } {
  const has = (...names: string[]) => names.some((name) => tokens.includes(name));
  const chosen = has("column")
    ? { w: 0.5, l: 0.5, h: 1, mount: "floor" as const, kind: "column" }
    : has("curtain")
      ? { w: 1.5, l: 0.08, h: 2.2, mount: "wall" as const, kind: "curtain" }
      : has("window")
        ? { w: 1.4, l: 0.15, h: 1.4, mount: "wall" as const, kind: "window" }
        : has("door")
          ? { w: 0.95, l: 0.12, h: 2.1, mount: "wall" as const, kind: "door" }
          : has("sofa")
            ? { w: 2.2, l: 0.95, h: 0.85, mount: "floor" as const, kind: "sofa" }
            : has("bed")
              ? { w: 2.1, l: 1.6, h: 0.65, mount: "floor" as const, kind: "bed" }
              : has("chair")
                ? { w: 0.55, l: 0.58, h: 0.95, mount: "floor" as const, kind: "chair" }
                : has("desk")
                  ? { w: 1.4, l: 0.7, h: 0.75, mount: "floor" as const, kind: "desk" }
                  : has("table")
                    ? { w: 1.6, l: 0.9, h: 0.75, mount: "floor" as const, kind: "table" }
                    : has("lamp")
                      ? { w: 0.6, l: 0.6, h: 0.7, mount: "ceiling" as const, kind: "lamp" }
                      : has("tv")
                        ? { w: 1.2, l: 0.08, h: 0.7, mount: "wall" as const, kind: "tv" }
                        : has("rug", "carpet")
                          ? { w: 2, l: 3, h: 0.03, mount: "floor" as const, kind: "rug" }
                          : has("car", "bmw", "vehicle")
                            ? { w: 4.3, l: 1.8, h: 1.4, mount: "floor" as const, kind: "vehicle" }
                            : has("shelf", "rack")
                              ? { w: 1.2, l: 0.45, h: 1.8, mount: "floor" as const, kind: "shelf" }
                              : has("cabinet", "wardrobe")
                                ? { w: 1.2, l: 0.6, h: 2, mount: "floor" as const, kind: "cabinet" }
                                : has("sink")
                                  ? { w: 0.6, l: 0.5, h: 0.85, mount: "floor" as const, kind: "sink" }
                                  : { w: 1, l: 0.6, h: 0.9, mount: "floor" as const, kind: "furniture" };
  const maxW = Math.max(0.4, room.width * 0.55);
  const maxL = Math.max(0.4, room.length * 0.55);
  const fit = Math.max(chosen.w / maxW, chosen.l / maxL, 1);
  return {
    w: r3(chosen.w / fit),
    l: r3(chosen.l / fit),
    h: r3(Math.min(chosen.h, Math.max(0.3, room.height - 0.15))),
    mount: chosen.mount,
    kind: chosen.kind,
  };
}

function colorFor(phrase: string): string {
  const palette = ["#c4b49a", "#8d735c", "#d7c4a3", "#6d7278", "#b7c4ce", "#c4622d", "#24312e", "#e4d8c8"];
  let hash = 0;
  for (const char of phrase) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function layoutFor(item: NonNullable<ReturnType<typeof getCatalogItem>>): "grid" | "row" | "wall" | "corner" {
  if (item.mount === "wall") return "wall";
  if (item.mount === "ceiling") return "grid";
  if (item.id.includes("table") || item.id.includes("desk") || item.id.includes("counter")) return "row";
  return "grid";
}

export function suggestionChips(spec: BuildingSpec): string[] {
  const floor = spec.room.floorType === "tile" ? "Switch the floor to concrete" : "Switch the floor to tile";
  return ["Place a curtain", "Make the roof higher", "Reduce cost by 15%", floor];
}
