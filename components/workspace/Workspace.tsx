"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, Download, Menu, Moon, Share2, Sun, Undo2, Redo2 } from "lucide-react";
import { EXAMPLES } from "@/lib/intent/presets";
import { r3 } from "@/lib/num";
import { api } from "@/lib/client/api";
import { useDink } from "@/lib/client/store";
import type { CameraMode, ProjectView } from "@/lib/client/types";
import { AssetsPanel } from "@/components/assets/AssetsPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import type { ImagePayload } from "@/components/chat/images";
import { CostsPanel } from "@/components/costs/CostsPanel";
import { AlternativesPanel } from "@/components/properties/OptionsPanel";
import { PropertiesPanel } from "@/components/properties/PropertiesPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { streamChat, type StreamEvent } from "@/components/workspace/stream";

const SceneViewport = dynamic(() => import("@/components/viewport/SceneViewport").then((mod) => mod.SceneViewport), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Opening the room…</div>,
});

const STEPS = [
  { id: "intent", label: "Understanding" },
  { id: "layout", label: "Planning" },
  { id: "assets", label: "Fetching assets" },
  { id: "scene", label: "Building" },
  { id: "cost", label: "Costing" },
  { id: "prices", label: "Checking prices" },
];

export function Workspace({ initial }: { initial: ProjectView }) {
  const hydrate = useDink((state) => state.hydrate);
  const view = useDink((state) => state.view);
  const router = useRouter();
  useEffect(() => {
    const current = useDink.getState().view;
    if (!current || current.project.id !== initial.project.id || current.project.currentVersion < initial.project.currentVersion) {
      hydrate(initial);
    }
    document.documentElement.classList.toggle("dark", (useDink.getState().view?.settings.theme ?? initial.settings.theme) !== "light");
  }, [hydrate, initial]);

  useEffect(() => {
    if (!initial.pending || booted.has(initial.project.id)) return;
    booted.add(initial.project.id);
    void runStream({ projectId: initial.project.id });
  }, [initial.pending, initial.project.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const mode: Record<string, CameraMode> = { Digit1: "orbit", Digit2: "walk", Digit3: "plan", Digit4: "cutaway" };
      if (mode[event.code]) useDink.getState().setMode(mode[event.code]);
      if (event.key === "p") useDink.getState().togglePrices();
      if (event.key === "h") useDink.getState().toggleHeat();
      if (event.key === "m") useDink.getState().toggleHandles();
      if (event.key === "?") useDink.getState().setHelp(true);
      if (event.key === "Escape") useDink.getState().select(null);
      if ((event.code === "KeyQ" || event.code === "KeyR") && !useDink.getState().dragging) {
        const state = useDink.getState();
        const current = state.view;
        const object = current?.layout?.objects.find((item) => item.id === state.selectedId);
        if (!current || !object || current.project.readOnly) return;
        event.preventDefault();
        const rotationY = r3(object.rotationY + (event.code === "KeyR" ? Math.PI / 12 : -Math.PI / 12));
        void api<ProjectView>(`/api/projects/${current.project.id}/move`, {
          method: "POST",
          body: JSON.stringify({ objectId: object.id, x: object.x, z: object.z, rotationY }),
        })
          .then((fresh) => useDink.getState().hydrate(fresh))
          .catch((error: Error) => toast.error(error.message));
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void history(event.shiftKey ? "redo" : "undo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!view) return <div className="grid h-screen place-items-center text-sm text-muted">Loading the project…</div>;

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <TopBar onHome={() => router.push("/")} />
      {view.persistence === "memory" ? (
        <p className="bg-chip px-4 py-1 text-center text-xs text-muted">No MySQL connection. This session keeps projects in memory and they disappear when the server restarts. Set MYSQL_URL to keep them.</p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Stepper />
          <div className="relative min-h-0 flex-1">
            <SceneViewport />
            <Toolbar />
          </div>
        </main>
        <RightPanel />
      </div>
      <Help />
    </div>
  );
}

function TopBar({ onHome }: { onHome: () => void }) {
  const view = useDink((state) => state.view);
  const [name, setName] = useState(view?.project.name ?? "");
  useEffect(() => setName(view?.project.name ?? ""), [view?.project.name]);
  if (!view) return null;
  return (
    <header className="flex h-14 items-center gap-2 border-b border-line px-3">
      <button type="button" className="rounded-full p-2 hover:bg-chip focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:hidden" aria-label="Open projects" onClick={() => useDink.getState().setSidebar(true)}>
        <Menu className="h-4 w-4" />
      </button>
      <button type="button" className="font-display text-xl" onClick={onHome}>Dink</button>
      <input
        aria-label="Project name"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        value={name}
        disabled={view.project.readOnly}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (!name.trim() || name === view.project.name) return;
          void api(`/api/projects/${view.project.id}`, { method: "PATCH", body: JSON.stringify({ name }) }).catch((error: Error) => toast.error(error.message));
        }}
      />
      <Button size="sm" variant="outline" onClick={() => void saveSettings({ currency: view.settings.currency === "ETB" ? "USD" : "ETB" })}>
        {view.settings.currency}
      </Button>
      <Button size="icon" variant="ghost" aria-label={view.settings.dayNight === "day" ? "Night lighting" : "Day lighting"} onClick={() => void saveSettings({ dayNight: view.settings.dayNight === "day" ? "night" : "day" })}>
        {view.settings.dayNight === "day" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={view.project.readOnly}><Download className="h-4 w-4" /> Export</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => void download(view.project.id, "pdf")}>PDF bill of quantities</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download(view.project.id, "csv")}>CSV</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download(view.project.id, "json")}>JSON spec</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="outline" disabled={view.project.readOnly} onClick={() => void share(view.project.id)}>
        <Share2 className="h-4 w-4" /> Share
      </Button>
    </header>
  );
}

function Sidebar() {
  const view = useDink((state) => state.view);
  const open = useDink((state) => state.sidebar);
  const router = useRouter();
  if (!view) return null;
  return (
    <aside className={`${open ? "fixed inset-0 z-30 block bg-black/40 lg:bg-transparent" : "hidden"} lg:static lg:block lg:w-64 lg:shrink-0`}>
      <div className="flex h-full w-72 flex-col gap-3 border-r border-line bg-elev p-3 lg:w-full">
        <Button onClick={() => router.push("/")} disabled={view.project.readOnly}>New project</Button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" aria-label="Undo" disabled={view.project.readOnly} onClick={() => void history("undo")}><Undo2 className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" aria-label="Redo" disabled={view.project.readOnly} onClick={() => void history("redo")}><Redo2 className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Versions</p>
          {view.versions.length === 0 ? <p className="text-xs text-muted">No versions yet.</p> : null}
          {[...view.versions].reverse().map((version) => (
            <button key={version.version} type="button" className={`mb-1 block w-full rounded-xl px-2 py-2 text-left text-xs hover:bg-chip ${version.version === view.project.currentVersion ? "bg-chip" : ""}`} onClick={() => void history("restore", version.version)}>
              <span className="text-muted">v{version.version}</span> {version.label}
            </button>
          ))}
          <p className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-muted">Templates</p>
          {EXAMPLES.map((example) => (
            <button key={example.preset} type="button" disabled={view.project.readOnly} className="mb-1 block w-full rounded-xl px-2 py-2 text-left text-xs hover:bg-chip" onClick={() => void applyTemplate(view.project.id, example.preset)}>
              {example.label}
            </button>
          ))}
        </div>
        <button type="button" className="text-xs text-muted lg:hidden" onClick={() => useDink.getState().setSidebar(false)}>Close</button>
      </div>
    </aside>
  );
}

function Stepper() {
  const step = useDink((state) => state.step);
  const detail = useDink((state) => state.stepDetail);
  const assets = useDink((state) => state.assets);
  const busy = useDink((state) => state.busy);
  const [open, setOpen] = useState(false);
  if (!busy && !step) return null;
  const index = Math.max(0, STEPS.findIndex((item) => item.id === step));
  const asset = assets.at(-1);
  return (
    <div className="border-b border-line px-3 py-2">
      <ol className="flex gap-2 overflow-x-auto text-[11px]">
        {STEPS.map((item, itemIndex) => (
          <li key={item.id} className={itemIndex <= index ? "text-ink" : "text-muted"}>
            {item.label}
            {item.id === "assets" && asset ? ` ${asset.done}/${asset.total}` : ""}
            {item.id === step && detail ? ` · ${detail}` : ""}
          </li>
        ))}
      </ol>
      <button type="button" className="mt-1 text-[11px] text-muted underline" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide asset sources" : "Asset sources"}
      </button>
      {open ? (
        <ul className="mt-1 max-h-24 overflow-y-auto text-[11px] text-muted">
          {assets.map((item) => (
            <li key={item.id}>{item.id} · {item.source} · {item.status} · {item.ms} ms</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Toolbar() {
  const mode = useDink((state) => state.cameraMode);
  const showPrices = useDink((state) => state.showPrices);
  const heat = useDink((state) => state.heat);
  const handles = useDink((state) => state.handles);
  const view = useDink((state) => state.view);
  const modes: CameraMode[] = ["orbit", "walk", "plan", "cutaway"];
  return (
    <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1">
      {modes.map((item) => (
        <button key={item} type="button" className={`rounded-full px-3 py-1 text-xs capitalize ${mode === item ? "bg-accent text-accent-ink" : "bg-elev/90 text-ink"}`} onClick={() => useDink.getState().setMode(item)}>
          {item}
        </button>
      ))}
      <button type="button" className={`rounded-full px-3 py-1 text-xs ${showPrices ? "bg-accent text-accent-ink" : "bg-elev/90"}`} onClick={() => useDink.getState().togglePrices()}>Prices</button>
      <button type="button" className={`rounded-full px-3 py-1 text-xs ${heat ? "bg-accent text-accent-ink" : "bg-elev/90"}`} onClick={() => useDink.getState().toggleHeat()}>Cost heat</button>
      <button type="button" className={`rounded-full px-3 py-1 text-xs ${handles ? "bg-accent text-accent-ink" : "bg-elev/90"}`} onClick={() => useDink.getState().toggleHandles()}>Handles</button>
      <button type="button" className="rounded-full bg-elev/90 px-3 py-1 text-xs" onClick={() => void saveBookmark()} aria-label="Save camera bookmark"><Bookmark className="inline h-3 w-3" /> Save view</button>
      <label className="rounded-full bg-elev/90 px-2 py-1 text-xs">
        <span className="sr-only">Reference photos</span>
        <select
          aria-label="Reference photos"
          className="bg-transparent"
          value={view?.settings.referencePhotoMode}
          onChange={(event) => void saveSettings({ referencePhotoMode: event.target.value as NonNullable<typeof view>["settings"]["referencePhotoMode"] })}
        >
          <option value="off">Photos off</option>
          <option value="hover">On hover</option>
          <option value="select">On select</option>
          <option value="always">Always</option>
          <option value="compare">Compare only</option>
        </select>
      </label>
      <button type="button" className="rounded-full bg-elev/90 px-3 py-1 text-xs" onClick={() => useDink.getState().setHelp(true)}>?</button>
      <BookmarkList />
    </div>
  );
}

function BookmarkList() {
  const bookmarks = useDink((state) => state.view?.settings.bookmarks ?? []);
  const projectId = useDink((state) => state.view?.project.id);
  const mine = bookmarks.filter((bookmark) => bookmark.projectId === projectId);
  if (!mine.length) return null;
  return (
    <>
      {mine.map((bookmark) => (
        <button key={bookmark.name} type="button" className="rounded-full bg-elev/90 px-3 py-1 text-xs" onClick={() => useDink.getState().setRecall({ position: bookmark.position, target: bookmark.target })}>
          {bookmark.name}
        </button>
      ))}
    </>
  );
}

function RightPanel() {
  const panel = useDink((state) => state.panel);
  const sheet = useDink((state) => state.sheet);
  return (
    <>
      <section className="hidden w-[380px] shrink-0 border-l border-line lg:flex lg:flex-col">
        <PanelTabs value={panel} />
      </section>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-elev lg:hidden">
        <div className="flex justify-around py-1 text-xs">
          {(["chat", "costs", "assets", "properties", "alternatives"] as const).map((tab) => (
            <button key={tab} type="button" className="rounded-full px-3 py-2 capitalize" onClick={() => useDink.getState().setPanel(tab)}>{tab}</button>
          ))}
        </div>
        {sheet ? (
          <div className="h-[48vh]">
            <PanelTabs value={panel} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function PanelTabs({ value }: { value: string }) {
  return (
    <Tabs value={value} onValueChange={(next) => useDink.getState().setPanel(next as "chat")} className="flex h-full min-h-0 flex-col">
      <TabsList className="m-2">
        <TabsTrigger value="chat" className="px-2 text-[11px]">Chat</TabsTrigger>
        <TabsTrigger value="costs" className="px-2 text-[11px]">Costs</TabsTrigger>
        <TabsTrigger value="assets" className="px-2 text-[11px]">Assets</TabsTrigger>
        <TabsTrigger value="properties" className="px-2 text-[11px]">Properties</TabsTrigger>
        <TabsTrigger value="alternatives" className="px-2 text-[11px]">Alternatives</TabsTrigger>
      </TabsList>
      <TabsContent value="chat"><ChatPanel onSend={sendFollowUp} onConfirm={confirmReading} /></TabsContent>
      <TabsContent value="costs"><CostsPanel /></TabsContent>
      <TabsContent value="assets"><AssetsPanel /></TabsContent>
      <TabsContent value="properties"><PropertiesPanel /></TabsContent>
      <TabsContent value="alternatives"><AlternativesPanel /></TabsContent>
    </Tabs>
  );
}

function Help() {
  const help = useDink((state) => state.help);
  return (
    <Dialog open={help} onOpenChange={(open) => useDink.getState().setHelp(open)}>
      <DialogContent>
        <DialogTitle>Shortcuts</DialogTitle>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          <li>1 orbit · 2 walk · 3 plan · 4 cutaway</li>
          <li>Handles shows Move and Rotate on every piece. Press one and drag.</li>
          <li>P price labels · H cost heat · M handles · ? this list</li>
          <li>Ctrl or Cmd Z undo · Shift Z redo</li>
          <li>Drag an object to snap it to the 0.25 m grid. Walk uses WASD and the mouse.</li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}

async function saveSettings(patch: Record<string, unknown>) {
  const view = useDink.getState().view;
  if (!view) return;
  const next = { ...view.settings, ...patch };
  useDink.getState().applySettings(next);
  document.documentElement.classList.toggle("dark", next.theme !== "light");
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Settings were not saved.");
  }
}

async function history(action: "undo" | "redo" | "restore", version?: number) {
  const view = useDink.getState().view;
  if (!view || view.project.readOnly) return;
  try {
    const fresh = await api<ProjectView>(`/api/projects/${view.project.id}/history`, { method: "POST", body: JSON.stringify({ action, version }) });
    useDink.getState().hydrate(fresh);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "That version could not be restored.");
  }
}

async function applyTemplate(projectId: string, preset: string) {
  try {
    const fresh = await api<ProjectView>(`/api/projects/${projectId}/template`, { method: "POST", body: JSON.stringify({ preset }) });
    useDink.getState().hydrate(fresh);
    toast.success("Template applied as a new version.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The template was not applied.");
  }
}

async function download(projectId: string, kind: string) {
  const response = await fetch(`/api/export/${kind}?projectId=${projectId}`);
  if (!response.ok) {
    toast.error("Export failed. Build a scene first.");
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dink-${kind === "json" ? "spec.json" : kind === "csv" ? "boq.csv" : "boq.pdf"}`;
  link.click();
  URL.revokeObjectURL(url);
}

async function share(projectId: string) {
  try {
    const result = await api<{ path: string }>("/api/share", { method: "POST", body: JSON.stringify({ projectId }) });
    await navigator.clipboard.writeText(`${window.location.origin}${result.path}`);
    toast.success("Read-only link copied.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Share failed.");
  }
}

async function saveBookmark() {
  const state = useDink.getState();
  const view = state.view;
  const pose = state.pose;
  if (!view || !pose || view.project.readOnly) {
    toast.message("Move the camera, then save the view.");
    return;
  }
  const name = `View ${view.settings.bookmarks.length + 1}`;
  await saveSettings({
    bookmarks: [...view.settings.bookmarks, { projectId: view.project.id, name, position: pose.position, target: pose.target, mode: state.cameraMode }].slice(-24),
  });
  toast.success("Camera bookmark saved.");
}

async function sendFollowUp(content: string, images: ImagePayload[]) {
  const view = useDink.getState().view;
  if (!view) return;
  useDink.getState().patchView({
    messages: [...view.messages, { id: `local-${Date.now()}`, role: "user", content: content || "Image attached", status: "done", createdAt: new Date().toISOString() }],
  });
  await runStream({ projectId: view.project.id, content, images });
}

async function confirmReading() {
  const view = useDink.getState().view;
  if (!view) return;
  await runStream({ projectId: view.project.id, confirm: true });
}

const booted = new Set<string>();
let streamOwner = 0;

async function runStream(body: Record<string, unknown>) {
  const token = ++streamOwner;
  const store = useDink.getState();
  store.setBusy(true);
  store.setStep("intent", "");
  const handle = (event: StreamEvent) => {
    if (token !== streamOwner) return;
    const current = useDink.getState();
    if (event.type === "step") current.setStep(event.step, event.detail);
    if (event.type === "token") current.appendToken(event.text);
    if (event.type === "asset_progress") current.pushAsset(event);
    if (event.type === "scene_patch") current.applySpec(event.spec, event.layout, event.cost, event.version, event.models);
    if (event.type === "price_update") current.applyQuote(event.catalogId, event.quote);
    if (event.type === "suggestions") current.setChips(event.chips);
    if (event.type === "confirm") current.setConfirm(event.reading);
    if (event.type === "error") toast.error(event.message);
  };
  try {
    await streamChat(body, handle);
  } catch (error) {
    if (token === streamOwner) toast.error(error instanceof Error ? error.message : "The chat stopped.");
  } finally {
    if (token === streamOwner) useDink.getState().setBusy(false);
  }
  const projectId = String(body.projectId);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (token !== streamOwner) return;
    const fresh = await api<ProjectView>(`/api/projects/${projectId}`).catch(() => null);
    if (!fresh) return;
    if (fresh.spec || !fresh.pending || attempt === 19) {
      if (token === streamOwner) useDink.getState().hydrate(fresh);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}
