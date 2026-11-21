import type { Opening, Room } from "@/lib/schemas";
import { r3 } from "@/lib/num";

export interface WallPiece {
  id: string;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  wall: Opening["wall"] | "roof" | "floor";
  role: "solid" | "lintel" | "sill" | "glass" | "door" | "roof" | "floor";
}

const THICK = 0.2;

export function openingHeight(opening: Opening): number {
  if (opening.height) return opening.height;
  if (opening.type === "door") return opening.width >= 1.4 ? 2.4 : 2.1;
  if (opening.type === "window") return 1.2;
  return 1.4;
}

/** Curtain pose that sits on a window opening, just inside the glass. */
export function windowAnchor(room: Room, opening: Opening): { x: number; z: number; rot: number; y: number; w: number; h: number } {
  const y = sillHeight(opening);
  const h = openingHeight(opening);
  const gap = 0.07;
  if (opening.wall === "south" || opening.wall === "north") {
    return {
      x: r3(opening.position * room.width),
      z: r3(opening.wall === "south" ? gap : room.length - gap),
      rot: opening.wall === "south" ? 0 : Math.PI,
      y: r3(y),
      w: r3(opening.width),
      h: r3(h),
    };
  }
  return {
    x: r3(opening.wall === "west" ? gap : room.width - gap),
    z: r3(opening.position * room.length),
    rot: opening.wall === "west" ? Math.PI / 2 : -Math.PI / 2,
    y: r3(y),
    w: r3(opening.width),
    h: r3(h),
  };
}

export function sillHeight(opening: Opening): number {
  if (opening.sill != null) return opening.sill;
  if (opening.type === "door") return 0;
  if (opening.type === "window") return 0.9;
  return 0.4;
}

export function grossWallArea(room: Room): number {
  return 2 * (room.width + room.length) * room.height;
}

export function netWallArea(room: Room, openings: Opening[]): number {
  const holes = openings.reduce((sum, opening) => sum + opening.width * openingHeight(opening), 0);
  return Math.max(0, grossWallArea(room) - holes);
}

export function wallPieces(room: Room, openings: Opening[], hiddenWall?: Opening["wall"] | null): WallPiece[] {
  const pieces: WallPiece[] = [];
  const walls: Opening["wall"][] = ["south", "north", "west", "east"];
  for (const wall of walls) {
    if (wall === hiddenWall) continue;
    pieces.push(...piecesForWall(room, wall, openings.filter((opening) => opening.wall === wall)));
  }
  return pieces;
}

function piecesForWall(room: Room, wall: Opening["wall"], openings: Opening[]): WallPiece[] {
  const horizontal = wall === "south" || wall === "north";
  const length = horizontal ? room.width : room.length;
  const spans = openings
    .map((opening) => {
      const center = opening.position * length;
      const half = opening.width / 2;
      const start = Math.max(0.05, center - half);
      const end = Math.min(length - 0.05, center + half);
      return { opening, start, end };
    })
    .filter((span) => span.end - span.start > 0.2)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const pieces: WallPiece[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor + 0.04) {
      pieces.push(solid(room, wall, cursor, span.start, 0, room.height, `solid-${wall}-${index}`));
    }
    const top = Math.min(room.height, sillHeight(span.opening) + openingHeight(span.opening));
    const sill = sillHeight(span.opening);
    if (sill > 0.04) {
      pieces.push(solid(room, wall, span.start, span.end, 0, sill, `sill-${wall}-${index}`));
    }
    if (room.height - top > 0.04) {
      pieces.push(solid(room, wall, span.start, span.end, top, room.height - top, `lintel-${wall}-${index}`));
    }
    if (span.opening.type !== "door") {
      pieces.push(glass(room, wall, span.start, span.end, sill, top - sill, `glass-${wall}-${index}`));
    } else {
      pieces.push(doorLeaf(room, wall, span.start, span.end, top, `door-${wall}-${index}`));
    }
    cursor = Math.max(cursor, span.end);
  });
  if (length - cursor > 0.04) {
    pieces.push(solid(room, wall, cursor, length, 0, room.height, `solid-${wall}-end`));
  }
  return pieces;
}

function centerFor(room: Room, wall: Opening["wall"], start: number, end: number): { x: number; z: number; sx: number; sz: number } {
  const mid = (start + end) / 2;
  const span = Math.max(0.02, end - start);
  if (wall === "south") return { x: mid, z: -THICK / 2, sx: span, sz: THICK };
  if (wall === "north") return { x: mid, z: room.length + THICK / 2, sx: span, sz: THICK };
  if (wall === "west") return { x: -THICK / 2, z: mid, sx: THICK, sz: span };
  return { x: room.width + THICK / 2, z: mid, sx: THICK, sz: span };
}

function solid(room: Room, wall: Opening["wall"], start: number, end: number, y0: number, sy: number, id: string): WallPiece {
  const center = centerFor(room, wall, start, end);
  return {
    id,
    x: r3(center.x),
    y: r3(y0 + sy / 2),
    z: r3(center.z),
    sx: r3(center.sx),
    sy: r3(sy),
    sz: r3(center.sz),
    wall,
    role: y0 > 0 && y0 + sy < room.height ? "sill" : "solid",
  };
}

function glass(room: Room, wall: Opening["wall"], start: number, end: number, y0: number, sy: number, id: string): WallPiece {
  const center = centerFor(room, wall, start + 0.04, end - 0.04);
  return {
    id,
    x: r3(center.x),
    y: r3(y0 + sy / 2),
    z: r3(center.z),
    sx: r3(Math.max(0.05, center.sx * (wall === "west" || wall === "east" ? 0.25 : 1))),
    sy: r3(Math.max(0.05, sy - 0.08)),
    sz: r3(Math.max(0.05, center.sz * (wall === "south" || wall === "north" ? 0.25 : 1))),
    wall,
    role: "glass",
  };
}

function doorLeaf(room: Room, wall: Opening["wall"], start: number, end: number, height: number, id: string): WallPiece {
  const leaf = Math.min(0.9, (end - start) * 0.46);
  const center = centerFor(room, wall, start + 0.04, start + leaf);
  return {
    id,
    x: r3(center.x),
    y: r3(height / 2),
    z: r3(center.z),
    sx: r3(wall === "west" || wall === "east" ? 0.04 : leaf),
    sy: r3(Math.max(0.4, height - 0.02)),
    sz: r3(wall === "south" || wall === "north" ? 0.04 : leaf),
    wall,
    role: "door",
  };
}
