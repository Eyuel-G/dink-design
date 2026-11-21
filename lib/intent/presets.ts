import type { BuildingSpec, CatalogItem } from "@/lib/schemas";
import { r3 } from "@/lib/num";

function warehousePiece(
  item: Pick<CatalogItem, "id" | "name" | "dimW" | "dimL" | "dimH" | "color" | "kind" | "mount" | "glbPath" | "basePriceEtb" | "queryEn"> &
    Partial<Pick<CatalogItem, "category" | "group">>,
): CatalogItem {
  return {
    category: "equipment",
    group: "interior",
    tags: ["warehouse"],
    unit: "unit",
    queryAm: item.queryEn,
    placeable: true,
    cheaperId: null,
    ...item,
  };
}

/**
 * Garment-factory preset rebuilt as a 60 m × 100 m distribution warehouse.
 * Width is the short axis (x). Length is the long axis (z). Docks sit on the west long wall.
 * Rack, shelf, and fan meshes are used at the size of the GLB on disk. Nothing is stretched.
 */
function buildGarment(): BuildingSpec {
  const rackRows = [18, 21.86, 40, 43.86, 70, 73.86];
  const bayX = (index: number) => r3(26.5 + index * 0.78);
  const racks = rackRows.flatMap((z) => Array.from({ length: 11 }, (_, index) => ({ x: bayX(index), z })));
  const upper = [2.4, 4.8].flatMap((y) => Array.from({ length: 11 }, (_, index) => ({ x: bayX(index), z: 18, y })));
  const trucks = [
    { x: 7.2, z: 21 },
    { x: 7.2, z: 61 },
  ];
  const packing = [
    { x: 11.5, z: 31 },
    { x: 11.5, z: 71 },
    { x: 39, z: 46 },
    { x: 39, z: 54 },
  ];
  const sewing = [
    { x: 48, z: 76 },
    { x: 51.2, z: 76 },
    { x: 48, z: 79.2 },
    { x: 51.2, z: 79.2 },
  ];
  const fabric = [0, 1, 2, 3].map((index) => ({ x: 40, z: r3(62 + index * 1.2) }));
  const parts = [0, 1, 2, 3, 4].map((index) => ({ x: 56.2, z: r3(22 + index * 1.25) }));
  const fans = [20, 45, 70, 90].map((z) => ({ x: 59.4, z }));
  const lights = [8, 30, 52].flatMap((x) => [18, 44, 70, 92].map((z) => ({ x, z })));
  const yard = Math.PI / 2;

  return {
    room: { width: 60, length: 100, height: 12, floorType: "concrete" },
    style: {
      roof: "sheet",
      palette: "concrete",
      mood: "daylight",
      wallColor: "#c5ccd3",
      floorColor: "#d5d8dc",
    },
    openings: [
      { type: "door", wall: "west", position: 0.16, width: 3, height: 4 },
      { type: "door", wall: "west", position: 0.26, width: 3, height: 4 },
      { type: "door", wall: "west", position: 0.36, width: 3, height: 4 },
      { type: "door", wall: "west", position: 0.46, width: 3, height: 4 },
      { type: "door", wall: "west", position: 0.56, width: 3, height: 4 },
      { type: "door", wall: "west", position: 0.66, width: 3, height: 4 },
      { type: "door", wall: "west", position: 0.76, width: 3, height: 4 },
      { type: "door", wall: "west", position: 0.86, width: 3, height: 4 },
      { type: "door", wall: "south", position: 0.5, width: 1.6, height: 2.4 },
      { type: "door", wall: "north", position: 0.18, width: 0.9, height: 2.1 },
      { type: "door", wall: "east", position: 0.08, width: 0.9, height: 2.1 },
      { type: "door", wall: "east", position: 0.93, width: 1.6, height: 2.4 },
      { type: "window", wall: "east", position: 0.18, width: 4.5, height: 1.6, sill: 8.6 },
      { type: "window", wall: "east", position: 0.3, width: 4.5, height: 1.6, sill: 8.6 },
      { type: "window", wall: "east", position: 0.42, width: 4.5, height: 1.6, sill: 8.6 },
      { type: "window", wall: "east", position: 0.54, width: 4.5, height: 1.6, sill: 8.6 },
      { type: "window", wall: "east", position: 0.66, width: 4.5, height: 1.6, sill: 8.6 },
      { type: "window", wall: "east", position: 0.78, width: 4.5, height: 1.6, sill: 8.6 },
      { type: "window", wall: "south", position: 0.18, width: 3.5, height: 1.5, sill: 8.6 },
      { type: "window", wall: "south", position: 0.82, width: 3.5, height: 1.5, sill: 8.6 },
      { type: "window", wall: "north", position: 0.42, width: 3.5, height: 1.5, sill: 8.6 },
      { type: "window", wall: "north", position: 0.64, width: 3.5, height: 1.5, sill: 8.6 },
    ],
    zones: [
      { name: "receiving", x: 2, z: 4, w: 14, l: 92 },
      { name: "racks", x: 16, z: 36, w: 22, l: 18 },
      { name: "outbound", x: 36, z: 40, w: 8, l: 18 },
      { name: "sewing", x: 44, z: 72, w: 14, l: 14 },
      { name: "fabric", x: 36, z: 58, w: 8, l: 12 },
      { name: "parts", x: 50, z: 18, w: 8, l: 14 },
      { name: "maintenance", x: 50, z: 4, w: 8, l: 8 },
      { name: "returns", x: 42, z: 88, w: 14, l: 8 },
    ],
    items: [
      { catalogId: "wh_bay", count: racks.length, layout: "grid", zone: "racks" },
      { catalogId: "wh_upper", count: upper.length, layout: "grid", zone: "racks" },
      { catalogId: "wh_truck", count: trucks.length, layout: "row", zone: "receiving" },
      { catalogId: "wh_pack", count: packing.length, layout: "row", zone: "receiving" },
      { catalogId: "sewing_industrial", count: sewing.length, layout: "grid", zone: "sewing" },
      { catalogId: "wh_fabric", count: fabric.length, layout: "row", zone: "fabric" },
      { catalogId: "wh_parts", count: parts.length, layout: "row", zone: "parts" },
      { catalogId: "wh_bench", count: 1, layout: "corner", zone: "maintenance" },
      { catalogId: "office_desk", count: 1, layout: "corner", zone: "returns" },
      { catalogId: "file_cabinet", count: 1, layout: "corner", zone: "returns" },
      { catalogId: "ironing_station", count: 1, layout: "corner", zone: "sewing" },
      { catalogId: "wh_fan", count: fans.length, layout: "wall" },
      { catalogId: "wh_lamp", count: lights.length, layout: "grid" },
    ],
    placements: [
      ...racks.map((spot, index) => ({ objectId: `wh_bay#${index}`, x: spot.x, z: spot.z, rotationY: 0 })),
      ...upper.map((spot, index) => ({ objectId: `wh_upper#${index}`, x: spot.x, z: spot.z, rotationY: 0, y: spot.y })),
      ...trucks.map((spot, index) => ({ objectId: `wh_truck#${index}`, x: spot.x, z: spot.z, rotationY: r3(yard) })),
      ...packing.map((spot, index) => ({ objectId: `wh_pack#${index}`, x: spot.x, z: spot.z, rotationY: 0 })),
      ...sewing.map((spot, index) => ({ objectId: `sewing_industrial#${index}`, x: spot.x, z: spot.z, rotationY: 0 })),
      ...fabric.map((spot, index) => ({ objectId: `wh_fabric#${index}`, x: spot.x, z: spot.z, rotationY: r3(yard) })),
      ...parts.map((spot, index) => ({ objectId: `wh_parts#${index}`, x: spot.x, z: spot.z, rotationY: r3(yard) })),
      { objectId: "wh_bench#0", x: 55, z: 8, rotationY: 0 },
      { objectId: "office_desk#0", x: 45, z: 94, rotationY: 0 },
      { objectId: "file_cabinet#0", x: 47.4, z: 94, rotationY: 0 },
      { objectId: "ironing_station#0", x: 55, z: 78, rotationY: 0 },
      ...fans.map((spot, index) => ({
        objectId: `wh_fan#${index}`,
        x: spot.x,
        z: spot.z,
        rotationY: r3(-Math.PI / 2),
        w: 1,
        l: 1,
        h: 0.352,
        y: 8,
      })),
      ...lights.map((spot, index) => ({ objectId: `wh_lamp#${index}`, x: spot.x, z: spot.z, rotationY: 0 })),
    ],
    extras: [
      warehousePiece({
        id: "wh_bay",
        name: "Pallet bay",
        dimW: 0.67,
        dimL: 0.56,
        dimH: 2.4,
        color: "#c4552a",
        kind: "rack",
        mount: "floor",
        glbPath: "/catalog/pallet_rack.glb",
        basePriceEtb: 16000,
        queryEn: "pallet bay",
      }),
      warehousePiece({
        id: "wh_upper",
        name: "Upper pallet bay",
        dimW: 0.67,
        dimL: 0.56,
        dimH: 2.4,
        color: "#c4552a",
        kind: "rack",
        mount: "floor",
        glbPath: "/catalog/pallet_rack.glb",
        basePriceEtb: 16000,
        queryEn: "pallet bay",
      }),
      warehousePiece({
        id: "wh_truck",
        name: "Yard truck",
        dimW: 2.02,
        dimL: 4.28,
        dimH: 2.04,
        color: "#4e5a3e",
        kind: "vehicle",
        mount: "floor",
        glbPath: "uaz_469_1973_classic.glb",
        basePriceEtb: 450000,
        queryEn: "yard truck",
      }),
      warehousePiece({
        id: "wh_pack",
        name: "Packing bench",
        dimW: 1.63,
        dimL: 1.01,
        dimH: 0.9,
        color: "#c5ccd1",
        kind: "table",
        mount: "floor",
        glbPath: "modern_table.glb",
        basePriceEtb: 11000,
        queryEn: "packing bench",
      }),
      warehousePiece({
        id: "wh_fabric",
        name: "Fabric rolls",
        dimW: 0.92,
        dimL: 0.6,
        dimH: 1.9,
        color: "#8a6244",
        kind: "rack",
        mount: "floor",
        glbPath: "/catalog/fabric_rack.glb",
        basePriceEtb: 9500,
        queryEn: "fabric rolls",
      }),
      warehousePiece({
        id: "wh_parts",
        name: "Parts storage",
        dimW: 1.03,
        dimL: 0.47,
        dimH: 2,
        color: "#6d7278",
        kind: "rack",
        mount: "floor",
        glbPath: "/catalog/shelf_industrial.glb",
        basePriceEtb: 7200,
        queryEn: "parts storage",
      }),
      warehousePiece({
        id: "wh_bench",
        name: "Maintenance bench",
        dimW: 0.99,
        dimL: 0.68,
        dimH: 0.85,
        color: "#c5ccd1",
        kind: "table",
        mount: "floor",
        glbPath: "/catalog/worktable_steel.glb",
        basePriceEtb: 6800,
        queryEn: "maintenance bench",
      }),
      warehousePiece({
        id: "wh_fan",
        name: "Exhaust fan",
        dimW: 0.25,
        dimL: 0.25,
        dimH: 0.088,
        color: "#9aa3ab",
        kind: "fan",
        mount: "wall",
        glbPath: "/catalog/fan_exhaust.glb",
        basePriceEtb: 3500,
        queryEn: "exhaust fan",
        category: "utilities",
        group: "construction",
      }),
      warehousePiece({
        id: "wh_lamp",
        name: "High-bay lamp",
        dimW: 1.12,
        dimL: 1.12,
        dimH: 1.23,
        color: "#f4f1c8",
        kind: "light",
        mount: "ceiling",
        glbPath: "hanging_led_lamp.glb",
        basePriceEtb: 2800,
        queryEn: "high bay lamp",
        category: "utilities",
        group: "construction",
      }),
    ],
    assumptions: [
      "A 60 × 100 m distribution warehouse, 12 m clear, kept as the garment-factory example.",
      "Eight 3 × 4 m dock doors are on the west long wall. Personnel and emergency doors are on the other walls.",
      "Clerestory windows sit on an 8.6 m sill along the east wall, plus two each on the north and south.",
      "Pallet bays use the pallet-rack model at its real 0.67 × 0.56 × 2.4 m size, in aisle pairs spread along the hall with 3.3 m aisles. One aisle is stacked three levels high, to 7.2 m.",
      "The floor is light-grey concrete. No tire-mark or stencil texture exists in the asset folder.",
      "Two yard trucks (UAZ) sit in the receiving lane. No forklift, pallet jack, trailer, person, bollard, mezzanine, or cantilever model was available.",
      "A small sewing, packing, fabric, returns, and maintenance group sits off the docks and racking.",
      "Prices are Addis Ababa catalog estimates, not quotes.",
    ],
  };
}

