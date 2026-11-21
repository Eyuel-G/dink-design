import { describe, expect, it } from "vitest";
import { computeCost } from "@/lib/cost/compute";
import { fallbackSpec } from "@/lib/intent/fallback";
import { interpretEdit } from "@/lib/intent/patch";
import { EXAMPLES, PRESETS } from "@/lib/intent/presets";
import { aabbOf, overlaps } from "@/lib/layout/geom";
import { curtainAxes, fitScale } from "@/lib/layout/fit";
import { layoutSpec } from "@/lib/layout/place";
import { windowAnchor } from "@/lib/layout/walls";
import { grossWallArea, netWallArea } from "@/lib/layout/walls";
import { verifiedLink } from "@/lib/prices/link";
import { nearestColorName, rankListings } from "@/lib/prices/rank";
import { parseSelectors } from "@/lib/prices/strategies";
import { assertPublicHttpUrl, isPrivateAddress, UnsafeUrlError } from "@/lib/ssrf";
import { sanitizeUntrusted } from "@/lib/sanitize";
import type { BuildingSpec } from "@/lib/schemas";
import { redoVersion, undoVersion, type VersionRecord } from "@/lib/versions";

const rates = { laborPct: 18, contingencyPct: 10 };

describe("layout", () => {
  it("builds a 20 x 20 m room with two windows and no furniture", () => {
    const prompt = "a 20 x 20m room with 2 windows can you please create that for me and don't place anything in there like no furniture at all";
    const { spec } = fallbackSpec(prompt);
    expect(spec.room.width).toBe(20);
    expect(spec.room.length).toBe(20);
    expect(spec.items).toEqual([]);
    expect(spec.openings.filter((opening) => opening.type === "window")).toHaveLength(2);
    expect(layoutSpec(spec).objects).toEqual([]);
    const edited = interpretEdit(prompt, PRESETS.living, rates);
    expect(edited?.spec.room.width).toBe(20);
    expect(edited?.spec.room.length).toBe(20);
    expect(edited?.spec.items).toEqual([]);
    expect(edited?.spec.openings.filter((opening) => opening.type === "window")).toHaveLength(2);
    expect(layoutSpec(edited!.spec).objects).toEqual([]);
  });

  it("reads the living room example as the lounge, not the roastery", () => {
    const { spec } = fallbackSpec("Living room with a sofa, coffee table, rug, curtains, and lamps");
    expect(spec.room).toMatchObject({ width: 5.6, length: 6.8, height: 2.7 });
    expect(spec.items.some((item) => item.catalogId === "living_sofa")).toBe(true);
    expect(spec.items.some((item) => item.catalogId === "coffee_roaster")).toBe(false);
    expect(spec.items.some((item) => item.catalogId === "wh_bay")).toBe(false);
  });

  it("lays out a living room at real furniture sizes", () => {
    const layout = layoutSpec(PRESETS.living);
    const ids = layout.objects.map((object) => object.id);
    expect(ids).toContain("living_sofa#0");
    expect(ids.filter((id) => id.startsWith("living_chair"))).toHaveLength(2);
    expect(ids.filter((id) => id.startsWith("curtain"))).toHaveLength(2);
    const rug = layout.objects.find((object) => object.id === "living_rug#0");
    const sofa = layout.objects.find((object) => object.id === "living_sofa#0");
    const lamp = layout.objects.find((object) => object.id === "living_lamp#0");
    expect(rug?.h).toBeCloseTo(0.02);
    expect(rug?.w).toBeCloseTo(3.2);
    expect(sofa?.w).toBeCloseTo(2.4);
    expect(lamp?.y).toBeCloseTo(0.32);
    const tv = layout.objects.find((object) => object.id === "tv#0");
    expect(tv?.z).toBeLessThan(0.2);
    expect(tv?.x).toBeGreaterThan(1.5);
    expect(tv?.x).toBeLessThan(2.8);
    expect(tv?.y).toBeCloseTo(1.05);
    expect(tv?.h).toBeCloseTo(0.66);
  });

  it("places the garment warehouse with docks and rack aisles", () => {
    const { spec } = fallbackSpec(EXAMPLES[0].prompt);
    expect(spec.room.width).toBe(60);
    expect(spec.room.length).toBe(100);
    expect(spec.room.height).toBe(12);
    expect(spec.room.floorType).toBe("concrete");
    const docks = spec.openings.filter((opening) => opening.type === "door" && opening.width >= 2.5);
    expect(docks.length).toBeGreaterThanOrEqual(6);
    expect(docks.length).toBeLessThanOrEqual(10);
    expect(new Set(docks.map((opening) => opening.wall)).size).toBe(1);
    expect(docks.every((opening) => opening.wall === "west" && (opening.height ?? 0) >= 3 && (opening.height ?? 0) <= 4)).toBe(true);
    const clerestory = spec.openings.filter((opening) => opening.type === "window" && (opening.sill ?? 0) >= 6);
    expect(clerestory.length).toBeGreaterThanOrEqual(6);
    const first = layoutSpec(spec);
    const second = layoutSpec(spec);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.warnings).toEqual([]);
    const racks = first.objects.filter((object) => object.catalogId === "wh_bay");
    expect(racks.length).toBeGreaterThanOrEqual(40);
    expect(new Set(racks.map((rack) => rack.z)).size).toBeGreaterThanOrEqual(3);
    expect(racks[0]?.w).toBeCloseTo(0.67, 2);
    expect(racks[0]?.h).toBeCloseTo(2.4, 2);
    const aisle = [...new Set(racks.map((rack) => rack.z))].sort((a, b) => a - b);
    expect(aisle[1]! - aisle[0]! - 0.56).toBeGreaterThan(3);
    expect(aisle[1]! - aisle[0]! - 0.56).toBeLessThan(3.6);
    expect(first.objects.filter((object) => object.catalogId === "wh_truck")).toHaveLength(2);
    expect(first.objects.filter((object) => object.catalogId === "wh_lamp").length).toBeGreaterThanOrEqual(8);
    const truck = first.objects.find((object) => object.id === "wh_truck#0");
    expect(truck?.w).toBeCloseTo(2.02, 2);
    expect(truck?.l).toBeCloseTo(4.28, 2);
    expect(truck?.h).toBeCloseTo(2.04, 2);
    expect(first.objects.length).toBeLessThan(160);
    const withoutOne = layoutSpec({ ...spec, removed: ["wh_bay#0"] });
    expect(withoutOne.objects.some((object) => object.id === "wh_bay#0")).toBe(false);
    expect(withoutOne.objects.filter((object) => object.catalogId === "wh_bay")).toHaveLength(racks.length - 1);
    const floor = first.objects.filter((object) => object.mount !== "ceiling");
    for (let i = 0; i < floor.length; i += 1) {
      for (let j = i + 1; j < floor.length; j += 1) {
        const above = floor[i].y + floor[i].h <= floor[j].y + 0.02 || floor[j].y + floor[j].h <= floor[i].y + 0.02;
        if (above) continue;
        const a = aabbOf(floor[i].x, floor[i].z, floor[i].w, floor[i].l, floor[i].rotationY);
        const b = aabbOf(floor[j].x, floor[j].z, floor[j].w, floor[j].l, floor[j].rotationY);
        expect(overlaps(a, b, 0), `${floor[i].id} overlaps ${floor[j].id}`).toBe(false);
      }
    }
    for (const object of first.objects) {
      expect(object.x).toBeGreaterThan(0);
      expect(object.x).toBeLessThan(spec.room.width);
      expect(object.z).toBeGreaterThan(0);
      expect(object.z).toBeLessThan(spec.room.length);
      expect(object.h).toBeLessThanOrEqual(spec.room.height + 0.001);
    }
    const columns = first.objects.filter((object) => object.catalogId === "column_steel");
    expect(columns.length).toBeGreaterThan(8);
    expect(columns.length).toBeLessThan(50);
    for (const column of columns) {
      expect(column.y).toBe(0);
      expect(column.h).toBe(spec.room.height);
    }
  });

  it("gives every example a scene", () => {
    for (const example of EXAMPLES) {
      const { spec } = fallbackSpec(example.prompt);
      const layout = layoutSpec(spec);
      expect(layout.objects.length).toBeGreaterThan(3);
    }
  });
});

