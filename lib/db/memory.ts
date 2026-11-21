import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/schemas";
import type { PlacedObject } from "@/lib/layout/place";
import type { AssetRow, JobRow, ListingRow, MessageRow, ProjectRow, SourceRow, Store, VersionRow } from "@/lib/db/types";

interface MemoryState {
  projects: ProjectRow[];
  messages: (MessageRow & { images: { mime: string; data: string }[] | null })[];
  versions: (VersionRow & { projectId: string })[];
  objects: { projectId: string; version: number; object: PlacedObject }[];
  settings: Map<string, UserSettings>;
  shares: { token: string; projectId: string; version: number; ownerSub: string }[];
  cache: Map<string, { payload: unknown; expires: number }>;
  sources: SourceRow[];
  listings: ListingRow[];
  assets: AssetRow[];
  jobs: (JobRow & { ownerSub: string })[];
  usage: { owner: string; at: number; cost: number }[];
}

const MEMORY_KEY = "__dinkDesignMemory";

function sharedState(): MemoryState {
  const holder = globalThis as typeof globalThis & { [MEMORY_KEY]?: MemoryState };
  if (!holder[MEMORY_KEY]) {
    holder[MEMORY_KEY] = {
      projects: [],
      messages: [],
      versions: [],
      objects: [],
      settings: new Map(),
      shares: [],
      cache: new Map(),
      sources: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          ownerSub: "system",
          name: "Jiji Ethiopia",
          baseUrl: "https://jiji.com.et",
          searchUrlTemplate: "https://jiji.com.et/search?query={query}",
          currency: "ETB",
          categories: ["equipment", "furniture", "openings", "utilities"],
          priority: 10,
          refreshHours: 12,
          strategy: "llm",
          enabled: true,
          robotsOk: null,
          status: "unknown",
          config: null,
        },
      ],
      listings: [],
      assets: [],
      jobs: [],
      usage: [],
    };
  }
  return holder[MEMORY_KEY];
}

function stamp() {
  return new Date().toISOString();
}

