import { mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { draco } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const items = JSON.parse(readFileSync(new URL("../catalog/items.json", import.meta.url), "utf8")).filter((item) => item.placeable);
const outDir = path.join(process.cwd(), "public", "catalog");
mkdirSync(outDir, { recursive: true });
mkdirSync(path.join(process.cwd(), "public", "draco"), { recursive: true });
const dracoSrc = path.join(process.cwd(), "node_modules", "three", "examples", "jsm", "libs", "draco", "gltf");
for (const file of ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"]) {
  cpSync(path.join(dracoSrc, file), path.join(process.cwd(), "public", "draco", file));
}

const encoder = await draco3d.createEncoderModule();
const decoder = await draco3d.createDecoderModule();
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  "draco3d.encoder": encoder,
  "draco3d.decoder": decoder,
});

for (const item of items) {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = [];
  const normals = [];
  const indices = [];
  const color = hexToRgb(item.color);
  build(item, (box) => addBox(positions, normals, indices, box));
  const material = document.createMaterial(item.id).setBaseColorFactor([...color, 1]).setMetallicFactor(item.kind === "machine" ? 0.35 : 0.04).setRoughnessFactor(0.72);
  const prim = document
    .createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setArray(new Float32Array(positions)).setType("VEC3").setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor().setArray(new Float32Array(normals)).setType("VEC3").setBuffer(buffer))
    .setIndices(document.createAccessor().setArray(new Uint32Array(indices)).setType("SCALAR").setBuffer(buffer))
    .setMaterial(material);
  const mesh = document.createMesh(item.name).addPrimitive(prim);
  document.createScene().addChild(document.createNode(item.id).setMesh(mesh));
  await document.transform(draco({ method: "edgebreaker" }));
  const file = path.join(outDir, `${item.id}.glb`);
  await io.write(file, document);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" fill="#1c1a17"/><rect x="28" y="28" width="104" height="64" rx="6" fill="${item.color}"/><text x="80" y="66" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#1c1a17">${escapeXml(item.name.slice(0, 22))}</text></svg>`;
  writeFileSync(path.join(outDir, `${item.id}.svg`), svg);
  console.log(item.id, indices.length / 3, "tris");
}

function build(item, add) {
  const w = item.dimW;
  const l = item.dimL;
  const h = item.id === "column_steel" ? 1 : item.dimH;
  if (item.kind === "table") {
    add({ cx: 0, cy: h - 0.03, cz: 0, sx: w, sy: 0.06, sz: l });
    const inset = 0.08;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      add({ cx: sx * (w / 2 - inset), cy: (h - 0.06) / 2, cz: sz * (l / 2 - inset), sx: 0.06, sy: h - 0.06, sz: 0.06 });
    }
    return;
  }
  if (item.kind === "chair") {
    add({ cx: 0, cy: 0.46, cz: 0, sx: w * 0.9, sy: 0.06, sz: l * 0.9 });
    add({ cx: 0, cy: 0.72, cz: -l * 0.38, sx: w * 0.86, sy: 0.46, sz: 0.06 });
    return;
  }
  if (item.kind === "rack") {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      add({ cx: sx * (w / 2 - 0.04), cy: h / 2, cz: sz * (l / 2 - 0.04), sx: 0.05, sy: h, sz: 0.05 });
    }
    for (let i = 1; i <= 4; i += 1) add({ cx: 0, cy: (h * i) / 5, cz: 0, sx: w, sy: 0.03, sz: l });
    return;
  }
  if (item.kind === "bed") {
    add({ cx: 0, cy: 0.16, cz: 0, sx: w, sy: 0.16, sz: l });
    add({ cx: 0, cy: 0.32, cz: 0, sx: w * 0.94, sy: 0.16, sz: l * 0.9 });
    add({ cx: 0, cy: 0.42, cz: -l * 0.42, sx: w, sy: 0.28, sz: 0.08 });
    return;
  }
  if (item.kind === "sofa") {
    add({ cx: 0, cy: 0.28, cz: 0.05, sx: w, sy: 0.32, sz: l * 0.8 });
    add({ cx: 0, cy: 0.55, cz: -l * 0.36, sx: w, sy: 0.4, sz: 0.14 });
    return;
  }
  if (item.kind === "counter") {
    add({ cx: 0, cy: h * 0.42, cz: 0, sx: w, sy: h * 0.84, sz: l });
    add({ cx: 0, cy: h - 0.025, cz: 0, sx: w * 1.02, sy: 0.05, sz: l * 1.02 });
    return;
  }
  if (item.kind === "light") {
    add({ cx: 0, cy: h / 2, cz: 0, sx: w, sy: h, sz: l });
    return;
  }
  add({ cx: 0, cy: h / 2, cz: 0, sx: w, sy: h, sz: l });
  if (item.kind === "machine") add({ cx: 0, cy: h * 0.82, cz: -l * 0.1, sx: w * 0.45, sy: h * 0.28, sz: l * 0.4 });
}

function addBox(positions, normals, indices, box) {
  const { cx, cy, cz, sx, sy, sz } = box;
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces = [
    [1, 0, 0, [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
    [-1, 0, 0, [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]],
    [0, 1, 0, [-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]],
    [0, -1, 0, [-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]],
    [0, 0, 1, [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]],
    [0, 0, -1, [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]],
  ];
  for (const face of faces) {
    const [nx, ny, nz, a, b, c, d] = face;
    const start = positions.length / 3;
    for (const vertex of [a, b, c, d]) {
      positions.push(vertex[0] + cx, vertex[1] + cy, vertex[2] + cz);
      normals.push(nx, ny, nz);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255];
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}
