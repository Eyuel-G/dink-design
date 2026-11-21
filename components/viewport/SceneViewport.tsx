"use client";

import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useGLTF } from "@react-three/drei";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { getCatalogItem } from "@/lib/catalog";
import { curtainAxes, fitScale, type FitMode } from "@/lib/layout/fit";
import { formatMoney } from "@/lib/format";
import { seatCurtains, type PlacedObject } from "@/lib/layout/place";
import { wallPieces, type WallPiece } from "@/lib/layout/walls";
import type { Nudge } from "@/lib/client/store";
import type { BuildingSpec, CatalogItem } from "@/lib/schemas";
import { clamp, r3 } from "@/lib/num";
import { marketplaceHref } from "@/components/prices/PriceLink";
import { useDink } from "@/lib/client/store";
import type { CameraMode } from "@/lib/client/types";

function present(objects: PlacedObject[], spec: BuildingSpec, nudges: Record<string, Nudge>) {
  return seatCurtains(objects, spec).map((object) => {
    const nudge = nudges[object.id];
    if (!nudge) return object;
    return {
      ...object,
      x: nudge.x,
      z: nudge.z,
      rotationY: nudge.rotationY,
      w: nudge.w ?? object.w,
      l: nudge.l ?? object.l,
      h: nudge.h ?? object.h,
      tint: nudge.tint ?? object.tint,
    };
  });
}

const WALL: Record<string, string> = { concrete: "#d9d2c6", clay: "#e6cbb8", ink: "#cfd4dc", sage: "#d2dbd0", sand: "#ead7b8" };
const FLOOR: Record<string, string> = { concrete: "#b7b1a6", tile: "#d7c2a6", epoxy: "#9eaea4", wood: "#a56b3c" };

class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function SceneViewport() {
  const view = useDink((state) => state.view);
  const nudges = useDink((state) => state.nudges);
  const mode = useDink((state) => state.cameraMode);
  const spec = view?.spec;
  const day = (view?.settings.dayNight ?? "day") === "day";
  const objects = view?.spec && view.layout ? present(view.layout.objects, view.spec, nudges) : undefined;
  return (
    <div className="relative h-full min-h-[280px] w-full bg-[#1a1916]">
      <Canvas
        shadows={false}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => useDink.getState().select(null)}
      >
        <color attach="background" args={[day ? "#c5d0d8" : "#10141c"]} />
        <Suspense fallback={null}>
          {spec ? <Room rigMode={mode} /> : <EmptyGround />}
        </Suspense>
      </Canvas>
      {objects ? <HandleLayer objects={objects} /> : null}
      <MiniMap />
      {mode === "walk" ? <WalkHint /> : null}
    </div>
  );
}

function EmptyGround() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#2a2622" />
      </mesh>
      <Html center position={[0, 1, 0]}>
        <p className="w-56 text-center text-sm text-[#f4efe6]">Describe a room in the chat. The model appears here.</p>
      </Html>
    </>
  );
}

function Room({ rigMode }: { rigMode: CameraMode }) {
  const view = useDink((s) => s.view);
  const nudges = useDink((s) => s.nudges);
  const spec = view?.spec;
  const layout = view?.layout;
  if (!spec || !layout || !view) return null;
  const objects = present(layout.objects, spec, nudges);
  const hidden = rigMode === "cutaway" ? "north" : null;
  const pieces = wallPieces(spec.room, spec.openings, hidden);
  const showRoof = rigMode !== "cutaway";
  const day = view.settings.dayNight === "day";
  const dragging = useDink((state) => state.dragging);
  const wallColor = spec.style.wallColor || WALL[spec.style.palette] || WALL.concrete;
  const floorColor = spec.style.floorColor || FLOOR[spec.room.floorType] || FLOOR.concrete;
  const pickFinish = (id: "__wall" | "__floor") => {
    useDink.getState().select(id);
    useDink.getState().setPanel("properties");
  };
  return (
    <>
      <RoomLights day={day} />
      <EnvironmentRig />
      <PerspectiveCamera makeDefault={rigMode !== "plan"} fov={42} near={0.05} far={400} position={[spec.room.width * -0.2, spec.room.height * 1.8, spec.room.length * 1.2]} />
      <OrthographicCamera makeDefault={rigMode === "plan"} near={0.1} far={300} position={[spec.room.width / 2, 80, spec.room.length / 2]} zoom={18} />
      <CameraRig mode={rigMode} width={spec.room.width} length={spec.room.length} height={spec.room.height} />
      <ToolCamera />
      <HandleTracker objects={objects} />
      {rigMode === "orbit" || rigMode === "cutaway" ? (
        <OrbitControls enabled={!dragging} makeDefault enableDamping target={[spec.room.width / 2, spec.room.height * 0.3, spec.room.length / 2]} maxPolarAngle={Math.PI / 2.05} />
      ) : null}
      {rigMode === "walk" ? <Walk roomWidth={spec.room.width} roomLength={spec.room.length} obstacles={objects} /> : null}
      {rigMode === "plan" ? <Grid args={[spec.room.width, spec.room.length]} position={[spec.room.width / 2, 0.02, spec.room.length / 2]} cellSize={1} sectionSize={5} cellColor="#8a8175" sectionColor="#e08a4f" infiniteGrid={false} /> : null}
      {spec.style.wallMap && spec.style.floorMap ? (
        <Suspense fallback={null}>
          <AssetFinishes
            wallFile={spec.style.wallMap}
            floorFile={spec.style.floorMap}
            wallColor={wallColor}
            floorColor={floorColor}
            width={spec.room.width}
            length={spec.room.length}
            pieces={pieces}
            onWall={() => pickFinish("__wall")}
            onFloor={() => pickFinish("__floor")}
          />
        </Suspense>
      ) : (
        <>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[spec.room.width / 2, 0, spec.room.length / 2]}
            receiveShadow
            onClick={(event) => {
              event.stopPropagation();
              pickFinish("__floor");
            }}
          >
            <planeGeometry args={[spec.room.width, spec.room.length]} />
            <meshStandardMaterial color={floorColor} roughness={0.9} />
          </mesh>
          {pieces.map((piece) => (
            <mesh
              key={piece.id}
              position={[piece.x, piece.y, piece.z]}
              onClick={(event) => {
                if (piece.role === "door" || piece.role === "glass") return;
                event.stopPropagation();
                pickFinish("__wall");
              }}
            >
              <boxGeometry args={[piece.sx, piece.sy, piece.sz]} />
              <meshStandardMaterial
                color={piece.role === "glass" ? "#9fd4e8" : piece.role === "door" ? "#6d5844" : wallColor}
                transparent={piece.role === "glass"}
                opacity={piece.role === "glass" ? 0.35 : 1}
                roughness={0.86}
              />
            </mesh>
          ))}
        </>
      )}
      {showRoof ? (
        <mesh position={[spec.room.width / 2, spec.room.height + 0.04, spec.room.length / 2]}>
          <boxGeometry args={[spec.room.width + 0.6, 0.08, spec.room.length + 0.6]} />
          <meshStandardMaterial color={spec.style.roof === "slab" ? "#c8c2b8" : "#8e98a0"} roughness={0.7} metalness={spec.style.roof === "sheet" ? 0.35 : 0} />
        </mesh>
      ) : null}
      <DragSurface objects={objects} width={spec.room.width} length={spec.room.length} enabled={rigMode !== "walk" && !view.project.readOnly} />
      <CatalogGroups objects={objects} />
      <Labels objects={objects} />
    </>
  );
}