export function createMemoryStore(): Store {
  // Next compiles each route on its own and reloads this module while doing it.
  // A module-level object is empty in the new copy, so a project created on the
  // landing page is already missing when the workspace page reads it.
  const state = sharedState();
  return {
    persistence: "memory",
    async listProjects(owner) {
      return state.projects.filter((project) => project.ownerSub === owner).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async createProject(owner, name) {
      const project: ProjectRow = { id: randomUUID(), ownerSub: owner, name: name.slice(0, 191), currentVersion: 0, draft: null, createdAt: stamp(), updatedAt: stamp() };
      state.projects.push(project);
      return project;
    },
    async getProject(owner, id) {
      return state.projects.find((project) => project.id === id && project.ownerSub === owner) ?? null;
    },
    async getProjectById(id) {
      return state.projects.find((project) => project.id === id) ?? null;
    },
    async renameProject(owner, id, name) {
      const project = await this.getProject(owner, id);
      if (!project) return false;
      project.name = name.slice(0, 191);
      project.updatedAt = stamp();
      return true;
    },
    async setDraft(projectId, draft) {
      const project = state.projects.find((item) => item.id === projectId);
      if (project) project.draft = draft;
    },
    async addMessage(input) {
      const id = randomUUID();
      state.messages.push({
        id,
        projectId: input.projectId,
        role: input.role,
        content: input.content,
        status: input.status,
        hasImages: Boolean(input.images?.length),
        createdAt: stamp(),
        images: input.images ?? null,
      });
      return id;
    },
    async listMessages(projectId) {
      return state.messages.filter((message) => message.projectId === projectId).map((message) => ({
        id: message.id,
        projectId: message.projectId,
        role: message.role,
        content: message.content,
        status: message.status,
        hasImages: message.hasImages,
        createdAt: message.createdAt,
      }));
    },
    async latestPending(projectId) {
      const message = [...state.messages].reverse().find((item) => item.projectId === projectId && item.role === "user" && item.status === "pending");
      if (!message) return null;
      return { id: message.id, content: message.content, images: message.images ?? [] };
    },
    async setMessageStatus(id, status) {
      const message = state.messages.find((item) => item.id === id);
      if (message) message.status = status;
    },
    async saveVersion(projectId, spec, objects, label) {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const max = state.versions.filter((version) => version.projectId === projectId).reduce((n, version) => Math.max(n, version.version), 0);
      const version = max + 1;
      state.versions.push({ projectId, version, parent: project.currentVersion || null, spec, label, createdAt: stamp() });
      for (const object of objects) state.objects.push({ projectId, version, object });
      project.currentVersion = version;
      project.draft = null;
      project.updatedAt = stamp();
      return version;
    },
    async listVersions(projectId) {
      return state.versions
        .filter((version) => version.projectId === projectId)
        .sort((a, b) => a.version - b.version)
        .map((version) => ({ version: version.version, parent: version.parent, spec: version.spec, label: version.label, createdAt: version.createdAt }));
    },
    async readVersion(projectId, version) {
      return (await this.listVersions(projectId)).find((row) => row.version === version) ?? null;
    },
    async setCurrentVersion(projectId, version) {
      const project = state.projects.find((item) => item.id === projectId);
      if (project) {
        project.currentVersion = version;
        project.updatedAt = stamp();
      }
    },
    async getSettings(owner) {
      return state.settings.get(owner) ?? { ...DEFAULT_SETTINGS, bookmarks: [] };
    },
    async saveSettings(owner, settings) {
      state.settings.set(owner, settings);
    },
    async createShare(owner, projectId, version) {
      const token = randomBytes(24).toString("hex");
      state.shares.push({ token, projectId, version, ownerSub: owner });
      return token;
    },
    async getShare(token) {
      const share = state.shares.find((item) => item.token === token);
      return share ? { projectId: share.projectId, version: share.version, ownerSub: share.ownerSub } : null;
    },
    async cacheGet(hash) {
      const hit = state.cache.get(hash);
      if (!hit || hit.expires < Date.now()) return null;
      return hit.payload as never;
    },
    async cacheSet(hash, payload, ttlHours) {
      state.cache.set(hash, { payload, expires: Date.now() + ttlHours * 3600_000 });
    },
    async listSources(owner) {
      return state.sources.filter((source) => source.ownerSub === "system" || source.ownerSub === owner);
    },
    async insertSource(source) {
      state.sources.push(source);
    },
    async updateSource(id, patch) {
      const source = state.sources.find((item) => item.id === id);
      if (source) Object.assign(source, patch);
    },
    async replaceListings(sourceId, catalogId, listings) {
      state.listings = state.listings.filter((listing) => !(listing.sourceId === sourceId && listing.catalogId === catalogId));
      for (const listing of listings) {
        state.listings.push({ ...listing, id: randomUUID(), fetchedAt: stamp(), stale: false });
      }
    },
    async listListings(catalogId) {
      return state.listings.filter((listing) => listing.catalogId === catalogId);
    },
    async markListingStale(id) {
      const listing = state.listings.find((item) => item.id === id);
      if (listing) listing.stale = true;
    },
    async addSnapshot() {
      return;
    },
    async logUsage(owner, _ip, _tokens, cost) {
      state.usage.push({ owner, at: Date.now(), cost });
    },
    async spendSince(owner, since) {
      return state.usage.filter((row) => row.owner === owner && row.at >= since.getTime()).reduce((sum, row) => sum + row.cost, 0);
    },
    async saveAsset(asset) {
      state.assets.push(asset);
    },
    async getAsset(owner, id) {
      return state.assets.find((asset) => asset.id === id && asset.ownerSub === owner) ?? null;
    },
    async listAssets(catalogId) {
      return state.assets.filter((asset) => asset.catalogId === catalogId);
    },
    async createJob(job) {
      state.jobs.push(job);
    },
    async updateJob(id, patch) {
      const job = state.jobs.find((item) => item.id === id);
      if (job) Object.assign(job, patch);
    },
    async getJob(owner, id) {
      return state.jobs.find((job) => job.id === id && job.ownerSub === owner) ?? null;
    },
    async listJobs(projectId) {
      return state.jobs.filter((job) => job.projectId === projectId);
    },
    async countJobs(projectId) {
      return state.jobs.filter((job) => job.projectId === projectId).length;
    },
  };
}