const garment = buildGarment();

const bakery: BuildingSpec = {
  room: { width: 10, length: 8, height: 3.2, floorType: "tile" },
  style: { roof: "slab", palette: "clay", mood: "warm" },
  openings: [
    { type: "door", wall: "south", position: 0.3, width: 1, height: 2.1 },
    { type: "door", wall: "north", position: 0.75, width: 0.9, height: 2.1 },
    { type: "window", wall: "south", position: 0.7, width: 1.5, height: 1.2 },
    { type: "window", wall: "east", position: 0.4, width: 1.2, height: 1.1 },
  ],
  zones: [
    { name: "kitchen", x: 0.8, z: 0.8, w: 8.4, l: 5 },
    { name: "counter", x: 0.8, z: 6, w: 8.4, l: 1.5 },
  ],
  items: [
    { catalogId: "oven_deck", count: 1, layout: "corner", zone: "kitchen" },
    { catalogId: "mixer_spiral", count: 1, layout: "corner", zone: "kitchen" },
    { catalogId: "proofer", count: 1, layout: "wall", zone: "kitchen" },
    { catalogId: "worktable_steel", count: 2, layout: "row", zone: "kitchen" },
    { catalogId: "fridge_display", count: 1, layout: "wall", zone: "kitchen" },
    { catalogId: "kitchen_counter", count: 1, layout: "wall", zone: "kitchen" },
    { catalogId: "display_counter", count: 1, layout: "row", zone: "counter" },
    { catalogId: "shelf_industrial", count: 1, layout: "wall", zone: "kitchen" },
    { catalogId: "light_highbay", count: 4, layout: "grid" },
  ],
  assumptions: [
    "The kitchen zone is 8.4 × 5 m, about 40 m², inside a 10 × 8 m bakery.",
    "A slab roof and tile floor are assumed for a food room.",
    "Prices are Addis Ababa catalog estimates, not quotes.",
  ],
};

