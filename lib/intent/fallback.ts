import { matchCatalogPhrase, WORD_NUMBERS } from "@/lib/catalog";
import { EXAMPLES, PRESETS } from "@/lib/intent/presets";
import { r3 } from "@/lib/num";
import { BuildingSpecSchema, ROOM_SPAN_MAX, type BuildingSpec } from "@/lib/schemas";

export interface IntentResult {
  spec: BuildingSpec;
  source: "preset" | "parser" | "llm" | "cache";
  note: string;
}

export function fallbackSpec(prompt: string): IntentResult {
  if (bareRoomPrompt(prompt)) {
    const spec = BuildingSpecSchema.parse(emptyRoomSpec(prompt));
    return {
      spec,
      source: "parser",
      note: `A ${spec.room.width} × ${spec.room.length} m room with ${spec.openings.filter((opening) => opening.type === "window").length} windows and no furniture.`,
    };
  }
  const presetName = detectPreset(prompt);
  const base = presetName ? structuredClone(PRESETS[presetName]) : genericSpec(prompt);
  const sized = applyDimensions(base, prompt, presetName);
  const counted = applyCounts(sized, prompt);
  const spec = BuildingSpecSchema.parse(counted);
  const note = presetName
    ? "Built from a local reading of your prompt. A planning model was not used for this pass."
    : "Built from a local reading of your prompt, using catalog dimensions. A planning model was not used.";
  return { spec, source: presetName ? "preset" : "parser", note };
}

/** A sized room, or a room that names only windows and doors, with no furniture or equipment. */
export function bareRoomPrompt(prompt: string): boolean {
  const text = prompt
    .toLowerCase()
    .replace(/\b(?:no|without|don'?t|do not)\s+(?:place\s+)?(?:any\s+)?furniture\b/g, " ")
    .replace(/\b(?:don'?t|do not)\s+place\s+anything\b/g, " ");
  if (detectPreset(text)) return false;
  if (matchCatalogPhrase(text)) return false;
  if (/\b(sofa|chair|table|desk|bed|lamp|curtain|rug|carpet|shelf|machine|oven|cabinet|sewing|factory|shop|store|furniture)\b/.test(text)) return false;
  const sized = /(\d+(?:\.\d+)?)\s*(?:m|meter|metres|meters)?\s*[x×]\s*(\d+(?:\.\d+)?)/i.test(text);
  const windows = new RegExp(`(?:${Object.keys(WORD_NUMBERS).join("|")}|\\d+)\\s+windows?`).test(text);
  const callsItRoom = /\b(room|hall)\b/.test(text);
  const forbidsFurniture = /\b(no furniture|without furniture|empty|bare|nothing)\b/.test(text);
  return callsItRoom || (sized && windows) || forbidsFurniture;
}

export function emptyRoomSpec(prompt: string): BuildingSpec {
  const text = prompt.toLowerCase();
  const pair = text.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|metres|meters)?\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  let width = pair ? Number(pair[1]) : 8;
  let length = pair ? Number(pair[2]) : 6;
  if (width < 2 || length < 2 || width > ROOM_SPAN_MAX || length > ROOM_SPAN_MAX) {
    width = 8;
    length = 6;
  }
  const heightMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:eters?)?\s*(?:high|tall)|(?:ceiling|roof|height)\s*(?:of\s*)?(\d+(?:\.\d+)?)/);
  const height = Math.min(12, Math.max(2.4, heightMatch ? Number(heightMatch[1] || heightMatch[2]) : 3));
  const windowMatch = text.match(new RegExp(`(${Object.keys(WORD_NUMBERS).join("|")}|\\d+)\\s+windows?`));
  const windowCount = Math.min(12, windowMatch ? Number(windowMatch[1]) || WORD_NUMBERS[windowMatch[1]] || 2 : 2);
  const doorMatch = text.match(new RegExp(`(${Object.keys(WORD_NUMBERS).join("|")}|\\d+)\\s+doors?`));
  const doorCount = /\b(no doors?|without (?:a |any )?doors?)\b/.test(text) ? 0 : Math.min(4, doorMatch ? Number(doorMatch[1]) || WORD_NUMBERS[doorMatch[1]] || 1 : 1);
  const floor = text.match(/\b(tile|concrete|epoxy|wood)\b/);
  const openings: BuildingSpec["openings"] = [];
  const windowWidth = r3(Math.min(1.5, Math.max(0.9, (width * 0.7) / Math.max(1, windowCount))));
  for (let i = 0; i < windowCount; i += 1) {
    openings.push({
      type: "window",
      wall: "north",
      position: r3((i + 1) / (windowCount + 1)),
      width: windowWidth,
      height: 1.2,
    });
  }
  for (let i = 0; i < doorCount; i += 1) {
    openings.push({
      type: "door",
      wall: "south",
      position: r3((i + 1) / (doorCount + 1)),
      width: 0.9,
      height: 2.1,
    });
  }
  const windowLabel = `${windowCount} window${windowCount === 1 ? "" : "s"}`;
  const doorLabel = doorCount === 0 ? "No door" : `${doorCount} door${doorCount === 1 ? "" : "s"}`;
  return {
    room: { width: r3(width), length: r3(length), height: r3(height), floorType: (floor?.[1] as BuildingSpec["room"]["floorType"]) || "concrete" },
    style: { roof: "slab", palette: "sand", mood: "daylight" },
    openings,
    zones: [{ name: "room", x: 0.6, z: 0.6, w: r3(Math.max(1, width - 1.2)), l: r3(Math.max(1, length - 1.2)) }],
    items: [],
    assumptions: [
      `A ${r3(width)} × ${r3(length)} m room, ${r3(height)} m to the ceiling.`,
      `${windowLabel} on the north wall. ${doorLabel} on the south wall.`,
      "Nothing is placed inside. No furniture, shelves, or lights.",
    ],
  };
}

export function detectPreset(prompt: string): keyof typeof PRESETS | null {
  const text = prompt.toLowerCase();
  if (/garment|sewing/.test(text)) return "garment";
  if (/bakery|bread/.test(text)) return "bakery";
  if (/apartment|bedroom|flat/.test(text)) return "apartment";
  if (/retail|shop|store/.test(text) && !/storage/.test(text)) return "retail";
  if (/classroom|student/.test(text)) return "classroom";
  if (/coffee|roastery|roaster/.test(text)) return "roastery";
  return null;
}

function applyDimensions(spec: BuildingSpec, prompt: string, preset: keyof typeof PRESETS | null): BuildingSpec {
  const pair = prompt.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|metres|meters)?\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!pair) return spec;
  const width = Number(pair[1]);
  const length = Number(pair[2]);
  if (width < 2 || length < 2 || width > ROOM_SPAN_MAX || length > ROOM_SPAN_MAX) return spec;
  if (preset === "bakery") return spec;
  const sx = width / spec.room.width;
  const sz = length / spec.room.length;
  const resized = Math.abs(sx - 1) > 0.001 || Math.abs(sz - 1) > 0.001;
  return {
    ...spec,
    room: { ...spec.room, width: r3(width), length: r3(length) },
    zones: spec.zones.map((zone) => ({
      ...zone,
      x: r3(zone.x * sx),
      z: r3(zone.z * sz),
      w: r3(Math.max(0.8, zone.w * sx)),
      l: r3(Math.max(0.8, zone.l * sz)),
    })),
    placements: resized ? [] : spec.placements,
  };
}

