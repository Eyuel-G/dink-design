export type FitMode = "box" | "column" | "curtain";

export interface FitSize {
  x: number;
  y: number;
  z: number;
}

/**
 * Scale a mesh onto its placed size. Furniture keeps one scale so a car or a chair
 * is not stretched. A column still grows to the roof and keeps a readable thickness.
 */
export function fitScale(size: FitSize, target: { w: number; h: number; l: number }, mode: FitMode): FitSize {
  const sy = size.y > 1e-4 ? target.h / size.y : 1;
  if (mode === "curtain") {
    return {
      x: size.x > 1e-4 ? target.w / size.x : 1,
      y: size.y > 1e-4 ? target.h / size.y : 1,
      z: size.z > 1e-4 ? target.l / size.z : 1,
    };
  }
  if (mode === "box") {
    const modelSpan = Math.max(size.x, size.z);
    const targetSpan = Math.max(target.w, target.l);
    let uniform = modelSpan > 1e-4 ? targetSpan / modelSpan : 1;
    if (target.h >= 0.08 && size.y > 1e-4) uniform = Math.min(uniform, sy);
    return { x: uniform, y: uniform, z: uniform };
  }
  let horizontal = sy;
  const foot = Math.max(size.x, size.z) * horizontal;
  if (foot > 0.65) horizontal *= 0.65 / foot;
  else if (foot > 1e-4 && foot < 0.25) horizontal *= 0.25 / foot;
  return { x: horizontal, y: sy, z: horizontal };
}

/** Which authored axis should run along the window, up the glass, and out from the wall. */
export function curtainAxes(size: { x: number; y: number; z: number }): { width: "x" | "y" | "z"; height: "x" | "y" | "z"; depth: "x" | "y" | "z" } {
  const entries = (["x", "y", "z"] as const).map((axis) => ({ axis, size: size[axis] })).sort((a, b) => a.size - b.size);
  const depth = entries[0]!.axis;
  if (depth !== "y") {
    const width = entries.find((entry) => entry.axis !== depth && entry.axis !== "y")!.axis;
    return { width, height: "y", depth };
  }
  return { width: entries[2]!.axis, height: entries[1]!.axis, depth };
}