const apartment: BuildingSpec = {
  room: { width: 14, length: 10, height: 2.8, floorType: "tile" },
  style: { roof: "slab", palette: "sand", mood: "warm" },
  openings: [
    { type: "door", wall: "south", position: 0.22, width: 1, height: 2.1 },
    { type: "window", wall: "south", position: 0.55, width: 1.6, height: 1.3 },
    { type: "window", wall: "south", position: 0.82, width: 1.4, height: 1.3 },
    { type: "window", wall: "north", position: 0.25, width: 1.3, height: 1.2 },
    { type: "window", wall: "north", position: 0.55, width: 1.3, height: 1.2 },
    { type: "window", wall: "east", position: 0.4, width: 1.2, height: 1.2 },
  ],
  zones: [
    { name: "living", x: 0.6, z: 0.6, w: 6.2, l: 5 },
    { name: "kitchen", x: 7.2, z: 0.6, w: 6.2, l: 3.4 },
    { name: "bed1", x: 0.6, z: 6, w: 4.2, l: 3.5 },
    { name: "bed2", x: 5, z: 6, w: 4.2, l: 3.5 },
    { name: "bed3", x: 9.4, z: 4.4, w: 4, l: 5 },
  ],
  items: [
    { catalogId: "sofa", count: 1, layout: "wall", zone: "living" },
    { catalogId: "dining_table", count: 1, layout: "row", zone: "living" },
    { catalogId: "dining_chair", count: 4, layout: "grid", zone: "living" },
    { catalogId: "kitchen_counter", count: 1, layout: "wall", zone: "kitchen" },
    { catalogId: "fridge_display", count: 1, layout: "corner", zone: "kitchen" },
    { catalogId: "bed_double", count: 1, layout: "corner", zone: "bed1" },
    { catalogId: "wardrobe", count: 1, layout: "wall", zone: "bed1" },
    { catalogId: "bed_double", count: 1, layout: "corner", zone: "bed2" },
    { catalogId: "wardrobe", count: 1, layout: "wall", zone: "bed2" },
    { catalogId: "bed_double", count: 1, layout: "corner", zone: "bed3" },
    { catalogId: "wardrobe", count: 1, layout: "wall", zone: "bed3" },
    { catalogId: "light_highbay", count: 6, layout: "grid" },
  ],
  assumptions: [
    "Drawn as one 14 × 10 m shell. Rooms are floor zones, not full partition walls.",
    "Three bedrooms, a living area, and a kitchen.",
    "Prices are Addis Ababa catalog estimates, not quotes.",
  ],
};

