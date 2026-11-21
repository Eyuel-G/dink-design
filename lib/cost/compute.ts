import { getCatalogItem } from "@/lib/catalog";
import type { PlacedObject } from "@/lib/layout/place";
import { netWallArea, openingHeight } from "@/lib/layout/walls";
import { r2 } from "@/lib/num";
import type { BuildingSpec, Opening } from "@/lib/schemas";

export type PriceKind = "estimate" | "marketplace" | "pinned";
export type Confidence = "high" | "medium" | "low" | "none";

export interface PriceQuote {
  unitPrice: number;
  kind: PriceKind;
  url: string | null;
  confidence: Confidence;
  listingCount: number;
  min?: number;
  max?: number;
  checkedAt?: string | null;
  stale?: boolean;
  failure?: "slow" | "blocked" | "none" | "offline" | null;
  sourceName?: string | null;
  sourceBaseUrl?: string | null;
  title?: string | null;
  listings?: { title: string; price: number; currency: string; url: string | null; condition: string; relevance: number }[];
}

export interface CostLine {
  id: string;
  category: "structure" | "openings" | "finishes" | "utilities" | "equipment" | "furniture";
  group: "construction" | "interior";
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  priceKind: PriceKind;
  url: string | null;
  confidence: Confidence;
  listingCount: number;
  objectIds: string[];
  note: string;
  shopTitle?: string | null;
  stale?: boolean;
  failure?: PriceQuote["failure"];
  sourceName?: string | null;
}

export interface CostReport {
  lines: CostLine[];
  materials: number;
  labor: number;
  laborPct: number;
  contingency: number;
  contingencyPct: number;
  total: number;
  perM2: number;
  floorArea: number;
  wallArea: number;
  construction: number;
  interior: number;
}

export function openingCatalogId(opening: Opening): string {
  if (opening.type === "window") return "window_aluminum";
  if (opening.type === "shutter") return "shutter_metal";
  return opening.width >= 1.4 ? "door_double" : "door_metal";
}

export function finishId(floorType: BuildingSpec["room"]["floorType"]): string {
  if (floorType === "tile") return "finish_tile";
  if (floorType === "epoxy") return "finish_epoxy";
  if (floorType === "wood") return "finish_wood";
  return "finish_screed";
}

