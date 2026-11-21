import { getCatalogItem, rememberCatalog } from "@/lib/catalog";
import { aabbOf, insideRoom, overlaps, rectToAabb, type Aabb, type Rect, type Spot } from "@/lib/layout/geom";
import { windowAnchor } from "@/lib/layout/walls";
import { r3 } from "@/lib/num";
import type { BuildingSpec, CatalogItem, Opening, Room } from "@/lib/schemas";

export interface PlacedObject {
  id: string;
  catalogId: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  w: number;
  l: number;
  h: number;
  mount: CatalogItem["mount"];
  zone: string | null;
  color: string;
  tint?: string;
  kind: string;
}

export interface LayoutResult {
  objects: PlacedObject[];
  warnings: string[];
}

const INSET = 0.18;

export function columnPoints(room: Room): { x: number; z: number }[] {
  // Smaller rooms keep a 6 m bay. A 60 × 100 m shell on that grid is about 140 poles, which crowds the aisles.
  const span = Math.max(room.width, room.length) >= 40 ? 12 : 6;
  const xs: number[] = [];
  const zs: number[] = [];
  const nx = Math.floor((room.width - 2) / span);
  const nz = Math.floor((room.length - 2) / span);
  for (let i = 1; i <= nx; i += 1) xs.push(r3(i * span));
  for (let i = 1; i <= nz; i += 1) zs.push(r3(i * span));
  if (xs.length === 0 && zs.length > 0) xs.push(r3(room.width / 2));
  if (zs.length === 0 && xs.length > 0) zs.push(r3(room.length / 2));
  const points: { x: number; z: number }[] = [];
  for (const x of xs) {
    for (const z of zs) points.push({ x, z });
  }
  return points;
}

export function doorClearances(room: Room, openings: Opening[]): Rect[] {
  return openings
    .filter((opening) => opening.type === "door")
    .map((opening) => {
      const depth = 1.15;
      const width = opening.width + 0.4;
      if (opening.wall === "south" || opening.wall === "north") {
        const center = opening.position * room.width;
        const x = center - width / 2;
        const z = opening.wall === "south" ? 0.05 : room.length - depth - 0.05;
        return { name: "door", x: r3(x), z: r3(z), w: r3(width), l: depth };
      }
      const center = opening.position * room.length;
      const z = center - width / 2;
      const x = opening.wall === "west" ? 0.05 : room.width - depth - 0.05;
      return { name: "door", x: r3(x), z: r3(z), w: depth, l: r3(width) };
    });
}

