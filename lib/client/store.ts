"use client";

import { create } from "zustand";
import { rememberCatalog } from "@/lib/catalog";
import { computeCost } from "@/lib/cost/compute";
import type { PriceQuote } from "@/lib/cost/compute";
import type { BuildingSpec, UserSettings } from "@/lib/schemas";
import type { AssetProgress, CameraMode, CameraPose, ModelLink, PanelTab, ProjectView } from "@/lib/client/types";

export type Nudge = { x: number; z: number; rotationY: number; w?: number; l?: number; h?: number; tint?: string };

interface DinkState {
  view: ProjectView | null;
  busy: boolean;
  step: string;
  stepDetail: string;
  assets: AssetProgress[];
  streaming: string;
  chips: string[];
  confirm: string | null;
  selectedId: string | null;
  hoveredId: string | null;
  cameraMode: CameraMode;
  showPrices: boolean;
  heat: boolean;
  handles: boolean;
  help: boolean;
  sidebar: boolean;
  sheet: boolean;
  panel: PanelTab;
  focus: [number, number, number] | null;
  pose: CameraPose | null;
  recall: CameraPose | null;
  nudges: Record<string, Nudge>;
  dragging: boolean;
  uploads: Record<string, string>;
  compareId: string | null;
  hydrate: (view: ProjectView) => void;
  patchView: (partial: Partial<ProjectView>) => void;
  setBusy: (busy: boolean) => void;
  setStep: (step: string, detail?: string) => void;
  pushAsset: (asset: AssetProgress) => void;
  appendToken: (text: string) => void;
  setChips: (chips: string[]) => void;
  setConfirm: (confirm: string | null) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setMode: (mode: CameraMode) => void;
  togglePrices: () => void;
  toggleHeat: () => void;
  toggleHandles: () => void;
  setHelp: (help: boolean) => void;
  setSidebar: (sidebar: boolean) => void;
  setSheet: (sheet: boolean) => void;
  setPanel: (panel: PanelTab) => void;
  setFocus: (focus: [number, number, number] | null) => void;
  setPose: (pose: CameraPose) => void;
  setRecall: (pose: CameraPose | null) => void;
  nudge: (id: string, pose: Nudge) => void;
  clearNudges: () => void;
  setDragging: (dragging: boolean) => void;
  setUpload: (objectId: string, mediaId: string) => void;
  setCompare: (id: string | null) => void;
  applyQuote: (catalogId: string, quote: PriceQuote) => void;
  applySettings: (settings: UserSettings) => void;
  applySpec: (spec: BuildingSpec, layout: ProjectView["layout"], cost: ProjectView["cost"], version: number, models?: Record<string, ModelLink>) => void;
}

function recompute(view: ProjectView, settings: UserSettings): ProjectView["cost"] {
  if (!view.spec || !view.layout) return view.cost;
  return computeCost(view.spec, view.layout, { laborPct: settings.laborPct, contingencyPct: settings.contingencyPct, quotes: view.quotes });
}

export const useDink = create<DinkState>((set) => ({
  view: null,
  busy: false,
  step: "",
  stepDetail: "",
  assets: [],
  streaming: "",
  chips: [],
  confirm: null,
  selectedId: null,
  hoveredId: null,
  cameraMode: "orbit",
  showPrices: true,
  heat: false,
  handles: false,
  help: false,
  sidebar: false,
  sheet: false,
  panel: "chat",
  focus: null,
  pose: null,
  recall: null,
  nudges: {},
  dragging: false,
  uploads: {},
  compareId: null,
  hydrate: (view) => {
    rememberCatalog(view.spec?.extras);
    set((state) => ({ view, streaming: "", busy: false, nudges: {}, assets: state.view?.project.id === view.project.id ? state.assets : [] }));
  },
  patchView: (partial) => set((state) => ({ view: state.view ? { ...state.view, ...partial } : state.view })),
  setBusy: (busy) => set({ busy }),
  setStep: (step, detail) => set({ step, stepDetail: detail ?? "" }),
  pushAsset: (asset) => set((state) => ({ assets: [...state.assets.filter((row) => row.id !== asset.id), asset] })),
  appendToken: (text) => set((state) => ({ streaming: state.streaming + text })),
  setChips: (chips) => set({ chips }),
  setConfirm: (confirm) => set({ confirm }),
  select: (selectedId) => set({ selectedId }),
  hover: (hoveredId) => set({ hoveredId }),
  setMode: (cameraMode) => set({ cameraMode }),
  togglePrices: () => set((state) => ({ showPrices: !state.showPrices })),
  toggleHeat: () => set((state) => ({ heat: !state.heat })),
  toggleHandles: () => set((state) => ({ handles: !state.handles })),
  setHelp: (help) => set({ help }),
  setSidebar: (sidebar) => set({ sidebar }),
  setSheet: (sheet) => set({ sheet }),
  setPanel: (panel) => set({ panel, sheet: true }),
  setFocus: (focus) => set({ focus }),
  setPose: (pose) => set({ pose }),
  setRecall: (recall) => set({ recall }),
  nudge: (id, pose) => set((state) => ({ nudges: { ...state.nudges, [id]: pose } })),
  clearNudges: () => set({ nudges: {} }),
  setDragging: (dragging) => set({ dragging }),
  setUpload: (objectId, mediaId) => set((state) => ({ uploads: { ...state.uploads, [objectId]: mediaId } })),
  setCompare: (compareId) => set((state) => ({ compareId, panel: compareId ? "properties" : state.panel })),
  applyQuote: (catalogId, quote) =>
    set((state) => {
      if (!state.view) return state;
      const quotes = { ...state.view.quotes, [catalogId]: quote };
      const view = { ...state.view, quotes };
      view.cost = recompute(view, view.settings);
      return { view };
    }),
  applySettings: (settings) =>
    set((state) => {
      if (!state.view) return state;
      const view = { ...state.view, settings };
      view.cost = recompute(view, settings);
      return { view };
    }),
  applySpec: (spec, layout, cost, version, models) => {
    rememberCatalog(spec.extras);
    set((state) => {
      if (!state.view) return state;
      return {
        view: {
          ...state.view,
          spec,
          layout,
          cost,
          models: models ?? state.view.models,
          project: { ...state.view.project, currentVersion: version },
        },
        nudges: {},
        confirm: null,
      };
    });
  },
}));