function finishUrl(file: string): string {
  return `/api/models/file?catalogId=preview&file=${encodeURIComponent(file)}`;
}

/** Keep the asset's pattern, and shift its color toward the reference photo. */
function recolorMap(source: THREE.Texture, hex: string, contrast = 0.95): THREE.Texture {
  const image = source.image as CanvasImageSource & { width?: number; height?: number };
  const width = image.width || 512;
  const height = image.height || 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const next = source.clone();
  if (!ctx) return next;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  const tint = new THREE.Color(hex);
  const data = pixels.data;
  let mean = 0.5;
  if (contrast > 2) {
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
    mean = sum / (data.length / 4) / 255;
  }
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / 255;
    const shade = contrast > 2 ? 0.9 + (lum - mean) * contrast : 0.78 + (lum - 0.5) * contrast;
    data[i] = Math.max(0, Math.min(255, tint.r * 255 * shade));
    data[i + 1] = Math.max(0, Math.min(255, tint.g * 255 * shade));
    data[i + 2] = Math.max(0, Math.min(255, tint.b * 255 * shade));
  }
  ctx.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return map;
}

function firstMap(root: THREE.Object3D): THREE.Texture | null {
  let found: THREE.Texture | null = null;
  root.traverse((node) => {
    if (found) return;
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    if (material?.map) found = material.map;
  });
  return found;
}

function PatternMaterial({ map, repeat, roughness }: { map: THREE.Texture; repeat: [number, number]; roughness: number }) {
  const copy = useMemo(() => {
    const texture = map.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(1, repeat[0]), Math.max(1, repeat[1]));
    texture.needsUpdate = true;
    return texture;
  }, [map, repeat[0], repeat[1]]);
  return <meshStandardMaterial map={copy} color="#ffffff" roughness={roughness} />;
}

function AssetFinishes({
  wallFile,
  floorFile,
  wallColor,
  floorColor,
  width,
  length,
  pieces,
  onWall,
  onFloor,
}: {
  wallFile: string;
  floorFile: string;
  wallColor: string;
  floorColor: string;
  width: number;
  length: number;
  pieces: WallPiece[];
  onWall: () => void;
  onFloor: () => void;
}) {
  const wallGltf = useGLTF(finishUrl(wallFile), "/draco/");
  const floorGltf = useGLTF(finishUrl(floorFile), "/draco/");
  const wallMap = useMemo(() => {
    const map = firstMap(wallGltf.scene);
    return map ? recolorMap(map, wallColor, 7) : null;
  }, [wallGltf, wallColor]);
  const floorMap = useMemo(() => {
    const map = firstMap(floorGltf.scene);
    return map ? recolorMap(map, floorColor) : null;
  }, [floorGltf, floorColor]);
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[width / 2, 0, length / 2]}
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          onFloor();
        }}
      >
        <planeGeometry args={[width, length]} />
        {floorMap ? <PatternMaterial map={floorMap} repeat={[width / 1.1, length / 1.1]} roughness={0.62} /> : <meshStandardMaterial color={floorColor} roughness={0.62} />}
      </mesh>
      {pieces.map((piece) => {
        const plain = piece.role === "glass" || piece.role === "door";
        const span = Math.max(piece.sx, piece.sz);
        return (
          <mesh
            key={piece.id}
            position={[piece.x, piece.y, piece.z]}
            onClick={(event) => {
              if (plain) return;
              event.stopPropagation();
              onWall();
            }}
          >
            <boxGeometry args={[piece.sx, piece.sy, piece.sz]} />
            {plain || !wallMap ? (
              <meshStandardMaterial color={piece.role === "glass" ? "#b7d7e4" : piece.role === "door" ? "#c4a06a" : wallColor} transparent={piece.role === "glass"} opacity={piece.role === "glass" ? 0.45 : 1} roughness={0.8} />
            ) : (
              <PatternMaterial map={wallMap} repeat={[span / 1.7, piece.sy / 0.85]} roughness={0.72} />
            )}
          </mesh>
        );
      })}
    </>
  );
}

