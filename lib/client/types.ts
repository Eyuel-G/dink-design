import type { CostReport, PriceQuote } from "@/lib/cost/compute";
import type { PlacedObject } from "@/lib/layout/place";
import type { BuildingSpec, UserSettings } from "@/lib/schemas";

export type CameraMode = "orbit" | "walk" | "plan" | "cutaway";
export type PanelTab = "chat" | "costs" | "assets" | "properties" | "alternatives";

export interface ModelLink {
  url: string;
  source: "library" | "online" | "generated";
  label: string;
}

export interface ProjectView {
  persistence: "mysql" | "memory";
  project: { id: string; name: string; currentVersion: number; readOnly: boolean };
  models?: Record<string, ModelLink>;
  messages: { id: string; role: "user" | "assistant"; content: string; status: string; createdAt: string }[];
  versions: { version: number; parent: number | null; label: string; createdAt: string }[];
  spec: BuildingSpec | null;
  layout: { objects: PlacedObject[]; warnings: string[] } | null;
  cost: CostReport | null;
  quotes: Record<string, PriceQuote>;
  settings: UserSettings;
  pending: boolean;
  draft: BuildingSpec | null;
  viewer?: { name: string; simulated: boolean };
}

export interface AssetProgress {
  id: string;
  source: string;
  ms: number;
  status: string;
  done: number;
  total: number;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}