const retail: BuildingSpec = {
  room: { width: 12, length: 8, height: 3.4, floorType: "tile" },
  style: { roof: "slab", palette: "ink", mood: "daylight" },
  openings: [
    { type: "door", wall: "south", position: 0.5, width: 1.6, height: 2.4 },
    { type: "window", wall: "south", position: 0.22, width: 1.8, height: 1.5 },
    { type: "window", wall: "south", position: 0.78, width: 1.8, height: 1.5 },
  ],
  zones: [
    { name: "floor", x: 0.8, z: 1.6, w: 10.4, l: 5.4 },
    { name: "checkout", x: 8.6, z: 0.6, w: 2.8, l: 2 },
  ],
  items: [
    { catalogId: "gondola", count: 4, layout: "grid", zone: "floor" },
    { catalogId: "shelf_industrial", count: 2, layout: "wall", zone: "floor" },
    { catalogId: "pos_counter", count: 1, layout: "row", zone: "checkout" },
    { catalogId: "display_counter", count: 1, layout: "wall", zone: "floor" },
    { catalogId: "light_highbay", count: 4, layout: "grid" },
  ],
  assumptions: [
    "A 12 × 8 m shop floor with a checkout at the front.",
    "Prices are Addis Ababa catalog estimates, not quotes.",
  ],
};