function RoomLights({ day }: { day: boolean }) {
  return (
    <>
      <ambientLight intensity={day ? 0.55 : 0.08} />
      <directionalLight position={[12, 24, 8]} intensity={day ? 1.35 : 0.15} color={day ? "#fff4e5" : "#9eb4d6"} />
      <hemisphereLight args={[day ? "#f2efe6" : "#223", day ? "#8d7b66" : "#111", day ? 0.35 : 0.2]} />
      {day ? null : <pointLight position={[4, 2.4, 4]} intensity={8} distance={18} color="#e08a4f" />}
    </>
  );
}

function EnvironmentRig() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = new RoomEnvironment();
    const target = pmrem.fromScene(env, 0.04);
    scene.environment = target.texture;
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function CameraRig({ mode, width, length, height }: { mode: CameraMode; width: number; length: number; height: number }) {
  const { camera } = useThree();
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const focus = useDink((state) => state.focus);
  const recall = useDink((state) => state.recall);
  const seen = useRef("");
  useLayoutEffect(() => {
    const key = `${mode}:${width}:${length}`;
    if (seen.current === key) return;
    seen.current = key;
    if (mode === "plan") {
      camera.up.set(0, 0, -1);
      camera.position.set(width / 2, 80, length / 2);
      camera.lookAt(width / 2, 0, length / 2);
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const ortho = camera as THREE.OrthographicCamera;
        const span = Math.max(width, length) * 0.62;
        ortho.top = span;
        ortho.bottom = -span;
        ortho.left = -span;
        ortho.right = span;
        ortho.updateProjectionMatrix();
      }
      return;
    }
    camera.up.set(0, 1, 0);
    if (mode === "walk") {
      camera.position.set(clamp(1.4, 0.4, width - 0.4), 1.7, clamp(1.4, 0.4, length - 0.4));
    }
  }, [camera, mode, width, length, height]);
  useFrame(() => {
    if (recall && mode !== "walk") {
      camera.position.lerp(new THREE.Vector3(...recall.position), 0.12);
      controls?.target.lerp(new THREE.Vector3(...recall.target), 0.12);
    } else if (focus && (mode === "orbit" || mode === "cutaway") && controls) {
      controls.target.lerp(new THREE.Vector3(focus[0], focus[1], focus[2]), 0.08);
      const desired = new THREE.Vector3(focus[0] + 3.2, focus[1] + 2.4, focus[2] + 3.2);
      camera.position.lerp(desired, 0.06);
    }
    const now = performance.now();
    if (now - poseStamp.current > 200) {
      poseStamp.current = now;
      const target = controls?.target ?? new THREE.Vector3(width / 2, 1, length / 2);
      useDink.getState().setPose({
        position: [r3(camera.position.x), r3(camera.position.y), r3(camera.position.z)],
        target: [r3(target.x), r3(target.y), r3(target.z)],
      });
    }
  });
  return null;
}

const poseStamp = { current: 0 };

function Walk({ roomWidth, roomLength, obstacles }: { roomWidth: number; roomLength: number; obstacles: PlacedObject[] }) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const look = useRef({ yaw: Math.PI, pitch: 0 });
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      keys.current[event.key.toLowerCase()] = true;
    };
    const up = (event: KeyboardEvent) => {
      keys.current[event.key.toLowerCase()] = false;
    };
    const move = (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      look.current.yaw -= event.movementX * 0.0022;
      look.current.pitch = clamp(look.current.pitch - event.movementY * 0.0022, -1.05, 1.05);
    };
    const click = () => {
      if (useDink.getState().dragging) return;
      if (document.pointerLockElement !== gl.domElement) void gl.domElement.requestPointerLock();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("mousemove", move);
    gl.domElement.addEventListener("click", click);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("mousemove", move);
      gl.domElement.removeEventListener("click", click);
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock();
    };
  }, [gl]);
  useFrame((_, delta) => {
    if (useDink.getState().dragging) {
      camera.position.y = 1.7;
      camera.rotation.order = "YXZ";
      camera.rotation.y = look.current.yaw;
      camera.rotation.x = look.current.pitch;
      return;
    }
    const step = 3.1 * Math.min(delta, 0.05);
    const direction = new THREE.Vector3((keys.current.d ? 1 : 0) - (keys.current.a ? 1 : 0), 0, (keys.current.s ? 1 : 0) - (keys.current.w ? 1 : 0));
    if (direction.lengthSq() > 0) {
      direction.normalize().applyEuler(new THREE.Euler(0, look.current.yaw, 0, "YXZ"));
      camera.position.addScaledVector(direction, step);
    }
    const inset = 0.28;
    camera.position.x = clamp(camera.position.x, inset, roomWidth - inset);
    camera.position.z = clamp(camera.position.z, inset, roomLength - inset);
    for (const object of obstacles) {
      if (object.mount === "ceiling" || object.h < 0.4) continue;
      const dx = camera.position.x - object.x;
      const dz = camera.position.z - object.z;
      const reach = Math.max(object.w, object.l) * 0.45 + 0.15;
      const dist = Math.hypot(dx, dz);
      if (dist < reach && dist > 0.001) {
        camera.position.x = object.x + (dx / dist) * reach;
        camera.position.z = object.z + (dz / dist) * reach;
      }
    }
    camera.position.x = clamp(camera.position.x, inset, roomWidth - inset);
    camera.position.z = clamp(camera.position.z, inset, roomLength - inset);
    camera.position.y = 1.7;
    camera.rotation.order = "YXZ";
    camera.rotation.y = look.current.yaw;
    camera.rotation.x = look.current.pitch;
  });
  return null;
}