export function layoutSpec(spec: BuildingSpec): LayoutResult {
  rememberCatalog(spec.extras);
  const warnings: string[] = [];
  const objects: PlacedObject[] = [];
  const floorBlocked: Aabb[] = doorClearances(spec.room, spec.openings).map(rectToAabb);
  const ceilingBlocked: Aabb[] = [];
  const counts = new Map<string, number>();

  const nextId = (catalogId: string) => {
    const n = counts.get(catalogId) ?? 0;
    counts.set(catalogId, n + 1);
    return `${catalogId}#${n}`;
  };

  const column = getCatalogItem("column_steel");
  const hasFurniture = spec.items.some((item) => {
    const catalogItem = getCatalogItem(item.catalogId);
    return Boolean(catalogItem?.placeable && catalogItem.id !== "column_steel");
  });
  if (column && hasFurniture) {
    for (const point of columnPoints(spec.room)) {
      const box = aabbOf(point.x, point.z, column.dimW, column.dimL, 0);
      if (floorBlocked.some((blocked) => overlaps(box, blocked, 0))) continue;
      if (!insideRoom(box, spec.room.width, spec.room.length, 0.4)) continue;
      objects.push(makeObject(nextId(column.id), column, point.x, point.z, 0, spec.room.height, null, spec.room));
      floorBlocked.push(box);
      ceilingBlocked.push(box);
    }
  }

  const curtainRequests: BuildingSpec["items"] = [];
  const windows = spec.openings.some((opening) => opening.type === "window");
  const queue = spec.items.filter((item) => {
    const catalogItem = getCatalogItem(item.catalogId);
    if (!catalogItem) {
      warnings.push(`Unknown catalog item “${item.catalogId}” was left out.`);
      return false;
    }
    if (!catalogItem.placeable || catalogItem.id === "column_steel") {
      warnings.push(`${catalogItem.name} is measured from the room, not placed as an object.`);
      return false;
    }
    if ((catalogItem.id === "curtain" || catalogItem.kind === "curtain") && windows) {
      curtainRequests.push(item);
      return false;
    }
    return true;
  });

  for (const mount of ["floor", "wall", "ceiling"] as const) {
    for (const request of queue) {
      const catalogItem = getCatalogItem(request.catalogId);
      if (!catalogItem || catalogItem.mount !== mount) continue;
      const zone = resolveZone(spec, request.zone);
      const spots = spotsFor(request.layout, zone, catalogItem, request.count, spec.room);
      const blocked = mount === "ceiling" ? ceilingBlocked : floorBlocked;
      let placed = 0;
      for (const spot of spots) {
        if (placed >= request.count) break;
        const found = findSpot(spot, catalogItem, blocked, spec.room);
        if (!found) continue;
        const box = aabbOf(found.x, found.z, catalogItem.dimW, catalogItem.dimL, found.rot);
        objects.push(makeObject(nextId(catalogItem.id), catalogItem, found.x, found.z, found.rot, catalogItem.dimH, zone.name, spec.room));
        blocked.push(box);
        placed += 1;
      }
      if (placed < request.count) {
        warnings.push(`Only ${placed} of ${request.count} ${catalogItem.name} fit.`);
      }
    }
  }

  hangCurtains(spec, curtainRequests, objects, nextId, warnings);

  if (spec.replacements) {
    for (const object of objects) {
      const catalogId = spec.replacements[object.id];
      const item = catalogId ? getCatalogItem(catalogId) : undefined;
      if (!item?.placeable) continue;
      const curtain = object.kind === "curtain" || item.kind === "curtain";
      object.catalogId = item.id;
      object.name = item.name;
      object.color = item.color;
      object.kind = curtain ? "curtain" : item.kind;
      if (curtain) {
        object.mount = "wall";
        continue;
      }
      const pose = poseFor(item, item.dimH, spec.room);
      object.w = item.dimW;
      object.l = item.dimL;
      object.h = pose.h;
      object.mount = item.mount;
      object.y = pose.y;
    }
  }

  if (spec.placements?.length) {
    for (const placement of spec.placements) {
      const object = objects.find((candidate) => candidate.id === placement.objectId);
      if (!object) continue;
      const catalogItem = getCatalogItem(object.catalogId);
      if (!catalogItem) continue;
      const next = {
        x: r3(placement.x),
        z: r3(placement.z),
        rot: r3(placement.rotationY),
      };
      applyAppearance(object, placement);
      if (placement.y != null) object.y = r3(placement.y);
      if (object.catalogId === "curtain") continue;
      const inside =
        next.x >= 0.05 && next.z >= 0.05 && next.x <= spec.room.width - 0.05 && next.z <= spec.room.length - 0.05;
      if (!inside) {
        warnings.push(`Kept ${object.name} in place — that spot leaves the room.`);
        continue;
      }
      object.x = next.x;
      object.z = next.z;
      object.rotationY = next.rot;
    }
  }

  const removed = new Set(spec.removed ?? []);
  const visible = removed.size ? objects.filter((object) => !removed.has(object.id)) : objects;
  visible.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { objects: visible, warnings };
}

