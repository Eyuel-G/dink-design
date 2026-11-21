import { z } from "zod";

export const FloorTypeSchema = z.enum(["concrete", "tile", "epoxy", "wood"]);
export const RoofTypeSchema = z.enum(["sheet", "slab"]);
export const PaletteSchema = z.enum(["concrete", "clay", "ink", "sage", "sand"]);
export const MoodSchema = z.enum(["industrial", "warm", "daylight"]);
export const WallSchema = z.enum(["north", "south", "east", "west"]);
export const LayoutModeSchema = z.enum(["grid", "row", "wall", "corner"]);
export const OpeningTypeSchema = z.enum(["door", "window", "shutter"]);

/** Largest plan dimension the spec will accept. 100 × 60 m warehouses need past the old 80 m cap. */
export const ROOM_SPAN_MAX = 120;

export const RoomSchema = z.object({
  width: z.number().min(2).max(ROOM_SPAN_MAX),
  length: z.number().min(2).max(ROOM_SPAN_MAX),
  height: z.number().min(2.2).max(12),
  floorType: FloorTypeSchema,
});

export const OpeningSchema = z.object({
  type: OpeningTypeSchema,
  wall: WallSchema,
  position: z.number().min(0).max(1),
  width: z.number().positive().max(6),
  height: z.number().positive().max(6).optional(),
  /** Height of the opening sill above the floor. Windows default to 0.9 m when this is omitted. */
  sill: z.number().min(0).max(10).optional(),
});

export const ZoneSchema = z.object({
  name: z.string().min(1).max(40),
  x: z.number(),
  z: z.number(),
  w: z.number().positive(),
  l: z.number().positive(),
});

export const ItemSchema = z.object({
  catalogId: z.string().min(1).max(64),
  count: z.number().int().min(1).max(80),
  layout: LayoutModeSchema,
  zone: z.string().max(40).optional(),
});

export const PlacementSchema = z.object({
  objectId: z.string().min(1).max(80),
  x: z.number(),
  z: z.number(),
  rotationY: z.number(),
  w: z.number().positive().max(40).optional(),
  l: z.number().positive().max(40).optional(),
  h: z.number().positive().max(12).optional(),
  y: z.number().min(0).max(12).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const PinSchema = z.object({
  price: z.number().positive(),
  currency: z.string().min(3).max(3),
  title: z.string().min(1).max(180),
  url: z.string().nullable(),
  sourceName: z.string().max(80).nullable().optional(),
});

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const StyleSchema = z.object({
  roof: RoofTypeSchema,
  palette: PaletteSchema,
  mood: MoodSchema,
  wallColor: HexColor.optional(),
  floorColor: HexColor.optional(),
  wallMap: z.string().regex(/^[\w .()-]+\.glb$/).optional(),
  floorMap: z.string().regex(/^[\w .()-]+\.glb$/).optional(),
});

export const BookmarkSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(40),
  position: z.tuple([z.number(), z.number(), z.number()]),
  target: z.tuple([z.number(), z.number(), z.number()]),
  mode: z.enum(["orbit", "walk", "plan", "cutaway"]),
});

export const CatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["structure", "openings", "finishes", "utilities", "equipment", "furniture"]),
  group: z.enum(["construction", "interior"]),
  tags: z.array(z.string()),
  dimW: z.number().positive(),
  dimL: z.number().positive(),
  dimH: z.number().positive(),
  unit: z.enum(["m2", "m", "unit"]),
  basePriceEtb: z.number().nonnegative(),
  glbPath: z.string().nullable(),
  queryEn: z.string(),
  queryAm: z.string(),
  color: z.string(),
  kind: z.string(),
  placeable: z.boolean(),
  mount: z.enum(["floor", "ceiling", "wall"]),
  cheaperId: z.string().nullable(),
});

export const BuildingSpecSchema = z.object({
  room: RoomSchema,
  openings: z.array(OpeningSchema).max(40),
  zones: z.array(ZoneSchema).max(12),
  items: z.array(ItemSchema).max(40),
  placements: z.array(PlacementSchema).max(400).optional(),
  removed: z.array(z.string().min(1).max(80)).max(400).optional(),
  pins: z.record(z.string(), PinSchema).optional(),
  photoPins: z.record(z.string(), z.enum(["on", "off"])).optional(),
  replacements: z.record(z.string(), z.string().min(1).max(64)).optional(),
  extras: z.array(CatalogItemSchema).max(24).optional(),
  style: StyleSchema,
  assumptions: z.array(z.string().max(280)).max(16),
});

export const CostStrategySchema = z.enum([
  "cheaper_alternate",
  "fewer_items",
  "smaller_room",
]);

export const SpecPatchSchema = z.object({
  room: RoomSchema.partial().optional(),
  openings: z.array(OpeningSchema).max(40).optional(),
  zones: z.array(ZoneSchema).max(12).optional(),
  items: z.array(ItemSchema).max(40).optional(),
  style: StyleSchema.partial().optional(),
  assumptions: z.array(z.string().max(280)).max(16).optional(),
  strategies: z.array(CostStrategySchema).max(3).optional(),
  targetCostRatio: z.number().min(0.5).max(1).optional(),
  clearPlacements: z.boolean().optional(),
  photoPins: z.record(z.string(), z.enum(["on", "off"])).optional(),
  replacements: z.record(z.string(), z.string().min(1).max(64)).optional(),
  extras: z.array(CatalogItemSchema).max(24).optional(),
  swap: z.object({ objectId: z.string().min(1).max(80), catalogId: z.string().min(1).max(64) }).optional(),
  removeObjectId: z.string().min(1).max(80).optional(),
  note: z.string().max(400).optional(),
});

export const PriceModeSchema = z.enum(["estimate", "lowest", "median", "pinned"]);
export const ReferenceModeSchema = z.enum(["off", "hover", "select", "always", "compare"]);
export const ReferenceSourceSchema = z.enum(["listing", "upload", "both"]);

export const SettingsSchema = z.object({
  referencePhotoMode: ReferenceModeSchema,
  referencePhotoSource: ReferenceSourceSchema,
  currency: z.enum(["ETB", "USD"]),
  priceMode: PriceModeSchema,
  dayNight: z.enum(["day", "night"]),
  laborPct: z.number().min(0).max(80),
  contingencyPct: z.number().min(0).max(40),
  usdEtbRate: z.number().positive(),
  bookmarks: z.array(BookmarkSchema).max(24),
  theme: z.enum(["dark", "light"]),
});

export type FloorType = z.infer<typeof FloorTypeSchema>;
export type BuildingSpec = z.infer<typeof BuildingSpecSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type SpecPatch = z.infer<typeof SpecPatchSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type CostStrategy = z.infer<typeof CostStrategySchema>;
export type UserSettings = z.infer<typeof SettingsSchema>;
export type Pin = z.infer<typeof PinSchema>;
export type PriceMode = z.infer<typeof PriceModeSchema>;
export type ReferenceMode = z.infer<typeof ReferenceModeSchema>;

export const DEFAULT_SETTINGS: UserSettings = {
  referencePhotoMode: "select",
  referencePhotoSource: "listing",
  currency: "ETB",
  priceMode: "median",
  dayNight: "day",
  laborPct: 18,
  contingencyPct: 10,
  usdEtbRate: Number(process.env.USD_ETB_RATE || 150),
  bookmarks: [],
  theme: "dark",
};