function CatalogGroups({ objects }: { objects: PlacedObject[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, PlacedObject[]>();
    for (const object of objects) {
      const list = map.get(object.catalogId) ?? [];
      list.push(object);
      map.set(object.catalogId, list);
    }
    return [...map.entries()];
  }, [objects]);
  return (
    <>
      {groups.map(([catalogId, group]) => (
        <ModelBoundary key={catalogId} fallback={<Procedural objects={group} />}>
          <Suspense fallback={<Procedural objects={group} />}>
            <InstancedCatalog catalogId={catalogId} objects={group} />
          </Suspense>
        </ModelBoundary>
      ))}
      <Selection objects={objects} />
    </>
  );
}

function itemFor(catalogId: string, objects: PlacedObject[]): CatalogItem | undefined {
  const known = getCatalogItem(catalogId);
  if (known) return known;
  const object = objects[0];
  if (!object) return undefined;
  return {
    id: catalogId,
    name: object.name,
    category: "furniture",
    group: "interior",
    tags: ["uploaded"],
    dimW: Math.max(0.15, object.w),
    dimL: Math.max(0.05, object.l),
    dimH: Math.max(0.15, object.h),
    unit: "unit",
    basePriceEtb: 0,
    glbPath: null,
    queryEn: object.name,
    queryAm: "",
    color: object.color,
    kind: object.kind,
    placeable: true,
    mount: object.mount,
    cheaperId: null,
  };
}

function InstancedCatalog({ catalogId, objects }: { catalogId: string; objects: PlacedObject[] }) {
  const item = itemFor(catalogId, objects);
  const linked = useDink((state) => state.view?.models?.[catalogId]?.url);
  const url = linked || item?.glbPath;
  if (!item || !url) return <Procedural objects={objects} />;
  return <GlbInstances url={url} item={item} objects={objects} />;
}

function GlbInstances({ url, item, objects }: { url: string; item: NonNullable<ReturnType<typeof getCatalogItem>>; objects: PlacedObject[] }) {
  const gltf = useGLTF(url, "/draco/");
  const measured = url.startsWith("/api/models/");
  return (
    <>
      {objects.map((object) => (
        <CatalogModel key={object.id} gltf={gltf} item={item} object={object} measured={measured} />
      ))}
    </>
  );
}

function hasSkinnedMesh(source: THREE.Object3D) {
  let skinned = false;
  source.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return skinned;
}

/** A skinned curtain shares its bones across clones unless the skeleton is copied. The posed cloth, not the bind-pose box, is what has to cover the window. */
function posedBox(root: THREE.Object3D): THREE.Box3 | null {
  if (!hasSkinnedMesh(root)) return null;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    mesh.computeBoundingBox();
    if (!mesh.boundingBox || mesh.boundingBox.isEmpty()) return;
    part.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
    box.union(part);
  });
  return box.isEmpty() ? null : box;
}

/** Library models are not authored in room meters. Scale each one onto its placed size. Columns keep a readable thickness and run from the floor to the roof. */
function fitMeasured(source: THREE.Object3D, w: number, h: number, l: number, mode: FitMode) {
  const clone = (hasSkinnedMesh(source) ? cloneSkeleton(source) : source.clone(true)) as THREE.Object3D;
  clone.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = list.map((material) => material.clone());
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
  const holder = new THREE.Group();
  holder.add(clone);
  let box = posedBox(holder) ?? new THREE.Box3().setFromObject(holder);
  let size = box.getSize(new THREE.Vector3());
  if (mode === "curtain") {
    const axes = curtainAxes(size);
    const unit = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const basis = new THREE.Matrix4().makeBasis(unit[axes.width], unit[axes.height], unit[axes.depth]);
    basis.invert();
    holder.applyMatrix4(basis);
    holder.updateMatrixWorld(true);
    box = posedBox(holder) ?? new THREE.Box3().setFromObject(holder);
    size = box.getSize(new THREE.Vector3());
  }
  const center = box.getCenter(new THREE.Vector3());
  holder.position.set(-center.x, -box.min.y, -center.z);
  const fitted = new THREE.Group();
  fitted.add(holder);
  const scale = fitScale(size, { w, h, l }, mode);
  fitted.scale.set(scale.x, scale.y, scale.z);
  return fitted;
}

function modelMode(item: { id: string; kind: string }): FitMode {
  if (item.kind === "curtain" || item.id.includes("curtain")) return "curtain";
  return item.kind === "column" || item.id.includes("column") ? "column" : "box";
}

