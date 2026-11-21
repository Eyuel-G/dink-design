import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";

const MAP = {
  light_highbay: "hanging_industrial_lamp",
  fan_exhaust: "ceiling_fan",
  shelf_industrial: "steel_frame_shelves_01",
  pallet_rack: "steel_frame_shelves_02",
  gondola: "steel_frame_shelves_03",
  fabric_rack: "worn_metal_rack",
  display_counter: "wooden_display_shelves_01",
  office_desk: "metal_office_desk",
  teacher_desk: "WoodenTable_02",
  office_chair: "modern_arm_chair_01",
  dining_chair: "dining_chair_02",
  student_desk: "SchoolDesk_01",
  dining_table: "dining_table",
  cutting_table: "WoodenTable_01",
  cutting_table_compact: "small_wooden_table_01",
  worktable_steel: "industrial_storage_cart",
  packing_table: "painted_wooden_table",
  ironing_station: "small_wooden_table_01",
  sofa: "Sofa_01",
  bed_double: "GothicBed_01",
  wardrobe: "painted_wooden_cabinet",
  file_cabinet: "drawer_cabinet",
  reception_desk: "ClassicConsole_01",
  pos_counter: "CoffeeCart_01",
  kitchen_counter: "painted_wooden_cabinet_02",
  proofer: "chinese_cabinet",
  oven_compact: "electric_stove",
  oven_deck: "electric_stove",
};

const catalog = JSON.parse(readFileSync(new URL("../catalog/items.json", import.meta.url), "utf8"));
const byId = new Map(catalog.map((item) => [item.id, item]));
const index = await fetch("https://api.polyhaven.com/assets?t=models").then((response) => response.json());
const cache = "/tmp/ph-cache";
const outDir = path.join(process.cwd(), "public", "catalog");
mkdirSync(cache, { recursive: true });
const io = new NodeIO();
const sources = {};
const unique = [...new Set(Object.values(MAP))];

for (const assetId of unique) {
  const folder = path.join(cache, assetId);
  const marker = path.join(folder, ".ok");
  if (!exists(marker)) {
    mkdirSync(folder, { recursive: true });
    const files = await fetch(`https://api.polyhaven.com/files/${assetId}`).then((response) => response.json());
    const gltf = files.gltf["1k"].gltf;
    const gltfName = path.basename(new URL(gltf.url).pathname);
    await download(gltf.url, path.join(folder, gltfName));
    for (const [relative, file] of Object.entries(gltf.include)) {
      const dest = path.join(folder, relative);
      mkdirSync(path.dirname(dest), { recursive: true });
      await download(file.url, dest);
    }
    writeFileSync(marker, gltfName);
    console.log("downloaded", assetId);
  }
}

for (const [catalogId, assetId] of Object.entries(MAP)) {
  const item = byId.get(catalogId);
  const folder = path.join(cache, assetId);
  const gltfName = readFileSync(path.join(folder, ".ok"), "utf8").trim();
  const document = await io.read(path.join(folder, gltfName));
  for (const material of document.getRoot().listMaterials()) {
    material.setNormalTexture(null);
    material.setOcclusionTexture(null);
    material.setMetallicRoughnessTexture(null);
    material.setEmissiveTexture(null);
    material.setMetallicFactor(0);
    material.setRoughnessFactor(0.7);
  }
  await document.transform(prune());
  const targetH = catalogId === "column_steel" ? 1 : item.dimH;
  fit(document, item.dimW, item.dimL, targetH);
  const file = path.join(outDir, `${catalogId}.glb`);
  await io.write(file, document);
  const meta = index[assetId];
  const author = Object.keys(meta?.authors ?? {}).join(", ") || "Poly Haven";
  sources[catalogId] = {
    name: meta?.name ?? assetId,
    author,
    href: `https://polyhaven.com/a/${assetId}`,
  };
  console.log("fit", catalogId, "from", assetId);
}

writeFileSync(new URL("../catalog/model-sources.json", import.meta.url), JSON.stringify(sources, null, 2) + "\n");

function fit(document, width, length, height) {
  const scene = document.getRoot().listScenes()[0];
  const box = getBounds(scene);
  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const scale = Math.min(width / size[0], height / size[1], length / size[2]);
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = box.min[1];
  const cz = (box.min[2] + box.max[2]) / 2;
  const wrapper = document.createNode("fit");
  for (const child of [...scene.listChildren()]) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  wrapper.setScale([scale, scale, scale]);
  wrapper.setTranslation([-cx * scale, -cy * scale, -cz * scale]);
  scene.addChild(wrapper);
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

function exists(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}