const classroom: BuildingSpec = {
  room: { width: 9, length: 12, height: 3.2, floorType: "tile" },
  style: { roof: "slab", palette: "sage", mood: "daylight" },
  openings: [
    { type: "door", wall: "south", position: 0.15, width: 0.9, height: 2.1 },
    { type: "window", wall: "east", position: 0.25, width: 1.5, height: 1.2 },
    { type: "window", wall: "east", position: 0.5, width: 1.5, height: 1.2 },
    { type: "window", wall: "east", position: 0.75, width: 1.5, height: 1.2 },
  ],
  zones: [
    { name: "class", x: 0.7, z: 1.4, w: 7.6, l: 10 },
    { name: "front", x: 0.8, z: 0.4, w: 7.4, l: 1.2 },
  ],
  items: [
    { catalogId: "student_desk", count: 30, layout: "grid", zone: "class" },
    { catalogId: "teacher_desk", count: 1, layout: "row", zone: "front" },
    { catalogId: "office_chair", count: 1, layout: "corner", zone: "front" },
    { catalogId: "light_highbay", count: 6, layout: "grid" },
  ],
  assumptions: [
    "Thirty student desks in a 9 × 12 m classroom.",
    "Prices are Addis Ababa catalog estimates, not quotes.",
  ],
};

const roastery: BuildingSpec = {
  room: { width: 15, length: 10, height: 4, floorType: "concrete" },
  style: { roof: "sheet", palette: "clay", mood: "industrial" },
  openings: [
    { type: "door", wall: "south", position: 0.2, width: 1.6, height: 2.4 },
    { type: "door", wall: "east", position: 0.8, width: 0.9, height: 2.1 },
    { type: "window", wall: "west", position: 0.3, width: 1.4, height: 1.2 },
    { type: "window", wall: "west", position: 0.6, width: 1.4, height: 1.2 },
  ],
  zones: [
    { name: "roast", x: 0.8, z: 0.8, w: 8, l: 8.2 },
    { name: "pack", x: 9.2, z: 0.8, w: 5, l: 5 },
    { name: "counter", x: 9.2, z: 6.2, w: 5, l: 3 },
  ],
  items: [
    { catalogId: "coffee_roaster", count: 1, layout: "corner", zone: "roast" },
    { catalogId: "packing_table", count: 1, layout: "row", zone: "pack" },
    { catalogId: "shelf_industrial", count: 2, layout: "wall", zone: "pack" },
    { catalogId: "worktable_steel", count: 1, layout: "row", zone: "roast" },
    { catalogId: "display_counter", count: 1, layout: "row", zone: "counter" },
    { catalogId: "office_desk", count: 1, layout: "corner", zone: "counter" },
    { catalogId: "light_highbay", count: 6, layout: "grid" },
    { catalogId: "fan_exhaust", count: 2, layout: "wall" },
  ],
  assumptions: [
    "A 15 × 10 m roastery with a packing bench and a front counter.",
    "Prices are Addis Ababa catalog estimates, not quotes.",
  ],
};

