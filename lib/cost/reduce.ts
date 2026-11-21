import { CATALOG, getCatalogItem } from "@/lib/catalog";
import { computeCost } from "@/lib/cost/compute";
import { layoutSpec } from "@/lib/layout/place";
import { r3 } from "@/lib/num";
import type { BuildingSpec, CostStrategy } from "@/lib/schemas";

const FINISH_LADDER = ["finish_epoxy", "finish_wood", "finish_tile", "finish_screed"] as const;
const FLOORS = ["epoxy", "wood", "tile", "concrete"] as const;

export interface ReduceResult {
  spec: BuildingSpec;
  notes: string[];
  before: number;
  after: number;
  strategies: CostStrategy[];
}

export function reduceCost(
  spec: BuildingSpec,
  ratio: number,
  allowed: CostStrategy[],
  rates: { laborPct: number; contingencyPct: number },
): ReduceResult {
  const order: CostStrategy[] = ["cheaper_alternate", "fewer_items", "smaller_room"];
  const strategies = order.filter((strategy) => allowed.includes(strategy));
  const next = clone(spec);
  const notes: string[] = [];
  const before = totalOf(spec, rates);
  const target = before * ratio;

  if (strategies.includes("cheaper_alternate")) {
    if (next.style.roof === "slab") {
      next.style = { ...next.style, roof: "sheet" };
      notes.push("Switched the roof from concrete slab to EBR sheet.");
    }
    const floorIndex = FLOORS.indexOf(next.room.floorType as (typeof FLOORS)[number]);
    if (floorIndex >= 0 && floorIndex < FLOORS.length - 1 && FINISH_LADDER[floorIndex] !== "finish_screed") {
      const cheaperFloor = FLOORS[Math.min(FLOORS.length - 1, floorIndex + 1)];
      if (cheaperFloor !== next.room.floorType) {
        next.room = { ...next.room, floorType: cheaperFloor };
        notes.push(`Stepped the floor finish down to ${cheaperFloor}.`);
      }
    }
    next.items = next.items.map((item) => {
      const catalogItem = getCatalogItem(item.catalogId);
      if (!catalogItem?.cheaperId || !getCatalogItem(catalogItem.cheaperId)) return item;
      notes.push(`Replaced ${catalogItem.name} with ${getCatalogItem(catalogItem.cheaperId)?.name}.`);
      return { ...item, catalogId: catalogItem.cheaperId };
    });
  }

  if (strategies.includes("fewer_items") && totalOf(next, rates) > target) {
    const guard = 80;
    let spins = 0;
    while (totalOf(next, rates) > target && spins < guard) {
      const ranked = [...next.items]
        .filter((item) => item.count > 1 && (getCatalogItem(item.catalogId)?.group === "interior"))
        .sort((a, b) => {
          const pa = (getCatalogItem(a.catalogId)?.basePriceEtb ?? 0) * a.count;
          const pb = (getCatalogItem(b.catalogId)?.basePriceEtb ?? 0) * b.count;
          return pb - pa || a.catalogId.localeCompare(b.catalogId);
        });
      const victim = ranked[0];
      if (!victim) break;
      victim.count -= 1;
      notes.push(`Removed one ${getCatalogItem(victim.catalogId)?.name ?? victim.catalogId}.`);
      spins += 1;
    }
  }

  if (strategies.includes("smaller_room") && totalOf(next, rates) > target) {
    const originalW = next.room.width;
    const originalL = next.room.length;
    let spins = 0;
    while (totalOf(next, rates) > target && spins < 8) {
      const scale = 0.95;
      const width = r3(Math.max(originalW * 0.8, next.room.width * scale));
      const length = r3(Math.max(originalL * 0.8, next.room.length * scale));
      if (width === next.room.width && length === next.room.length) break;
      const sx = width / next.room.width;
      const sz = length / next.room.length;
      next.room = { ...next.room, width, length };
      next.zones = next.zones.map((zone) => ({
        ...zone,
        x: r3(zone.x * sx),
        z: r3(zone.z * sz),
        w: r3(zone.w * sx),
        l: r3(zone.l * sz),
      }));
      spins += 1;
    }
    if (next.room.width !== spec.room.width || next.room.length !== spec.room.length) {
      notes.push(`Shrunk the room to ${next.room.width} × ${next.room.length} m.`);
    }
  }

  next.placements = [];
  next.assumptions = [...next.assumptions, ...notes].slice(0, 16);
  const after = totalOf(next, rates);
  return { spec: next, notes: unique(notes), before, after, strategies };
}

function totalOf(spec: BuildingSpec, rates: { laborPct: number; contingencyPct: number }): number {
  return computeCost(spec, layoutSpec(spec), rates).total;
}

function clone(spec: BuildingSpec): BuildingSpec {
  return JSON.parse(JSON.stringify(spec)) as BuildingSpec;
}

function unique(notes: string[]): string[] {
  return [...new Set(notes)];
}

export function cheaperExists(catalogId: string): boolean {
  const item = CATALOG.find((candidate) => candidate.id === catalogId);
  return Boolean(item?.cheaperId);
}
