import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog";
import { libraryModel, libraryOptions } from "@/lib/assets/library";

function fileFor(id: string): string {
  const item = CATALOG.find((entry) => entry.id === id);
  if (!item) throw new Error(id);
  return libraryModel(item)?.file.split("/").pop() ?? "";
}

describe("catalog/models", () => {
  it("uses the placed sewing machine, lamp, sofa, bed, and wardrobe", () => {
    expect(fileFor("sewing_industrial")).toBe("vintage_sewing_machine.glb");
    expect(fileFor("sewing_basic")).toBe("vintage_sewing_machine.glb");
    expect(fileFor("light_highbay")).toBe("hanging_led_lamp.glb");
    expect(fileFor("sofa")).toBe("sofa_set_01.glb");
    expect(fileFor("bed_double")).toBe("dark_modern_bed.glb");
    expect(fileFor("wardrobe")).toBe("modern_wardrobe_design_minimalis.glb");
  });

  it("picks a table, desk, and column instead of a room or a vehicle", () => {
    expect(fileFor("dining_table")).toBe("dining_table.glb");
    expect(fileFor("cutting_table")).toBe("modern_table.glb");
    expect(fileFor("coffee_table_art_deco")).toMatch(/coffee_table|offee_table/);
    expect(fileFor("student_desk")).toBe("school_desk.glb");
    expect(fileFor("column_steel")).toBe("classical_marble_column.glb");
    expect(fileFor("curtain")).toBe("indoor_curtain.glb");
    expect(fileFor("rug")).toMatch(/carpet|rug/);
    expect(fileFor("sink")).toMatch(/sink/);
    expect(fileFor("tv")).toMatch(/tv/);
    expect(fileFor("kitchen_counter")).toBe("modern__kitchen__cabinets.glb");
    expect(fileFor("fabric_rack")).toBe("");
    expect(fileFor("shelf_industrial")).toBe("");
    expect(fileFor("file_cabinet")).toBe("");
    expect(fileFor("office_desk")).toBe("");
    const tables = libraryOptions("coffee table", "coffee_table.glb");
    expect(tables.length).toBeGreaterThan(1);
    expect(tables.every((option) => /table/i.test(option.file))).toBe(true);
    expect(tables.some((option) => option.file === "coffee_table.glb")).toBe(false);
    for (const id of ["office_chair", "dining_chair", "cutting_table", "office_desk"]) {
      expect(fileFor(id)).not.toMatch(/bmw|uaz|living_room|classroom\.glb/);
    }
  });
});