function livingPiece(item: Pick<CatalogItem, "id" | "name" | "dimW" | "dimL" | "dimH" | "color" | "kind" | "mount" | "glbPath" | "basePriceEtb" | "queryEn">): CatalogItem {
  return {
    category: "furniture",
    group: "interior",
    tags: ["living"],
    unit: "unit",
    queryAm: item.queryEn,
    placeable: true,
    cheaperId: null,
    ...item,
  };
}

/** A 5.6 × 6.8 m living room laid out like a seated lounge: sofa under the window, table and rug in the middle. */
const living: BuildingSpec = {
  room: { width: 5.6, length: 6.8, height: 2.7, floorType: "tile" },
  style: {
    roof: "slab",
    palette: "sand",
    mood: "warm",
    wallColor: "#f3efe8",
    floorColor: "#d8bc8c",
    wallMap: "seamless_wall_bricks_texture_1texturelab.glb",
    floorMap: "old_patterned_bricks__tile_texture.glb",
  },
  openings: [
    { type: "door", wall: "south", position: 0.16, width: 0.9, height: 2.1 },
    { type: "window", wall: "north", position: 0.34, width: 1.4, height: 1.55 },
    { type: "window", wall: "north", position: 0.66, width: 1.4, height: 1.55 },
  ],
  zones: [{ name: "living", x: 0.4, z: 0.4, w: 4.8, l: 6 }],
  items: [
    { catalogId: "living_sofa", count: 1, layout: "corner", zone: "living" },
    { catalogId: "living_chair", count: 2, layout: "row", zone: "living" },
    { catalogId: "living_table", count: 1, layout: "corner", zone: "living" },
    { catalogId: "living_rug", count: 1, layout: "corner", zone: "living" },
    { catalogId: "living_sideboard", count: 2, layout: "wall", zone: "living" },
    { catalogId: "living_lamp", count: 2, layout: "corner", zone: "living" },
    { catalogId: "living_pendant", count: 1, layout: "grid" },
    { catalogId: "curtain", count: 2, layout: "wall" },
    { catalogId: "tv", count: 1, layout: "wall" },
  ],
  placements: [
    { objectId: "living_sofa#0", x: 2.8, z: 6.22, rotationY: Math.PI, w: 2.4, l: 0.92, h: 0.84, color: "#f4f1ec" },
    { objectId: "living_chair#0", x: 1.15, z: 3.5, rotationY: 0.7, w: 0.72, l: 0.7, h: 0.86, color: "#efe4d2" },
    { objectId: "living_chair#1", x: 4.45, z: 3.45, rotationY: -0.65, w: 0.72, l: 0.7, h: 0.86, color: "#efe4d2" },
    { objectId: "living_table#0", x: 2.8, z: 4.85, rotationY: 0, w: 0.95, l: 0.72, h: 0.52, color: "#c4a06a" },
    { objectId: "living_rug#0", x: 2.8, z: 4.7, rotationY: 0, w: 3.2, l: 4.2, h: 0.02 },
    { objectId: "living_sideboard#0", x: 0.24, z: 4.7, rotationY: Math.PI / 2, w: 1.55, l: 0.34, h: 0.32 },
    { objectId: "living_sideboard#1", x: 5.36, z: 4.7, rotationY: -Math.PI / 2, w: 1.55, l: 0.34, h: 0.32 },
    { objectId: "living_lamp#0", x: 0.24, z: 4.7, rotationY: 0, w: 0.32, l: 0.28, h: 0.55, y: 0.32 },
    { objectId: "living_lamp#1", x: 5.36, z: 4.7, rotationY: 0, w: 0.32, l: 0.28, h: 0.55, y: 0.32 },
    { objectId: "living_pendant#0", x: 2.8, z: 4.3, rotationY: 0, w: 0.5, l: 0.5, h: 0.32 },
    { objectId: "tv#0", x: 2.13, z: 0.06, rotationY: 0, w: 1.12, l: 0.07, h: 0.66, y: 1.05 },
  ],
  extras: [
    livingPiece({ id: "living_sofa", name: "Sofa", dimW: 2.4, dimL: 0.92, dimH: 0.84, color: "#f4f1ec", kind: "sofa", mount: "floor", glbPath: "modern_couch.glb", basePriceEtb: 28000, queryEn: "sofa" }),
    livingPiece({ id: "living_chair", name: "Armchair", dimW: 0.72, dimL: 0.7, dimH: 0.86, color: "#efe6d8", kind: "chair", mount: "floor", glbPath: "old_vintage_classroom_school_chair.glb", basePriceEtb: 6500, queryEn: "armchair" }),
    livingPiece({ id: "living_table", name: "Coffee table", dimW: 0.95, dimL: 0.72, dimH: 0.52, color: "#c4a06a", kind: "table", mount: "floor", glbPath: "art_deco_offee_table.glb", basePriceEtb: 8500, queryEn: "coffee table" }),
    livingPiece({ id: "living_rug", name: "Area rug", dimW: 2.2, dimL: 3, dimH: 0.02, color: "#d5d0c6", kind: "rug", mount: "floor", glbPath: "boho_rug.glb", basePriceEtb: 12000, queryEn: "area rug" }),
    livingPiece({ id: "living_sideboard", name: "Sideboard", dimW: 1.55, dimL: 0.34, dimH: 0.32, color: "#c4a06a", kind: "cabinet", mount: "floor", glbPath: "simple_tv_shelf_210cm.glb", basePriceEtb: 9000, queryEn: "sideboard" }),
    livingPiece({ id: "living_lamp", name: "Table lamp", dimW: 0.32, dimL: 0.28, dimH: 0.55, color: "#f7f3ea", kind: "lamp", mount: "floor", glbPath: "modern_lamp.glb", basePriceEtb: 2500, queryEn: "table lamp" }),
    livingPiece({ id: "living_pendant", name: "Ceiling lamp", dimW: 0.5, dimL: 0.5, dimH: 0.32, color: "#f7f3ea", kind: "light", mount: "ceiling", glbPath: "hanging_led_lamp.glb", basePriceEtb: 4500, queryEn: "ceiling lamp" }),
  ],
  assumptions: [
    "A 5.6 × 6.8 m living room, 2.7 m to the ceiling, sized like a real lounge.",
    "Walls use the seamless wallpaper from the asset folder, tinted to the warm white of the reference photo.",
    "The floor uses the tile texture from the asset folder, tinted to the honey tone of the reference photo.",
    "The sofa is 2.4 m, the coffee table about 0.95 m, and the rug 3.2 × 4.2 m.",
  ],
};