describe("cost", () => {
  it("subtracts openings from wall area", () => {
    const room = { width: 10, length: 8, height: 3, floorType: "concrete" as const };
    const openings = [
      { type: "door" as const, wall: "south" as const, position: 0.5, width: 1, height: 2.1 },
      { type: "window" as const, wall: "east" as const, position: 0.5, width: 1.5, height: 1.2 },
    ];
    expect(grossWallArea(room)).toBe(108);
    expect(netWallArea(room, openings)).toBeCloseTo(104.1, 5);
  });

  it("matches a hand-worked total for a 6 x 6 x 3 room", () => {
    const spec: BuildingSpec = {
      room: { width: 6, length: 6, height: 3, floorType: "concrete" },
      openings: [
        { type: "door", wall: "south", position: 0.5, width: 0.9, height: 2.1 },
        { type: "window", wall: "east", position: 0.5, width: 1.2, height: 1.2 },
      ],
      zones: [],
      items: [],
      style: { roof: "sheet", palette: "concrete", mood: "industrial" },
      assumptions: [],
    };
    const layout = layoutSpec(spec);
    expect(layout.objects.filter((object) => object.catalogId === "column_steel")).toHaveLength(0);
    const report = computeCost(spec, layout, rates);
    const again = computeCost(spec, layout, rates);
    expect(JSON.stringify(report)).toBe(JSON.stringify(again));
    // gross wall 2*(6+6)*3 = 72
    // door 0.9*2.1 = 1.89, window 1.2*1.2 = 1.44, net = 68.67
    // wall 68.67*1850 = 127039.5
    // floor 36*1200 = 43200
    // roof 36*950 = 34200
    // screed 36*180 = 6480
    // paint in 68.67*180 = 12360.6
    // paint out 68.67*150 = 10300.5
    // power ceil(36/8)=5 * 450 = 2250
    // door 6500, window 4800
    // materials = 247130.6
    // labor 18% = 44483.51
    // subtotal 291614.11
    // contingency 10% = 29161.41
    // total 320775.52
    expect(report.wallArea).toBe(68.67);
    expect(report.materials).toBe(247130.6);
    expect(report.labor).toBe(44483.51);
    expect(report.contingency).toBe(29161.41);
    expect(report.total).toBe(320775.52);
  });
});