function CatalogModel({
  gltf,
  item,
  object,
  measured,
}: {
  gltf: { scene: THREE.Group };
  item: NonNullable<ReturnType<typeof getCatalogItem>>;
  object: PlacedObject;
  measured: boolean;
}) {
  const heat = useDink((state) => state.heat);
  const cost = useDink((state) => state.view?.cost);
  const sewing = measured && item.id.startsWith("sewing");
  const tableH = Math.min(0.75, Math.max(0.55, object.h * 0.68));
  const machineH = Math.max(0.2, object.h - tableH);
  const scene = useMemo(() => {
    if (!measured) return gltf.scene.clone(true);
    if (sewing) return fitMeasured(gltf.scene, object.w * 0.38, machineH, object.l * 0.42, "box");
    return fitMeasured(gltf.scene, object.w, object.h, object.l, modelMode(item));
  }, [gltf, measured, sewing, item, object.w, object.h, object.l, machineH]);
  useLayoutEffect(() => {
    tintScene(scene, object.tint ?? null, heat ? heatColor(object.id, cost?.total ?? 1, cost) : null);
  }, [scene, heat, cost, object.id, object.tint]);
  return (
    <group
      position={[object.x, object.y, object.z]}
      rotation={[0, object.rotationY, 0]}
      scale={measured ? [1, 1, 1] : [object.w / item.dimW, object.h / (item.id === "column_steel" ? 1 : item.dimH), object.l / item.dimL]}
      onClick={(event) => {
        event.stopPropagation();
        useDink.getState().select(object.id);
        useDink.getState().setPanel("properties");
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        holdHover(object.id);
      }}
      onPointerOut={releaseHover}
    >
      {sewing ? <SewingTable w={object.w} h={tableH} l={object.l} tint={object.tint} /> : null}
      <primitive object={scene} position={[0, sewing ? tableH : 0, 0]} />
    </group>
  );
}

function tintScene(scene: THREE.Object3D, tint: string | null, heat: string | null) {
  const paint = tint ? new THREE.Color(tint) : null;
  const glow = heat ? new THREE.Color(heat) : null;
  scene.traverse((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.userData.baseColor) standard.userData.baseColor = standard.color.clone();
      if (standard.map && !standard.userData.baseMap) standard.userData.baseMap = standard.map;
      const base = standard.userData.baseColor as THREE.Color;
      const baseMap = standard.userData.baseMap as THREE.Texture | undefined;
      if (paint && baseMap) {
        const key = paint.getHexString();
        if (standard.userData.tintKey !== key) {
          standard.userData.tintKey = key;
          standard.userData.tintMap = recolorMap(baseMap, `#${key}`);
        }
        standard.map = standard.userData.tintMap as THREE.Texture;
        standard.color.set("#ffffff");
        if (standard.metalness > 0.35) standard.metalness = 0.12;
      } else {
        if (baseMap) standard.map = baseMap;
        standard.color.copy(paint ?? base);
      }
      if (!standard.emissive) continue;
      standard.emissive.copy(glow ?? new THREE.Color("#000000"));
      standard.emissiveIntensity = glow ? 0.45 : 0;
    }
  });
}

function SewingTable({ w, h, l, tint }: { w: number; h: number; l: number; tint?: string }) {
  const top = Math.min(0.05, Math.max(0.03, h * 0.08));
  const leg = Math.min(0.06, Math.max(0.04, w * 0.06));
  const legH = Math.max(0.2, h - top);
  const insetX = Math.max(leg, w / 2 - leg * 1.4);
  const insetZ = Math.max(leg, l / 2 - leg * 1.4);
  const topColor = tint || "#d8c4a4";
  const legColor = tint || "#8d735c";
  const feet: [number, number][] = [
    [-insetX, -insetZ],
    [insetX, -insetZ],
    [-insetX, insetZ],
    [insetX, insetZ],
  ];
  return (
    <group>
      <mesh position={[0, legH + top / 2, 0]}>
        <boxGeometry args={[w, top, l]} />
        <meshStandardMaterial color={topColor} roughness={0.55} />
      </mesh>
      {feet.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, legH / 2, z]}>
          <boxGeometry args={[leg, legH, leg]} />
          <meshStandardMaterial color={legColor} roughness={0.72} />
        </mesh>
      ))}
    </group>
  );
}

function Procedural({ objects }: { objects: PlacedObject[] }) {
  const heat = useDink((state) => state.heat);
  const cost = useDink((state) => state.view?.cost);
  return (
    <>
      {objects.map((object) => (
        <mesh
          key={object.id}
          position={[object.x, object.y + object.h / 2, object.z]}
          rotation={[0, object.rotationY, 0]}
          onClick={(event) => {
            event.stopPropagation();
            useDink.getState().select(object.id);
            useDink.getState().setPanel("properties");
          }}
          onPointerOver={() => holdHover(object.id)}
          onPointerOut={releaseHover}
        >
          <boxGeometry args={[object.w, object.h, object.l]} />
          <meshStandardMaterial color={heat ? heatColor(object.id, cost?.total ?? 1, cost) : object.tint || object.color} roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

function Selection({ objects }: { objects: PlacedObject[] }) {
  const selectedId = useDink((state) => state.selectedId);
  const object = objects.find((item) => item.id === selectedId);
  if (!object) return null;
  return (
    <mesh position={[object.x, object.y + object.h / 2, object.z]} rotation={[0, object.rotationY, 0]}>
      <boxGeometry args={[object.w + 0.06, object.h + 0.06, object.l + 0.06]} />
      <meshBasicMaterial color="#e08a4f" wireframe />
    </mesh>
  );
}

const drag = {
  id: "",
  x: 0,
  z: 0,
  rotationY: 0,
  w: 0,
  l: 0,
  h: 0,
  baseW: 0,
  baseL: 0,
  baseH: 0,
  color: undefined as string | undefined,
  moved: false,
  mode: "move" as "move" | "rotate" | "resize",
  axis: "x" as "x" | "y" | "z",
  lastX: 0,
  originX: 0,
};
const floorRay = new THREE.Raycaster();
const floorNdc = new THREE.Vector2();
let toolCamera: THREE.Camera | null = null;
let toolCanvas: HTMLCanvasElement | null = null;
let hoverTimer = 0;

function ToolCamera() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    toolCamera = camera;
    toolCanvas = gl.domElement;
    return () => {
      if (toolCamera === camera) toolCamera = null;
    };
  }, [camera, gl]);
  return null;
}

function holdHover(id: string) {
  window.clearTimeout(hoverTimer);
  useDink.getState().hover(id);
}

function releaseHover() {
  window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    if (!drag.id) useDink.getState().hover(null);
  }, 350);
}

