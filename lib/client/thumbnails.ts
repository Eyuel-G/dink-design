"use client";

import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SIZE = 192;
const cache = new Map<string, Promise<string | null>>();
let pending: Promise<void> = Promise.resolve();
let renderer: THREE.WebGLRenderer | null = null;
let loader: GLTFLoader | null = null;

/** A small studio render of a library GLB, reused after the first view. */
export function requestThumbnail(file: string): Promise<string | null> {
  const cached = cache.get(file);
  if (cached) return cached;
  const job = new Promise<string | null>((resolve) => {
    pending = pending.catch(() => undefined).then(() => renderFile(file).then(resolve, () => resolve(null)));
  });
  cache.set(file, job);
  return job;
}

function studio(): { renderer: THREE.WebGLRenderer; loader: GLTFLoader } {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  }
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
  }
  return { renderer, loader };
}

function renderFile(file: string): Promise<string | null> {
  const { renderer: view, loader: gltfLoader } = studio();
  const url = `/api/models/file?catalogId=preview&file=${encodeURIComponent(file)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 20000);
    gltfLoader.load(
      url,
      (gltf) => {
        window.clearTimeout(timer);
        try {
          resolve(shot(view, gltf.scene));
        } catch {
          resolve(null);
        } finally {
          dispose(gltf.scene);
        }
      },
      undefined,
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function shot(view: THREE.WebGLRenderer, source: THREE.Object3D): string {
  const root = source;
  root.traverse((node) => {
    if ((node as THREE.Light).isLight) node.visible = false;
  });
  const box = bounds(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  root.position.sub(center);
  const radius = Math.max(size.x, size.y, size.z, 0.2) * 0.5;
  const fov = 32 * (Math.PI / 180);
  const dist = (radius / Math.tan(fov / 2)) * 1.5;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e7e2d8");
  scene.add(root);
  scene.add(new THREE.HemisphereLight("#fff6ea", "#8d8378", 1.35));
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  key.position.set(dist, dist * 1.4, dist);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(32, 1, dist / 100, dist * 12);
  camera.position.set(dist * 0.9, dist * 0.55, dist);
  camera.lookAt(0, 0, 0);
  view.render(scene, camera);
  scene.remove(root);
  return cropToModel(view);
}

/** The authored bounds are often much larger than the visible mesh. Crop to the pixels that are not the studio background. */
function cropToModel(view: THREE.WebGLRenderer): string {
  const gl = view.getContext();
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const bgR = pixels[0] ?? 0;
  const bgG = pixels[1] ?? 0;
  const bgB = pixels[2] ?? 0;
  let minX = SIZE;
  let minY = SIZE;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const index = (y * SIZE + x) * 4;
      const delta = Math.abs(pixels[index]! - bgR) + Math.abs(pixels[index + 1]! - bgG) + Math.abs(pixels[index + 2]! - bgB);
      if (delta < 14) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 8 || height < 8 || width > SIZE * 0.9) return view.domElement.toDataURL("image/jpeg", 0.82);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return view.domElement.toDataURL("image/jpeg", 0.82);
  context.fillStyle = "#e7e2d8";
  context.fillRect(0, 0, SIZE, SIZE);
  const top = SIZE - 1 - maxY;
  const side = Math.max(width, height);
  const scale = (SIZE - 20) / side;
  const destW = width * scale;
  const destH = height * scale;
  context.drawImage(view.domElement, minX, top, width, height, (SIZE - destW) / 2, (SIZE - destH) / 2, destW, destH);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function bounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  let skinned = false;
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    skinned = true;
    mesh.skeleton.update();
    mesh.computeBoundingBox();
    if (!mesh.boundingBox || mesh.boundingBox.isEmpty()) return;
    part.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
    box.union(part);
  });
  if (skinned && !box.isEmpty()) return box;
  return new THREE.Box3().setFromObject(root);
}

function dispose(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
      }
      material.dispose();
    }
  });
}