function hangCurtains(
  spec: BuildingSpec,
  requests: BuildingSpec["items"],
  objects: PlacedObject[],
  nextId: (catalogId: string) => string,
  warnings: string[],
) {
  if (!requests.length) return;
  const openings = spec.openings.filter((opening) => opening.type === "window");
  let index = 0;
  for (const request of requests) {
    const item = getCatalogItem(request.catalogId);
    if (!item) continue;
    for (let n = 0; n < request.count; n += 1) {
      const opening = openings[index];
      if (!opening) {
        warnings.push(`Only ${openings.length} window${openings.length === 1 ? "" : "s"} to hang curtains on.`);
        return;
      }
      const anchor = windowAnchor(spec.room, opening);
      const object = makeObject(nextId(item.id), item, anchor.x, anchor.z, anchor.rot, anchor.h, null, spec.room);
      object.x = anchor.x;
      object.y = anchor.y;
      object.z = anchor.z;
      object.rotationY = r3(anchor.rot);
      object.w = anchor.w;
      object.l = 0.08;
      object.h = anchor.h;
      objects.push(object);
      index += 1;
    }
  }
}

function applyAppearance(object: PlacedObject, placement: { w?: number; l?: number; h?: number; color?: string }) {
  if (placement.w && placement.l && placement.h) {
    object.w = r3(Math.min(40, Math.max(0.15, placement.w)));
    object.l = r3(Math.min(40, Math.max(0.05, placement.l)));
    object.h = r3(Math.min(12, Math.max(0.01, placement.h)));
  }
  if (placement.color) object.tint = placement.color;
}

/** Move curtains that were saved off the wall onto the window they belong to. */
export function seatCurtains(objects: PlacedObject[], spec: BuildingSpec): PlacedObject[] {
  const openings = spec.openings.filter((opening) => opening.type === "window");
  if (!openings.length) return objects;
  let index = 0;
  return objects.map((object) => {
    if (object.catalogId !== "curtain" && object.kind !== "curtain") return object;
    const opening = openings[index] ?? openings[openings.length - 1];
    index += 1;
    if (!opening) return object;
    const anchor = windowAnchor(spec.room, opening);
    const seated = Math.abs(object.x - anchor.x) < 0.08 && Math.abs(object.z - anchor.z) < 0.08 && Math.abs(object.y - anchor.y) < 0.08;
    return {
      ...object,
      x: anchor.x,
      y: anchor.y,
      z: anchor.z,
      rotationY: r3(anchor.rot),
      w: seated ? object.w : anchor.w,
      l: seated ? object.l : 0.08,
      h: seated ? object.h : anchor.h,
    };
  });
}

function makeObject(
  id: string,
  item: CatalogItem,
  x: number,
  z: number,
  rot: number,
  height: number,
  zone: string | null,
  room: Room,
): PlacedObject {
  const pose = poseFor(item, height, room);
  return {
    id,
    catalogId: item.id,
    name: item.name,
    x: r3(x),
    y: pose.y,
    z: r3(z),
    rotationY: r3(rot),
    w: item.dimW,
    l: item.dimL,
    h: pose.h,
    mount: item.mount,
    zone,
    color: item.color,
    kind: item.kind,
  };
}

function poseFor(item: CatalogItem, height: number, room: Room): { y: number; h: number } {
  const column = item.kind === "column" || item.id.includes("column");
  if (column) return { y: 0, h: r3(room.height) };
  const h = r3(Math.min(height, Math.max(0.2, room.height - 0.04)));
  if (item.mount === "ceiling") return { y: r3(Math.max(0, room.height - h)), h };
  if (item.mount === "wall") return { y: r3(Math.max(0, room.height - h - 0.04)), h };
  return { y: 0, h };
}

