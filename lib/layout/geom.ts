import { r3 } from "@/lib/num";

export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Rect {
  name: string;
  x: number;
  z: number;
  w: number;
  l: number;
}

export interface Spot {
  x: number;
  z: number;
  rot: number;
}

export function aabbOf(x: number, z: number, w: number, l: number, rot: number): Aabb {
  const swap = Math.abs(Math.sin(rot)) > 0.5;
  const width = swap ? l : w;
  const depth = swap ? w : l;
  return {
    minX: r3(x - width / 2),
    maxX: r3(x + width / 2),
    minZ: r3(z - depth / 2),
    maxZ: r3(z + depth / 2),
  };
}

export function overlaps(a: Aabb, b: Aabb, gap = 0.04): boolean {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
}

export function insideRoom(box: Aabb, roomW: number, roomL: number, inset: number): boolean {
  return box.minX >= inset - 0.001 && box.maxX <= roomW - inset + 0.001 && box.minZ >= inset - 0.001 && box.maxZ <= roomL - inset + 0.001;
}

export function rectToAabb(rect: Rect): Aabb {
  return { minX: rect.x, maxX: r3(rect.x + rect.w), minZ: rect.z, maxZ: r3(rect.z + rect.l) };
}