function pointOnFloor(origin: THREE.Vector3, direction: THREE.Vector3) {
  if (Math.abs(direction.y) < 1e-5) return null;
  const t = -origin.y / direction.y;
  if (t < 0) return null;
  return { x: origin.x + direction.x * t, z: origin.z + direction.z * t };
}

function updateDrag(x: number, z: number) {
  const room = useDink.getState().view?.spec?.room;
  if (!room || !drag.id) return;
  drag.x = r3(clamp(Math.round(x / 0.05) * 0.05, 0.15, room.width - 0.15));
  drag.z = r3(clamp(Math.round(z / 0.05) * 0.05, 0.15, room.length - 0.15));
  drag.moved = true;
  useDink.getState().nudge(drag.id, { x: drag.x, z: drag.z, rotationY: drag.rotationY, w: drag.w, l: drag.l, h: drag.h, tint: drag.color });
}

function floorFromClient(clientX: number, clientY: number) {
  if (!toolCamera || !toolCanvas) return null;
  const rect = toolCanvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  floorNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  floorNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  floorRay.setFromCamera(floorNdc, toolCamera);
  return pointOnFloor(floorRay.ray.origin, floorRay.ray.direction);
}

function finishDrag() {
  document.body.style.cursor = "";
  useDink.getState().setDragging(false);
  if (!drag.id || !drag.moved) {
    drag.id = "";
    return;
  }
  const body = {
    objectId: drag.id,
    x: drag.x,
    z: drag.z,
    rotationY: drag.rotationY,
    ...(drag.mode === "resize" ? { w: drag.w, l: drag.l, h: drag.h } : {}),
    ...(drag.color ? { color: drag.color } : {}),
  };
  drag.id = "";
  const projectId = useDink.getState().view?.project.id;
  if (!projectId) return;
  void fetch(`/api/projects/${projectId}/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        useDink.getState().clearNudges();
        const { toast } = await import("sonner");
        toast.error((data as { error?: string }).error || "That spot is outside the room.");
        return;
      }
      useDink.getState().hydrate(data);
    })
    .catch(() => useDink.getState().clearNudges());
}

function beginTool(object: PlacedObject, mode: "move" | "rotate" | "resize", event: { clientX: number; stopPropagation: () => void; preventDefault: () => void }, axis: "x" | "y" | "z" = "x") {
  event.stopPropagation();
  event.preventDefault();
  const state = useDink.getState();
  if (state.view?.project.readOnly) return;
  if (document.pointerLockElement) document.exitPointerLock();
  state.select(object.id);
  state.setDragging(true);
  drag.id = object.id;
  drag.x = object.x;
  drag.z = object.z;
  drag.rotationY = object.rotationY;
  drag.w = object.w;
  drag.l = object.l;
  drag.h = object.h;
  drag.baseW = object.w;
  drag.baseL = object.l;
  drag.baseH = object.h;
  drag.color = object.tint;
  drag.moved = false;
  drag.mode = mode;
  drag.axis = axis;
  drag.lastX = event.clientX;
  drag.originX = event.clientX;
  document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
  const onMove = (ev: PointerEvent) => {
    if (!drag.id) return;
    if (drag.mode === "rotate") {
      const dx = ev.clientX - drag.lastX;
      drag.lastX = ev.clientX;
      if (dx === 0) return;
      drag.rotationY = r3(drag.rotationY + dx * 0.012);
      drag.moved = true;
      useDink.getState().nudge(drag.id, { x: drag.x, z: drag.z, rotationY: drag.rotationY, w: drag.w, l: drag.l, h: drag.h, tint: drag.color });
      return;
    }
    if (drag.mode === "resize") {
      const factor = clamp(1 + (ev.clientX - drag.originX) * 0.004, 0.4, 3);
      if (drag.axis === "x") drag.w = r3(clamp(drag.baseW * factor, 0.15, 40));
      if (drag.axis === "z") drag.l = r3(clamp(drag.baseL * factor, 0.05, 40));
      if (drag.axis === "y") drag.h = r3(clamp(drag.baseH * factor, 0.15, 12));
      drag.moved = true;
      useDink.getState().nudge(drag.id, { x: drag.x, z: drag.z, rotationY: drag.rotationY, w: drag.w, l: drag.l, h: drag.h, tint: drag.color });
      return;
    }
    const hit = floorFromClient(ev.clientX, ev.clientY);
    if (hit) updateDrag(hit.x, hit.z);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    finishDrag();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function DragSurface({ width, length, enabled }: { objects: PlacedObject[]; width: number; length: number; enabled: boolean }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[width / 2, 0.02, length / 2]}
      onPointerMove={(event) => {
        if (!enabled || !drag.id) return;
        updateDrag(event.point.x, event.point.z);
      }}
    >
      <planeGeometry args={[width, length]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Labels({ objects }: { objects: PlacedObject[] }) {
  const show = useDink((state) => state.showPrices);
  const selected = useDink((state) => state.selectedId);
  const hovered = useDink((state) => state.hoveredId);
  const mode = useDink((state) => state.cameraMode);
  if (mode === "plan") return null;
  const visible = objects.filter((object) => show || object.id === selected);
  return (
    <>
      {visible.map((object) => (
        <ObjectLabel key={object.id} object={object} />
      ))}
      {objects.map((object) => (
        <ReferenceCard key={`ref-${object.id}`} object={object} active={object.id === selected || object.id === hovered} />
      ))}
    </>
  );
}

function ObjectLabel({ object }: { object: PlacedObject }) {
  const view = useDink((state) => state.view);
  if (!view?.cost || !view.settings) return null;
  const quote = view.quotes[object.catalogId];
  const pin = view.spec?.pins?.[object.id];
  const price = pin?.price ?? quote?.unitPrice ?? getCatalogItem(object.catalogId)?.basePriceEtb ?? 0;
  const kind = pin ? "Pinned" : quote?.kind === "marketplace" ? quote.sourceName || "Marketplace" : "Estimate";
  const href = pin?.url && quote?.sourceBaseUrl ? marketplaceHref(pin.url, pin.price, quote.sourceBaseUrl) : quote?.kind === "marketplace" ? marketplaceHref(quote.url, quote.unitPrice, quote.sourceBaseUrl) : null;
  const label = formatMoney(price, view.settings.currency, view.settings.usdEtbRate);
  return (
    <Html position={[object.x, object.y + object.h + 0.2, object.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <button
        type="button"
        className="pointer-events-auto whitespace-nowrap rounded-full border border-[#322d27] bg-[#1c1a17]/90 px-1.5 py-0.5 text-[10px] leading-none text-[#f4efe6]"
        onClick={(event) => {
          event.stopPropagation();
          useDink.getState().select(object.id);
          useDink.getState().setPanel("properties");
        }}
      >
        {label} · {kind}
        {href ? "" : ""}
      </button>
    </Html>
  );
}

const handleNodes = new Map<string, HTMLDivElement>();

function HandleLayer({ objects }: { objects: PlacedObject[] }) {
  const handles = useDink((state) => state.handles);
  const dragging = useDink((state) => state.dragging);
  const readOnly = useDink((state) => state.view?.project.readOnly);
  const [resizeId, setResizeId] = useState<string | null>(null);
  if (!handles || dragging || readOnly) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {objects.map((object) => (
        <div
          key={object.id}
          ref={(node) => {
            if (node) handleNodes.set(object.id, node);
            else handleNodes.delete(object.id);
          }}
          className="pointer-events-auto absolute left-0 top-0 flex gap-1 rounded-full border border-[#322d27] bg-[#1c1a17]/95 p-1 shadow-xl"
          style={{ display: "none" }}
        >
          <button
            type="button"
            aria-label="Move"
            className="flex items-center gap-1 rounded-full bg-[#e08a4f] px-2 py-1 text-[11px] font-medium text-[#1c1a17]"
            onPointerDown={(event) => beginTool(object, "move", event)}
          >
            <MoveIcon />
            Move
          </button>
          <button
            type="button"
            aria-label="Rotate"
            className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[#f4efe6] hover:bg-[#322d27]"
            onPointerDown={(event) => beginTool(object, "rotate", event)}
          >
            <RotateIcon />
            Rotate
          </button>
          {resizeId === object.id ? (
            (["x", "y", "z"] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                aria-label={`Resize ${axis.toUpperCase()}`}
                title={axis === "x" ? "Width" : axis === "y" ? "Height" : "Depth"}
                className="rounded-full bg-[#e08a4f] px-2 py-1 text-[11px] font-medium uppercase text-[#1c1a17]"
                onPointerDown={(event) => beginTool(object, "resize", event, axis)}
              >
                {axis}
              </button>
            ))
          ) : (
            <button
              type="button"
              aria-label="Resize"
              className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[#f4efe6] hover:bg-[#322d27]"
              onClick={(event) => {
                event.stopPropagation();
                setResizeId(object.id);
              }}
            >
              <ResizeIcon />
              Resize
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete ${object.name}`}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[#f4efe6] hover:bg-[#6b3030]"
            onClick={(event) => {
              event.stopPropagation();
              void removeObject(object);
            }}
          >
            <DeleteIcon />
            Delete
          </button>
          <label className="flex items-center">
            <input
              aria-label={`Color ${object.name}`}
              type="color"
              className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
              value={object.tint || object.color}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => commitColor(object, event.target.value)}
            />
          </label>
        </div>
      ))}
    </div>
  );
}