export const PRESETS: Record<string, BuildingSpec> = {
  garment,
  bakery,
  apartment,
  retail,
  classroom,
  roastery,
  living,
};

export const EXAMPLES: { label: string; prompt: string; preset: keyof typeof PRESETS }[] = [
  {
    label: "60×100 m garment warehouse",
    prompt: "Garment factory, 60 x 100 m, distribution warehouse with loading docks and pallet racks",
    preset: "garment",
  },
  {
    label: "Bakery with 40 m² kitchen",
    prompt: "Bakery with a 40 m2 kitchen, oven, mixer, and a small counter",
    preset: "bakery",
  },
  {
    label: "3-bedroom apartment",
    prompt: "3-bedroom apartment with a living room and kitchen",
    preset: "apartment",
  },
  {
    label: "12×8 m retail shop",
    prompt: "12x8 m retail shop with shelves and a checkout counter",
    preset: "retail",
  },
  {
    label: "Classroom for 30 students",
    prompt: "Classroom for 30 students",
    preset: "classroom",
  },
  {
    label: "Living room",
    prompt: "Living room with a sofa, coffee table, rug, curtains, and lamps",
    preset: "living",
  },
  {
    label: "Coffee roastery, 15×10 m",
    prompt: "Coffee roastery, 15x10 m, roaster, packing table, and a counter",
    preset: "roastery",
  },
];