describe("fit", () => {
  it("keeps a column at full room height and keeps other meshes in proportion", () => {
    const column = fitScale({ x: 1, y: 1, z: 1 }, { w: 0.3, h: 4.5, l: 0.3 }, "column");
    expect(column.y).toBeCloseTo(4.5);
    expect(column.x).toBeGreaterThan(0.2);
    expect(column.x).toBeLessThanOrEqual(0.65);
    const box = fitScale({ x: 4.4, y: 1.3, z: 1.7 }, { w: 4.3, h: 1.4, l: 1.8 }, "box");
    expect(box.x).toBeCloseTo(box.y);
    expect(box.y).toBeCloseTo(box.z);
    expect(4.4 * box.x).toBeLessThanOrEqual(4.3 + 0.001);
    expect(1.3 * box.y).toBeLessThanOrEqual(1.4 + 0.001);
    const curtain = fitScale({ x: 1.8, y: 0.9, z: 0.2 }, { w: 1.5, h: 1.2, l: 0.08 }, "curtain");
    expect(1.8 * curtain.x).toBeCloseTo(1.5);
    expect(0.9 * curtain.y).toBeCloseTo(1.2);
    expect(0.2 * curtain.z).toBeCloseTo(0.08);
    expect(curtainAxes({ x: 0.14, y: 2.2, z: 1.8 })).toEqual({ width: "z", height: "y", depth: "x" });
    expect(curtainAxes({ x: 10, y: 0.2, z: 2 })).toEqual({ width: "x", height: "z", depth: "y" });
  });
});