function resolveZone(spec: BuildingSpec, name?: string): Rect {
  const room = spec.room;
  const fallback: Rect = {
    name: "room",
    x: 0.7,
    z: 0.7,
    w: Math.max(1, room.width - 1.4),
    l: Math.max(1, room.length - 1.4),
  };
  if (!name) return fallback;
  const zone = spec.zones.find((candidate) => candidate.name === name);
  if (!zone) return fallback;
  const x = Math.min(Math.max(0.3, zone.x), room.width - 1);
  const z = Math.min(Math.max(0.3, zone.z), room.length - 1);
  const w = Math.max(0.8, Math.min(zone.w, room.width - x - 0.2));
  const l = Math.max(0.8, Math.min(zone.l, room.length - z - 0.2));
  return { name, x: r3(x), z: r3(z), w: r3(w), l: r3(l) };
}

function spotsFor(mode: "grid" | "row" | "wall" | "corner", zone: Rect, item: CatalogItem, count: number, room: Room): Spot[] {
  if (mode === "corner") return cornerSpots(zone, item, count);
  if (mode === "wall") return wallSpots(zone, item, count, room);
  if (mode === "row") return gridSpots(zone, item, count, 0.8, 0.8, zone.w >= zone.l ? "x" : "z", true);
  return gridSpots(zone, item, count, 0.75, 1.15, "x", false);
}

function gridSpots(zone: Rect, item: CatalogItem, count: number, gapX: number, gapZ: number, along: "x" | "z", turnLong: boolean): Spot[] {
  const rot = turnLong ? longSideRotation(item, along) : 0;
  const swap = Math.abs(Math.sin(rot)) > 0.5;
  const fw = swap ? item.dimL : item.dimW;
  const fl = swap ? item.dimW : item.dimL;
  const span = along === "x" ? zone.w : zone.l;
  const cross = along === "x" ? zone.l : zone.w;
  const sizeAlong = along === "x" ? fw : fl;
  const sizeCross = along === "x" ? fl : fw;
  const gapAlong = along === "x" ? gapX : gapZ;
  const gapCross = along === "x" ? gapZ : gapX;
  const pitchAlong = sizeAlong + gapAlong;
  const pitchCross = sizeCross + gapCross;
  const cols = Math.max(1, Math.floor((span + gapAlong - 0.15) / pitchAlong));
  const maxRows = Math.max(1, Math.floor((cross + gapCross - 0.15) / pitchCross));
  const rows = Math.min(maxRows, Math.max(1, Math.ceil(count / cols) + 1));
  const usedCols = Math.min(cols, Math.max(count, 1));
  const totalAlong = usedCols * sizeAlong + (usedCols - 1) * gapAlong;
  const totalCross = rows * sizeCross + (rows - 1) * gapCross;
  const originAlong = (along === "x" ? zone.x : zone.z) + Math.max(0.05, ((along === "x" ? zone.w : zone.l) - totalAlong) / 2) + sizeAlong / 2;
  const originCross = (along === "x" ? zone.z : zone.x) + Math.max(0.05, ((along === "x" ? zone.l : zone.w) - totalCross) / 2) + sizeCross / 2;
  const spots: Spot[] = [];
  const cellCount = Math.max(cols * rows, count);
  for (let i = 0; i < cellCount; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    if (r >= rows) break;
    const alongValue = originAlong + c * pitchAlong;
    const crossValue = originCross + r * pitchCross;
    spots.push({
      x: r3(along === "x" ? alongValue : crossValue),
      z: r3(along === "x" ? crossValue : alongValue),
      rot,
    });
  }
  return spots;
}

function longSideRotation(item: CatalogItem, along: "x" | "z"): number {
  const longOnX = item.dimW >= item.dimL;
  if (along === "x") return longOnX ? 0 : Math.PI / 2;
  return longOnX ? Math.PI / 2 : 0;
}