export function computeCost(
  spec: BuildingSpec,
  layout: { objects: PlacedObject[] },
  options: { laborPct: number; contingencyPct: number; quotes?: Record<string, PriceQuote> },
): CostReport {
  const quotes = options.quotes ?? {};
  const floorArea = r2(spec.room.width * spec.room.length);
  const wallArea = r2(netWallArea(spec.room, spec.openings));
  const lines: CostLine[] = [];

  const pushMeasured = (catalogId: string, quantity: number, note: string) => {
    const item = getCatalogItem(catalogId);
    if (!item || quantity <= 0) return;
    const quote = quotes[catalogId];
    const unitPrice = quote?.unitPrice ?? item.basePriceEtb;
    lines.push({
      id: catalogId,
      category: item.category,
      group: item.group,
      name: item.name,
      unit: item.unit,
      quantity: r2(quantity),
      unitPrice: r2(unitPrice),
      total: r2(quantity * unitPrice),
      priceKind: quote?.kind ?? "estimate",
      url: quote?.url ?? null,
      confidence: quote?.confidence ?? "none",
      listingCount: quote?.listingCount ?? 0,
      objectIds: [],
      note,
      shopTitle: quote?.title,
      stale: quote?.stale,
      failure: quote?.failure,
      sourceName: quote?.sourceName,
    });
  };

  pushMeasured("wall_masonry", wallArea, `Net wall area = 2×(${spec.room.width}+${spec.room.length})×${spec.room.height} − openings`);
  pushMeasured("floor_slab", floorArea, `Floor area = ${spec.room.width} × ${spec.room.length}`);
  pushMeasured(
    spec.style.roof === "slab" ? "roof_slab" : "roof_sheet",
    floorArea,
    `Roof area = ${spec.room.width} × ${spec.room.length}`,
  );

  const columnMeters = layout.objects
    .filter((object) => object.catalogId === "column_steel")
    .reduce((sum, object) => sum + object.h, 0);
  pushMeasured("column_steel", columnMeters, "Column meters = count × room height, on a 6 m bay grid");

  const openingGroups = new Map<string, number>();
  for (const opening of spec.openings) {
    const id = openingCatalogId(opening);
    openingGroups.set(id, (openingGroups.get(id) ?? 0) + 1);
  }
  for (const [id, count] of openingGroups) {
    pushMeasured(id, count, `Opening count. Each hole is ${openingHeight(spec.openings.find((o) => openingCatalogId(o) === id) as Opening).toFixed(2)} m high where set.`);
  }

  pushMeasured(finishId(spec.room.floorType), floorArea, `Floor finish over ${floorArea} m²`);
  pushMeasured("paint_interior", wallArea, "Interior paint on net wall area");
  pushMeasured("paint_exterior", wallArea, "Exterior paint on net wall area");
  const points = Math.max(2, Math.ceil(floorArea / 8));
  pushMeasured("power_point", points, "One point per 8 m², minimum 2");

  const groups = new Map<string, { itemId: string; ids: string[]; qty: number; price: number; quote?: PriceQuote }>();
  for (const object of layout.objects) {
    if (object.catalogId === "column_steel") continue;
    const item = getCatalogItem(object.catalogId);
    if (!item) continue;
    const pin = spec.pins?.[object.id];
    const quote = quotes[object.catalogId];
    const unitPrice = pin ? pin.price : quote?.unitPrice ?? item.basePriceEtb;
    const kind: PriceKind = pin ? "pinned" : quote?.kind ?? "estimate";
    const key = `${object.catalogId}|${kind}|${r2(unitPrice)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(object.id);
      existing.qty += item.unit === "m" ? object.h : 1;
    } else {
      groups.set(key, {
        itemId: object.catalogId,
        ids: [object.id],
        qty: item.unit === "m" ? object.h : 1,
        price: unitPrice,
        quote: pin
          ? {
              unitPrice: pin.price,
              kind: "pinned",
              url: pin.url,
              confidence: "high",
              listingCount: 1,
              sourceName: pin.sourceName ?? "Pinned",
              title: pin.title,
            }
          : quote,
      });
    }
  }

  for (const group of groups.values()) {
    const item = getCatalogItem(group.itemId);
    if (!item) continue;
    const quote = group.quote;
    lines.push({
      id: `${group.itemId}:${group.ids[0]}`,
      category: item.category,
      group: item.group,
      name: item.name,
      unit: item.unit,
      quantity: r2(group.qty),
      unitPrice: r2(group.price),
      total: r2(group.qty * group.price),
      priceKind: quote?.kind ?? "estimate",
      url: quote?.url ?? null,
      confidence: quote?.confidence ?? "none",
      listingCount: quote?.listingCount ?? 0,
      objectIds: group.ids,
      note: `${group.ids.length} placed`,
      shopTitle: quote?.title,
      stale: quote?.stale,
      failure: quote?.failure,
      sourceName: quote?.sourceName,
    });
  }

  lines.sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const materials = r2(lines.reduce((sum, line) => sum + line.total, 0));
  const construction = r2(lines.filter((line) => line.group === "construction").reduce((sum, line) => sum + line.total, 0));
  const interior = r2(lines.filter((line) => line.group === "interior").reduce((sum, line) => sum + line.total, 0));
  const labor = r2(materials * (options.laborPct / 100));
  const contingency = r2((materials + labor) * (options.contingencyPct / 100));
  const total = r2(materials + labor + contingency);
  return {
    lines,
    materials,
    labor,
    laborPct: options.laborPct,
    contingency,
    contingencyPct: options.contingencyPct,
    total,
    perM2: floorArea > 0 ? r2(total / floorArea) : 0,
    floorArea,
    wallArea,
    construction,
    interior,
  };
}