describe("edits", () => {
  it("raises the roof and undoes it exactly", () => {
    const { spec } = fallbackSpec(EXAMPLES[0].prompt);
    const edited = interpretEdit("Make the roof higher", spec, rates);
    expect(edited).not.toBeNull();
    expect(edited!.spec.room.height).toBeCloseTo(Math.min(12, spec.room.height + 0.5), 5);
    const versions: VersionRecord[] = [
      { version: 1, parent: null, spec, label: "Initial" },
      { version: 2, parent: 1, spec: edited!.spec, label: edited!.label },
    ];
    expect(undoVersion(versions, 2)).toBe(1);
    expect(versions.find((version) => version.version === 1)?.spec).toEqual(spec);
    expect(redoVersion(versions, 1)).toBe(2);
  });

  it("reduces cost with deterministic strategies and a visible delta", () => {
    const { spec } = fallbackSpec(EXAMPLES[0].prompt);
    const first = interpretEdit("Reduce cost by 15%", spec, rates);
    const second = interpretEdit("Reduce cost by 15%", spec, rates);
    expect(first).not.toBeNull();
    expect(JSON.stringify(first!.spec)).toBe(JSON.stringify(second!.spec));
    expect(first!.after!).toBeLessThanOrEqual(first!.before! * 0.85 + 1);
    expect(first!.before! - first!.after!).toBeGreaterThan(0);
  });

  it("places curtains, rugs, and sewing machines from a short command", () => {
    const spec: BuildingSpec = {
      room: { width: 8, length: 6, height: 3, floorType: "concrete" },
      openings: [],
      zones: [],
      items: [],
      style: { roof: "slab", palette: "sand", mood: "daylight" },
      assumptions: [],
    };
    const curtain = interpretEdit("place a curtain", spec, rates);
    expect(curtain?.spec.items).toEqual([{ catalogId: "curtain", count: 1, layout: "wall" }]);
    const hung = layoutSpec(curtain!.spec).objects.find((object) => object.catalogId === "curtain");
    expect(hung).toBeTruthy();
    expect(hung!.y + hung!.h).toBeGreaterThan(spec.room.height - 0.1);
    expect(interpretEdit("place curtain", spec, rates)?.spec.items[0]?.catalogId).toBe("curtain");
    expect(interpretEdit("put two rugs", spec, rates)?.spec.items).toEqual([{ catalogId: "rug", count: 2, layout: "grid" }]);
    expect(interpretEdit("insert a sewing machine", spec, rates)?.spec.items[0]?.catalogId).toBe("sewing_industrial");
    expect(interpretEdit("place a tv", spec, rates)?.spec.items[0]).toMatchObject({ catalogId: "tv", layout: "wall" });
    const factory = fallbackSpec("Garment factory, 20 x 30 m, 12 sewing stations, 2 cutting tables, storage, office, 2 exits").spec;
    const withCurtains = interpretEdit("place curtain at each of the windows", factory, rates)!.spec;
    const windows = withCurtains.openings.filter((opening) => opening.type === "window");
    expect(withCurtains.items.find((item) => item.catalogId === "curtain")?.count).toBe(windows.length);
    const windowCurtains = layoutSpec(withCurtains).objects.filter((object) => object.catalogId === "curtain");
    expect(windowCurtains).toHaveLength(windows.length);
    windowCurtains.forEach((piece, index) => {
      const anchor = windowAnchor(withCurtains.room, windows[index]);
      expect(piece.x).toBe(anchor.x);
      expect(piece.y).toBe(anchor.y);
      expect(piece.z).toBe(anchor.z);
      expect(piece.w).toBe(anchor.w);
      expect(piece.h).toBe(anchor.h);
    });
  });

  it("places a named asset from the model folder, and keeps a search item when none is there", () => {
    const spec: BuildingSpec = {
      room: { width: 12, length: 10, height: 3.2, floorType: "concrete" },
      openings: [],
      zones: [],
      items: [],
      style: { roof: "slab", palette: "sand", mood: "daylight" },
      assumptions: [],
    };
    const bmw = interpretEdit("could you place a bmw", spec, rates);
    expect(bmw?.spec.items[0]?.catalogId.startsWith("asset_")).toBe(true);
    expect(bmw?.spec.extras?.[0]?.glbPath).toMatch(/bmw/i);
    const car = layoutSpec(bmw!.spec).objects.find((object) => object.catalogId.startsWith("asset_"));
    expect(car).toBeTruthy();
    expect(car!.w).toBeGreaterThan(2);
    expect(car!.w).toBeLessThanOrEqual(12 * 0.55);
    expect(car!.h).toBeGreaterThan(0.8);
    expect(car!.h).toBeLessThan(spec.room.height);

    const column = interpretEdit("i want a column", spec, rates);
    expect(column?.spec.extras?.[0]?.kind).toBe("column");
    expect(column?.spec.extras?.[0]?.glbPath).toMatch(/column|pillar/i);
    const placedColumn = layoutSpec(column!.spec).objects.find((object) => object.catalogId.startsWith("asset_"));
    expect(placedColumn?.h).toBe(spec.room.height);

    const windowModel = interpretEdit("put a wooden window", spec, rates);
    expect(windowModel?.spec.extras?.[0]?.glbPath).toMatch(/wooden/i);
    expect(windowModel?.spec.extras?.[0]?.mount).toBe("wall");

    const missing = interpretEdit("place a spaceship", spec, rates);
    expect(missing?.spec.items[0]?.catalogId.startsWith("asset_")).toBe(true);
    expect(missing?.spec.extras?.[0]?.glbPath).toBeNull();
    expect(layoutSpec(missing!.spec).objects.some((object) => object.catalogId.startsWith("asset_"))).toBe(true);
  });
});

