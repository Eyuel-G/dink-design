import type { BuildingSpec, UserSettings } from "@/lib/schemas";
import type { PlacedObject } from "@/lib/layout/place";

export interface ProjectRow {
  id: string;
  ownerSub: string;
  name: string;
  currentVersion: number;
  draft: BuildingSpec | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "done";
  hasImages: boolean;
  createdAt: string;
}

export interface VersionRow {
  version: number;
  parent: number | null;
  spec: BuildingSpec;
  label: string;
  createdAt: string;
}

export interface SourceRow {
  id: string;
  ownerSub: string;
  name: string;
  baseUrl: string;
  searchUrlTemplate: string;
  currency: string;
  categories: string[];
  priority: number;
  refreshHours: number;
  strategy: string;
  enabled: boolean;
  robotsOk: boolean | null;
  status: string;
  config: Record<string, unknown> | null;
}

export interface ListingRow {
  id: string;
  sourceId: string;
  catalogId: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  host: string;
  condition: "new" | "used" | "unknown";
  relevance: number;
  fetchedAt: string;
  stale: boolean;
}

export interface AssetRow {
  id: string;
  ownerSub: string;
  projectId: string | null;
  objectId: string | null;
  catalogId: string;
  sourceTier: number;
  path: string;
  thumbnail: string | null;
  license: string | null;
  attribution: string | null;
  fidelity: "representative" | "generated" | "exact";
  polyCount: number | null;
  mime: string | null;
}

export interface JobRow {
  id: string;
  projectId: string;
  catalogId: string;
  objectId: string | null;
  provider: string;
  status: string;
  progress: number;
  resultPath: string | null;
  error: string | null;
}

export interface Store {
  persistence: "mysql" | "memory";
  listProjects(owner: string): Promise<ProjectRow[]>;
  createProject(owner: string, name: string): Promise<ProjectRow>;
  getProject(owner: string, id: string): Promise<ProjectRow | null>;
  getProjectById(id: string): Promise<ProjectRow | null>;
  renameProject(owner: string, id: string, name: string): Promise<boolean>;
  setDraft(projectId: string, draft: BuildingSpec | null): Promise<void>;
  addMessage(input: { projectId: string; role: "user" | "assistant"; content: string; images?: { mime: string; data: string }[] | null; status: "pending" | "done" }): Promise<string>;
  listMessages(projectId: string): Promise<MessageRow[]>;
  latestPending(projectId: string): Promise<{ id: string; content: string; images: { mime: string; data: string }[] } | null>;
  setMessageStatus(id: string, status: "pending" | "done"): Promise<void>;
  saveVersion(projectId: string, spec: BuildingSpec, objects: PlacedObject[], label: string): Promise<number>;
  listVersions(projectId: string): Promise<VersionRow[]>;
  readVersion(projectId: string, version: number): Promise<VersionRow | null>;
  setCurrentVersion(projectId: string, version: number): Promise<void>;
  getSettings(owner: string): Promise<UserSettings>;
  saveSettings(owner: string, settings: UserSettings): Promise<void>;
  createShare(owner: string, projectId: string, version: number): Promise<string>;
  getShare(token: string): Promise<{ projectId: string; version: number; ownerSub: string } | null>;
  cacheGet<T>(hash: string): Promise<T | null>;
  cacheSet(hash: string, payload: unknown, ttlHours: number): Promise<void>;
  listSources(owner: string): Promise<SourceRow[]>;
  insertSource(source: SourceRow): Promise<void>;
  updateSource(id: string, patch: Partial<SourceRow>): Promise<void>;
  replaceListings(sourceId: string, catalogId: string, listings: Omit<ListingRow, "id" | "fetchedAt" | "stale">[]): Promise<void>;
  listListings(catalogId: string): Promise<ListingRow[]>;
  markListingStale(id: string): Promise<void>;
  addSnapshot(input: { catalogId: string; currency: string; min: number | null; median: number | null; max: number | null; count: number; confidence: string }): Promise<void>;
  logUsage(owner: string, ipHash: string, tokens: number, costUsd: number, kind: string): Promise<void>;
  spendSince(owner: string, since: Date): Promise<number>;
  saveAsset(asset: AssetRow): Promise<void>;
  getAsset(owner: string, id: string): Promise<AssetRow | null>;
  listAssets(catalogId: string): Promise<AssetRow[]>;
  createJob(job: JobRow & { ownerSub: string }): Promise<void>;
  updateJob(id: string, patch: Partial<JobRow>): Promise<void>;
  getJob(owner: string, id: string): Promise<JobRow | null>;
  listJobs(projectId: string): Promise<JobRow[]>;
  countJobs(projectId: string): Promise<number>;
}