function wallSpots(zone: Rect, item: CatalogItem, count: number, room: Room): Spot[] {
  const edges: { x: number; z: number; rot: number; along: "x" | "z" }[] = [
    { x: zone.x + zone.w / 2, z: zone.z + item.dimL / 2 + 0.08, rot: 0, along: "x" },
    { x: zone.x + zone.w / 2, z: zone.z + zone.l - item.dimL / 2 - 0.08, rot: Math.PI, along: "x" },
    { x: zone.x + item.dimW / 2 + 0.08, z: zone.z + zone.l / 2, rot: Math.PI / 2, along: "z" },
    { x: zone.x + zone.w - item.dimW / 2 - 0.08, z: zone.z + zone.l / 2, rot: -Math.PI / 2, along: "z" },
  ];
  const roomCenterX = room.width / 2;
  const roomCenterZ = room.length / 2;
  edges.sort((a, b) => distance(b.x, b.z, roomCenterX, roomCenterZ) - distance(a.x, a.z, roomCenterX, roomCenterZ));
  const edge = edges[0];
  const span = edge.along === "x" ? zone.w : zone.l;
  const size = edge.along === "x" ? item.dimW : item.dimL;
  const gap = 0.3;
  const cols = Math.max(1, Math.floor((span + gap - 0.2) / (size + gap)));
  const spots: Spot[] = [];
  const rows = Math.ceil(Math.max(count, 1) / cols) + 1;
  for (let i = 0; i < cols * rows && spots.length < count + cols; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const alongOffset = (c - (Math.min(cols, count) - 1) / 2) * (size + gap);
    const inward = r * (item.dimL + 0.35);
    if (edge.along === "x") {
      const dir = edge.rot === 0 ? 1 : -1;
      spots.push({ x: r3(edge.x + alongOffset), z: r3(edge.z + dir * inward), rot: edge.rot });
    } else {
      const dir = edge.rot > 0 ? 1 : -1;
      spots.push({ x: r3(edge.x + dir * inward), z: r3(edge.z + alongOffset), rot: edge.rot });
    }
  }
  return spots;
}

function cornerSpots(zone: Rect, item: CatalogItem, count: number): Spot[] {
  const ix = item.dimW / 2 + 0.12;
  const iz = item.dimL / 2 + 0.12;
  const corners: Spot[] = [
    { x: zone.x + ix, z: zone.z + iz, rot: 0 },
    { x: zone.x + zone.w - ix, z: zone.z + iz, rot: 0 },
    { x: zone.x + ix, z: zone.z + zone.l - iz, rot: 0 },
    { x: zone.x + zone.w - ix, z: zone.z + zone.l - iz, rot: 0 },
  ];
  const spots = [...corners];
  let n = 0;
  while (spots.length < count + 4 && n < 12) {
    const base = corners[n % 4];
    const step = Math.floor(n / 4) + 1;
    spots.push({ x: r3(base.x + (n % 2 === 0 ? step * 0.4 : 0)), z: r3(base.z + (n % 2 === 1 ? step * 0.4 : 0)), rot: 0 });
    n += 1;
  }
  return spots;
}

function findSpot(spot: Spot, item: CatalogItem, blocked: Aabb[], room: Room): Spot | null {
  const step = 0.25;
  const candidates: Spot[] = [{ ...spot }];
  for (let radius = step; radius <= 3.5; radius += step) {
    const steps = Math.max(8, Math.round((2 * Math.PI * radius) / step));
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      candidates.push({
        x: spot.x + Math.cos(angle) * radius,
        z: spot.z + Math.sin(angle) * radius,
        rot: spot.rot,
      });
    }
  }
  for (const candidate of candidates) {
    const box = aabbOf(candidate.x, candidate.z, item.dimW, item.dimL, candidate.rot);
    if (!insideRoom(box, room.width, room.length, INSET)) continue;
    if (blocked.some((block) => overlaps(box, block))) continue;
    return { x: r3(candidate.x), z: r3(candidate.z), rot: r3(candidate.rot) };
  }
  return null;
}

function distance(x: number, z: number, cx: number, cz: number): number {
  return (x - cx) ** 2 + (z - cz) ** 2;
}