describe("prices", () => {
  it("links only a parsed price on the source host", () => {
    expect(verifiedLink({ price: 100, url: "https://evil.example/item" }, "https://jiji.com.et")).toBeNull();
    expect(verifiedLink({ price: 0, url: "https://jiji.com.et/item" }, "https://jiji.com.et")).toBeNull();
    expect(verifiedLink({ price: 100, url: "https://jiji.com.et.evil.com/item" }, "https://jiji.com.et")).toBeNull();
    expect(verifiedLink({ price: 18500, url: "https://www.jiji.com.et/item/sewing" }, "https://jiji.com.et")).toBe(
      "https://www.jiji.com.et/item/sewing",
    );
    expect(verifiedLink({ price: 100, url: "not a url" }, "https://jiji.com.et")).toBeNull();
  });

  it("drops negotiable prices, weak matches, and outliers", () => {
    const ranked = rankListings(
      [
        { title: "Industrial sewing machine Juki", price: 30000, currency: "ETB", url: "https://jiji.com.et/a", relevance: 0.9 },
        { title: "Industrial sewing machine Brother", price: 32000, currency: "ETB", url: "https://jiji.com.et/b", relevance: 0.86 },
        { title: "Industrial sewing machine", price: 1, currency: "ETB", url: "https://jiji.com.et/c", relevance: 0.8 },
        { title: "Industrial sewing machine negotiable", price: 20000, currency: "ETB", url: "https://jiji.com.et/d", relevance: 0.9, negotiable: true },
        { title: "Phone case", price: 500, currency: "ETB", url: "https://jiji.com.et/e", relevance: 0.2 },
        { title: "Industrial sewing machine outlier", price: 400000, currency: "ETB", url: "https://off.example/f", relevance: 0.9 },
      ],
      "industrial sewing machine",
      "https://jiji.com.et",
    );
    expect(ranked.listings.map((listing) => listing.price)).toEqual([30000, 32000]);
    expect(ranked.confidence).toBe("medium");
    expect(ranked.listings.every((listing) => listing.url?.includes("jiji.com.et"))).toBe(true);
    const colored = rankListings(
      [
        { title: "White office chair", price: 4000, currency: "ETB", url: "https://jiji.com.et/white", relevance: 0.9 },
        { title: "Black office chair", price: 5200, currency: "ETB", url: "https://jiji.com.et/black", relevance: 0.9 },
      ],
      "office chair",
      "https://jiji.com.et",
      { color: "#24312e" },
    );
    expect(nearestColorName("#24312e")).toBe("black");
    expect(colored.listings.map((listing) => listing.title)).toEqual(["Black office chair"]);
    const kind = rankListings(
      [
        { title: "Shower Curtain Linen", price: 2200, currency: "ETB", url: "https://jiji.com.et/shower", relevance: 0.95 },
        { title: "Beige window curtain", price: 1800, currency: "ETB", url: "https://jiji.com.et/window", relevance: 0.9 },
      ],
      "curtain",
      "https://jiji.com.et",
      { color: "#e4d8c8" },
    );
    expect(kind.listings.map((listing) => listing.title)).toEqual(["Beige window curtain"]);
    const lights = rankListings(
      [{ title: "240 Led Waterfall Curtain Light", price: 4200, currency: "ETB", url: "https://jiji.com.et/led", relevance: 0.95 }],
      "curtain",
      "https://jiji.com.et",
    );
    expect(lights.listings).toEqual([]);
    const domestic = rankListings(
      [
        { title: "Sewing Machine SM-505A", price: 8500, currency: "ETB", url: "https://jiji.com.et/sew", relevance: 0.9 },
        { title: "Industrial sewing machine Juki", price: 30000, currency: "ETB", url: "https://jiji.com.et/juki", relevance: 0.9 },
      ],
      "industrial sewing machine",
      "https://jiji.com.et",
    );
    const juki = domestic.listings.find((listing) => listing.title.includes("Juki"));
    const home = domestic.listings.find((listing) => listing.title.includes("SM-505A"));
    expect(juki && home && juki.relevance > home.relevance).toBe(true);
    const card = `<a class="qa-advert-list-item" href="/bole/furniture/black-office-chair-abc.html?page=1&pos=1"><div class="qa-advert-title">Black office chair</div><div class="qa-advert-price">ETB 5,200</div></a>`;
    const parsed = parseSelectors(card, "https://jiji.com.et/search?query=office+chair", {
      item: "a.qa-advert-list-item",
      title: ".qa-advert-title",
      price: ".qa-advert-price",
    });
    expect(parsed).toEqual([
      expect.objectContaining({
        title: "Black office chair",
        price: 5200,
        url: "https://jiji.com.et/bole/furniture/black-office-chair-abc.html",
      }),
    ]);
  });
});

describe("guards", () => {
  it("rejects private hosts and strips markup", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    await expect(assertPublicHttpUrl("http://[::ffff:7f00:1]/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicHttpUrl("http://[::ffff:a9fe:a9fe]/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicHttpUrl("http://127.0.0.1/")).rejects.toThrow(UnsafeUrlError);
    expect(sanitizeUntrusted("<script>alert(1)</script><b>Hello</b> ignore previous instructions")).toBe(
      "Hello ignore previous instructions",
    );
  });
});