function HandleTracker({ objects }: { objects: PlacedObject[] }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!useDink.getState().handles) return;
    for (const object of objects) {
      const node = handleNodes.get(object.id);
      if (!node) continue;
      point.set(object.x, object.y + object.h + 0.35, object.z);
      point.project(camera);
      const hidden = point.z < -1 || point.z > 1;
      node.style.display = hidden ? "none" : "flex";
      const x = (point.x * 0.5 + 0.5) * size.width;
      const y = (-point.y * 0.5 + 0.5) * size.height;
      node.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    }
  });
  return null;
}

function WalkHint() {
  const handles = useDink((state) => state.handles);
  return (
    <p className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-full bg-black/50 px-3 py-1 text-xs text-white">
      {handles ? "Resize opens X, Y, and Z. Drag right to grow that axis. Delete removes that piece." : "Click to look · WASD to walk · eye height 1.7 m"}
    </p>
  );
}

function removeObject(object: PlacedObject) {
  const projectId = useDink.getState().view?.project.id;
  if (!projectId) return;
  void fetch(`/api/projects/${projectId}/patch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ removeObjectId: object.id, note: `Removed ${object.name}` }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const { toast } = await import("sonner");
        toast.error((data as { error?: string }).error || "That piece could not be removed.");
        return;
      }
      if (useDink.getState().selectedId === object.id) useDink.getState().select(null);
      useDink.getState().hydrate(data);
    })
    .catch(async () => {
      const { toast } = await import("sonner");
      toast.error("That piece could not be removed.");
    });
}

function commitColor(object: PlacedObject, color: string) {
  const projectId = useDink.getState().view?.project.id;
  if (!projectId) return;
  useDink.getState().select(object.id);
  useDink.getState().nudge(object.id, { x: object.x, z: object.z, rotationY: object.rotationY, w: object.w, l: object.l, h: object.h, tint: color });
  void fetch(`/api/projects/${projectId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objectId: object.id, x: object.x, z: object.z, rotationY: object.rotationY, color }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        useDink.getState().clearNudges();
        const { toast } = await import("sonner");
        toast.error((data as { error?: string }).error || "That color could not be saved.");
        return;
      }
      useDink.getState().hydrate(data);
    })
    .catch(() => useDink.getState().clearNudges());
}

function MoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1v10M1 6h10M6 1 4.2 2.8M6 1l1.8 1.8M6 11 4.2 9.2M6 11l1.8-1.8M1 6l1.8-1.8M1 6l1.8 1.8M11 6 9.2 4.2M11 6 9.2 7.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 3.2h7M4.6 3.2V2.2h2.8v1M3.4 3.2l.4 6.2h4.4l.4-6.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ResizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 10V6.5M2 10h3.5M10 2v3.5M10 2H6.5M2 10 5 7M10 2 7 5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M9.5 4.2A3.8 3.8 0 1 0 10 7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9.4 1.6v2.8H6.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReferenceCard({ object, active }: { object: PlacedObject; active: boolean }) {
  const view = useDink((state) => state.view);
  const uploads = useDink((state) => state.uploads);
  if (!view) return null;
  const pin = view.spec?.photoPins?.[object.id];
  const mode = view.settings.referencePhotoMode;
  const show = pin === "on" || (pin !== "off" && (mode === "always" || (mode === "select" && active && useDink.getState().selectedId === object.id) || (mode === "hover" && useDink.getState().hoveredId === object.id)));
  if (!show || mode === "off" || mode === "compare") return null;
  const upload = uploads[object.id];
  const quote = view.quotes[object.catalogId];
  const source = view.settings.referencePhotoSource;
  return (
    <Html position={[object.x, object.y + object.h + 1.15, object.z]} center zIndexRange={[15, 0]}>
      <div className="w-40 rounded-2xl border border-[#322d27] bg-[#1c1a17] p-2 text-[11px] text-[#f4efe6] shadow-xl">
        <p className="text-[10px] uppercase tracking-wide text-[#e08a4f]">Reference photo</p>
        {upload && (source === "upload" || source === "both") ? (
          // User uploads are served by this app. Marketplace photos are never loaded in the browser.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="Your upload" src={`/api/media/${upload}`} className="mt-1 h-16 w-full rounded-lg object-cover" />
        ) : null}
        {source !== "upload" ? <p className="mt-1 text-[#b3a89b]">{quote?.title || "No cached listing photo. Open a verified listing from the price chip."}</p> : null}
        <p className="mt-1 text-[#8d877e]">Stand-in model. Not the product photo.</p>
      </div>
    </Html>
  );
}

function heatColor(objectId: string, total: number, cost: { lines: { objectIds: string[]; total: number }[] } | null | undefined): string {
  const line = cost?.lines.find((item) => item.objectIds.includes(objectId));
  const share = line && total > 0 ? line.total / total : 0;
  const color = new THREE.Color();
  color.setHSL(0.12 - Math.min(share, 0.2) * 0.55, 0.72, 0.48);
  return `#${color.getHexString()}`;
}

function MiniMap() {
  const view = useDink((state) => state.view);
  const pose = useDink((state) => state.pose);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const spec = view?.spec;
    const layout = view?.layout;
    const node = canvas.current;
    if (!spec || !layout || !node) return;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    const w = node.width;
    const h = node.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1c1a17";
    ctx.fillRect(0, 0, w, h);
    const pad = 10;
    const scale = Math.min((w - pad * 2) / spec.room.width, (h - pad * 2) / spec.room.length);
    const ox = (w - spec.room.width * scale) / 2;
    const oy = (h - spec.room.length * scale) / 2;
    ctx.strokeStyle = "#e08a4f";
    ctx.strokeRect(ox, oy, spec.room.width * scale, spec.room.length * scale);
    ctx.fillStyle = "#8d877e";
    for (const object of layout.objects) {
      ctx.fillRect(ox + (object.x - object.w / 2) * scale, oy + (object.z - object.l / 2) * scale, Math.max(2, object.w * scale), Math.max(2, object.l * scale));
    }
    if (pose) {
      ctx.fillStyle = "#f4efe6";
      ctx.beginPath();
      ctx.arc(ox + pose.position[0] * scale, oy + pose.position[2] * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [view, pose]);
  if (!view?.spec) return null;
  return (
    <div className="absolute bottom-3 right-3 hidden rounded-2xl border border-[#322d27] bg-[#12110f]/80 p-2 sm:block">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#b3a89b]">Plan</p>
      <canvas ref={canvas} width={148} height={110} className="block" aria-label="Mini map of the room" />
    </div>
  );
}

useGLTF.preload("/catalog/sewing_industrial.glb");