function applyCounts(spec: BuildingSpec, prompt: string): BuildingSpec {
  const items = spec.items.map((item) => ({ ...item }));
  const exits = prompt.match(/(\d+)\s*(exits|exit doors|doors)/i);
  if (exits) {
    const wanted = Number(exits[1]);
    const doors = spec.openings.filter((opening) => opening.type === "door");
    const windows = spec.openings.filter((opening) => opening.type !== "door");
    const nextDoors = doors.slice(0, wanted);
    while (nextDoors.length < wanted) {
      nextDoors.push({
        type: "door",
        wall: nextDoors.length % 2 === 0 ? "south" : "north",
        position: nextDoors.length % 2 === 0 ? 0.2 : 0.8,
        width: 1.6,
        height: 2.4,
      });
    }
    spec = { ...spec, openings: [...nextDoors, ...windows] };
  }
  const pattern = /(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|thirty)\s+([a-z][a-z\s-]{2,40}?)(?=,|\.|$| and | with )/gi;
  let match: RegExpExecArray | null;
  const text = prompt.toLowerCase();
  while ((match = pattern.exec(text))) {
    const count = Number(match[1]) || WORD_NUMBERS[match[1]] || 0;
    const id = matchCatalogPhrase(match[2]);
    if (!id || count < 1) continue;
    const existing = items.find((item) => item.catalogId === id);
    if (existing) existing.count = Math.min(80, count);
    else items.push({ catalogId: id, count: Math.min(80, count), layout: "grid" });
  }
  const students = text.match(/(\d+)\s+students/);
  if (students) {
    const desks = items.find((item) => item.catalogId === "student_desk");
    if (desks) desks.count = Math.min(80, Number(students[1]));
  }
  return { ...spec, items };
}

function genericSpec(prompt: string): BuildingSpec {
  const area = prompt.match(/(\d+(?:\.\d+)?)\s*(?:m2|m²|sqm|square meters?)/i);
  let width = 8;
  let length = 6;
  if (area) {
    const meters = Number(area[1]);
    width = r3(Math.sqrt(meters * 1.25));
    length = r3(meters / width);
  }
  const height = /factory|workshop|warehouse/.test(prompt.toLowerCase()) ? 4.5 : 3;
  return {
    room: { width, length, height, floorType: "concrete" },
    style: { roof: height > 3.5 ? "sheet" : "slab", palette: "sand", mood: "daylight" },
    openings: [
      { type: "door", wall: "south", position: 0.5, width: 0.9, height: 2.1 },
      { type: "window", wall: "east", position: 0.35, width: 1.2, height: 1.2 },
      { type: "window", wall: "west", position: 0.65, width: 1.2, height: 1.2 },
    ],
    zones: [{ name: "room", x: 0.7, z: 0.7, w: r3(width - 1.4), l: r3(length - 1.4) }],
    items: [
      { catalogId: "worktable_steel", count: 1, layout: "row", zone: "room" },
      { catalogId: "shelf_industrial", count: 1, layout: "wall", zone: "room" },
      { catalogId: "light_highbay", count: 2, layout: "grid" },
    ],
    assumptions: [
      "No building type was recognized, so this is a plain room with a work table and a shelf.",
      "One door and two windows were assumed.",
      "Prices are Addis Ababa catalog estimates, not quotes.",
    ],
  };
}

export function exampleByPrompt(prompt: string) {
  const norm = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  return EXAMPLES.find((example) => example.prompt.toLowerCase().replace(/\s+/g, " ").trim() === norm);
}
