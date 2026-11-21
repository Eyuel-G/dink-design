import type { BuildingSpec } from "@/lib/schemas";

export interface VersionRecord {
  version: number;
  parent: number | null;
  spec: BuildingSpec;
  label: string;
}

export function undoVersion(versions: VersionRecord[], current: number): number {
  const row = versions.find((version) => version.version === current);
  return row?.parent ?? current;
}

export function redoVersion(versions: VersionRecord[], current: number): number {
  const children = versions.filter((version) => version.parent === current).sort((a, b) => b.version - a.version);
  return children[0]?.version ?? current;
}
