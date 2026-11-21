import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { randomBytes, randomUUID } from "node:crypto";
import { CATALOG } from "@/lib/catalog";
import { DEFAULT_SETTINGS, SettingsSchema, type BuildingSpec, type UserSettings } from "@/lib/schemas";
import type { AssetRow, JobRow, ListingRow, MessageRow, ProjectRow, SourceRow, Store } from "@/lib/db/types";

function dbUrl(): string {
  return process.env.MYSQL_URL || process.env.DATABASE_URL || "";
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: dbUrl(),
      connectionLimit: 8,
      timezone: "Z",
      decimalNumbers: true,
      dateStrings: true,
    });
  }
  return pool;
}

function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function now() {
  return new Date();
}

function mapProject(row: RowDataPacket): ProjectRow {
  return {
    id: row.id,
    ownerSub: row.owner_sub,
    name: row.name,
    currentVersion: Number(row.current_version),
    draft: row.draft_json ? json<BuildingSpec | null>(row.draft_json, null) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function migrateAndSeed(): Promise<void> {
  const conn = getPool();
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  let applied = new Set<string>();
  try {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id FROM schema_migrations");
    applied = new Set(rows.map((row) => String(row.id)));
  } catch {
    applied = new Set();
  }
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    const statements = sql.split(/;\s*$/m).map((part) => part.trim()).filter(Boolean);
    for (const statement of statements) {
      await conn.query(statement);
    }
    await conn.query("INSERT IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)", [file, now()]);
  }
  for (const item of CATALOG) {
    await conn.query(
      `INSERT INTO catalog_items
        (id, name, category, tags, dim_w, dim_l, dim_h, unit, base_price_etb, glb_path, price_query_en, price_query_am, color, kind, placeable, mount, cheaper_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), base_price_etb=VALUES(base_price_etb), glb_path=VALUES(glb_path), cheaper_id=VALUES(cheaper_id), tags=VALUES(tags)`,
      [
        item.id, item.name, item.category, JSON.stringify(item.tags), item.dimW, item.dimL, item.dimH, item.unit,
        item.basePriceEtb, item.glbPath, item.queryEn, item.queryAm, item.color, item.kind, item.placeable ? 1 : 0, item.mount, item.cheaperId,
      ],
    );
  }
  await conn.query(
    `INSERT IGNORE INTO price_sources
      (id, owner_sub, name, base_url, search_url_template, currency, categories, priority, refresh_hours, strategy, enabled, robots_ok, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      "00000000-0000-4000-8000-000000000001",
      "system",
      "Jiji Ethiopia",
      "https://jiji.com.et",
      "https://jiji.com.et/search?query={query}",
      "ETB",
      JSON.stringify(["equipment", "furniture", "openings", "utilities"]),
      10,
      12,
      "llm",
      1,
      null,
      "unknown",
      now(),
    ],
  );
}

function mapSource(row: RowDataPacket): SourceRow {
  return {
    id: row.id,
    ownerSub: row.owner_sub,
    name: row.name,
    baseUrl: row.base_url,
    searchUrlTemplate: row.search_url_template,
    currency: row.currency,
    categories: json<string[]>(row.categories, []),
    priority: Number(row.priority),
    refreshHours: Number(row.refresh_hours),
    strategy: row.strategy,
    enabled: Boolean(row.enabled),
    robotsOk: row.robots_ok == null ? null : Boolean(row.robots_ok),
    status: row.status,
    config: json<Record<string, unknown> | null>(row.config_json, null),
  };
}

export function createMysqlStore(): Store {
  const conn = getPool();
  return {
    persistence: "mysql",
    async listProjects(owner) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM projects WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT 40", [owner]);
      return rows.map(mapProject);
    },
    async createProject(owner, name) {
      const id = randomUUID();
      const stamp = now();
      await conn.query("INSERT INTO projects (id, owner_sub, name, current_version, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, owner, name.slice(0, 191), 0, stamp, stamp]);
      return (await this.getProject(owner, id)) as ProjectRow;
    },
    async getProject(owner, id) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM projects WHERE id = ? AND owner_sub = ?", [id, owner]);
      return rows[0] ? mapProject(rows[0]) : null;
    },
    async getProjectById(id) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM projects WHERE id = ?", [id]);
      return rows[0] ? mapProject(rows[0]) : null;
    },
    async renameProject(owner, id, name) {
      const [result] = await conn.query<mysql.ResultSetHeader>("UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND owner_sub = ?", [name.slice(0, 191), now(), id, owner]);
      return result.affectedRows > 0;
    },
    async setDraft(projectId, draft) {
      await conn.query("UPDATE projects SET draft_json = ?, updated_at = ? WHERE id = ?", [draft ? JSON.stringify(draft) : null, now(), projectId]);
    },
    async addMessage(input) {
      const id = randomUUID();
      await conn.query(
        "INSERT INTO messages (id, project_id, role, content, images_json, status, created_at) VALUES (?,?,?,?,?,?,?)",
        [id, input.projectId, input.role, input.content, input.images ? JSON.stringify(input.images) : null, input.status, now()],
      );
      return id;
    },
    async listMessages(projectId) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT id, project_id, role, content, status, created_at, images_json IS NOT NULL AS has_images FROM messages WHERE project_id = ? ORDER BY created_at ASC", [projectId]);
      return rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        role: row.role,
        content: row.content,
        status: row.status,
        hasImages: Boolean(row.has_images),
        createdAt: String(row.created_at),
      })) satisfies MessageRow[];
    },
    async latestPending(projectId) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM messages WHERE project_id = ? AND role = 'user' AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [projectId]);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, content: row.content, images: json(row.images_json, []) };
    },
    async setMessageStatus(id, status) {
      await conn.query("UPDATE messages SET status = ? WHERE id = ?", [status, id]);
    },
    async saveVersion(projectId, spec, objects, label) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT current_version, (SELECT COALESCE(MAX(version), 0) FROM scene_specs WHERE project_id = ?) AS max_version FROM projects WHERE id = ?", [projectId, projectId]);
      const current = Number(rows[0]?.current_version ?? 0);
      const version = Number(rows[0]?.max_version ?? 0) + 1;
      const parent = current > 0 ? current : null;
      await conn.query(
        "INSERT INTO scene_specs (id, project_id, version, parent_version, spec, label, created_at) VALUES (?,?,?,?,?,?,?)",
        [randomUUID(), projectId, version, parent, JSON.stringify(spec), label.slice(0, 191), now()],
      );
      if (objects.length) {
        const values: unknown[] = [];
        const tuples = objects.map((object) => {
          values.push(object.id, projectId, version, object.catalogId, object.x, object.y, object.z, object.rotationY, object.zone);
          return "(?,?,?,?,?,?,?,?,?)";
        });
        await conn.query(`INSERT INTO scene_objects (id, project_id, version, catalog_id, x, y, z, rotation_y, zone) VALUES ${tuples.join(",")}`, values);
      }
      await conn.query("UPDATE projects SET current_version = ?, draft_json = NULL, updated_at = ? WHERE id = ?", [version, now(), projectId]);
      return version;
    },
    async listVersions(projectId) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT version, parent_version, spec, label, created_at FROM scene_specs WHERE project_id = ? ORDER BY version ASC", [projectId]);
      return rows.map((row) => ({
        version: Number(row.version),
        parent: row.parent_version == null ? null : Number(row.parent_version),
        spec: json<BuildingSpec>(row.spec, {} as BuildingSpec),
        label: row.label,
        createdAt: String(row.created_at),
      }));
    },
    async readVersion(projectId, version) {
      const versions = await this.listVersions(projectId);
      return versions.find((row) => row.version === version) ?? null;
    },
    async setCurrentVersion(projectId, version) {
      await conn.query("UPDATE projects SET current_version = ?, updated_at = ? WHERE id = ?", [version, now(), projectId]);
    },
    async getSettings(owner) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM user_settings WHERE owner_sub = ?", [owner]);
      if (!rows[0]) return { ...DEFAULT_SETTINGS, bookmarks: [] };
      const row = rows[0];
      return SettingsSchema.parse({
        referencePhotoMode: row.reference_photo_mode,
        referencePhotoSource: row.reference_photo_source,
        currency: row.currency,
        priceMode: row.price_mode,
        dayNight: row.day_night,
        laborPct: Number(row.labor_pct),
        contingencyPct: Number(row.contingency_pct),
        usdEtbRate: Number(row.usd_etb_rate),
        bookmarks: json(row.bookmarks, []),
        theme: row.theme,
      });
    },
    async saveSettings(owner, settings: UserSettings) {
      await conn.query(
        `INSERT INTO user_settings
          (owner_sub, reference_photo_mode, reference_photo_source, currency, price_mode, day_night, labor_pct, contingency_pct, usd_etb_rate, bookmarks, theme)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
          reference_photo_mode=VALUES(reference_photo_mode), reference_photo_source=VALUES(reference_photo_source),
          currency=VALUES(currency), price_mode=VALUES(price_mode), day_night=VALUES(day_night),
          labor_pct=VALUES(labor_pct), contingency_pct=VALUES(contingency_pct), usd_etb_rate=VALUES(usd_etb_rate),
          bookmarks=VALUES(bookmarks), theme=VALUES(theme)`,
        [
          owner, settings.referencePhotoMode, settings.referencePhotoSource, settings.currency, settings.priceMode,
          settings.dayNight, settings.laborPct, settings.contingencyPct, settings.usdEtbRate, JSON.stringify(settings.bookmarks), settings.theme,
        ],
      );
    },
    async createShare(owner, projectId, version) {
      const token = randomBytes(24).toString("hex");
      await conn.query("INSERT INTO share_links (token, project_id, version, read_only, owner_sub, created_at) VALUES (?,?,?,?,?,?)", [token, projectId, version, 1, owner, now()]);
      return token;
    },
    async getShare(token) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT project_id, version, owner_sub FROM share_links WHERE token = ?", [token]);
      if (!rows[0]) return null;
      return { projectId: rows[0].project_id, version: Number(rows[0].version), ownerSub: rows[0].owner_sub };
    },
    async cacheGet(hash) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT payload FROM price_cache WHERE key_hash = ? AND expires_at > ?", [hash, now()]);
      if (!rows[0]) return null;
      return json(rows[0].payload, null);
    },
    async cacheSet(hash, payload, ttlHours) {
      const expires = new Date(Date.now() + ttlHours * 3600_000);
      await conn.query(
        "INSERT INTO price_cache (key_hash, payload, expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload), expires_at=VALUES(expires_at)",
        [hash, JSON.stringify(payload), expires],
      );
    },
    async listSources(owner) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM price_sources WHERE owner_sub IN ('system', ?) ORDER BY priority ASC", [owner]);
      return rows.map(mapSource);
    },
    async insertSource(source) {
      await conn.query(
        `INSERT INTO price_sources
          (id, owner_sub, name, base_url, search_url_template, currency, categories, priority, refresh_hours, strategy, enabled, robots_ok, status, config_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          source.id, source.ownerSub, source.name, source.baseUrl, source.searchUrlTemplate, source.currency,
          JSON.stringify(source.categories), source.priority, source.refreshHours, source.strategy, source.enabled ? 1 : 0,
          source.robotsOk == null ? null : source.robotsOk ? 1 : 0, source.status, source.config ? JSON.stringify(source.config) : null, now(),
        ],
      );
    },
    async updateSource(id, patch) {
      const current = await conn.query<RowDataPacket[]>("SELECT * FROM price_sources WHERE id = ?", [id]).then(([rows]) => rows[0]);
      if (!current) return;
      const next = { ...mapSource(current), ...patch };
      await conn.query(
        `UPDATE price_sources SET name=?, base_url=?, search_url_template=?, currency=?, categories=?, priority=?, refresh_hours=?, strategy=?, enabled=?, robots_ok=?, status=?, config_json=? WHERE id=?`,
        [
          next.name, next.baseUrl, next.searchUrlTemplate, next.currency, JSON.stringify(next.categories), next.priority, next.refreshHours,
          next.strategy, next.enabled ? 1 : 0, next.robotsOk == null ? null : next.robotsOk ? 1 : 0, next.status, next.config ? JSON.stringify(next.config) : null, id,
        ],
      );
    },
    async replaceListings(sourceId, catalogId, listings) {
      await conn.query("DELETE FROM listings WHERE source_id = ? AND catalog_id = ?", [sourceId, catalogId]);
      for (const listing of listings) {
        await conn.query(
          `INSERT INTO listings (id, source_id, catalog_id, title, price, currency, url, host, image_url, \`condition\`, unit, relevance, fetched_at, stale)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
          [randomUUID(), sourceId, catalogId, listing.title.slice(0, 512), listing.price, listing.currency, listing.url.slice(0, 1024), listing.host.slice(0, 255), null, listing.condition, null, listing.relevance, now()],
        );
      }
    },
    async listListings(catalogId) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM listings WHERE catalog_id = ? ORDER BY fetched_at DESC LIMIT 20", [catalogId]);
      return rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        catalogId: row.catalog_id,
        title: row.title,
        price: Number(row.price),
        currency: row.currency,
        url: row.url,
        host: row.host,
        condition: row.condition,
        relevance: Number(row.relevance),
        fetchedAt: String(row.fetched_at),
        stale: Boolean(row.stale),
      })) satisfies ListingRow[];
    },
    async markListingStale(id) {
      await conn.query("UPDATE listings SET stale = 1 WHERE id = ?", [id]);
    },
    async addSnapshot(input) {
      await conn.query(
        `INSERT INTO price_snapshots (id, catalog_id, currency, min_price, median_price, max_price, listing_count, confidence, captured_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), input.catalogId, input.currency, input.min, input.median, input.max, input.count, input.confidence, now()],
      );
    },
    async logUsage(owner, ipHash, tokens, costUsd, kind) {
      await conn.query("INSERT INTO usage_log (id, owner_sub, ip_hash, tokens, cost_usd, kind, created_at) VALUES (?,?,?,?,?,?,?)", [randomUUID(), owner, ipHash, tokens, costUsd, kind, now()]);
    },
    async spendSince(owner, since) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM usage_log WHERE owner_sub = ? AND created_at >= ?", [owner, since]);
      return Number(rows[0]?.spent ?? 0);
    },
    async saveAsset(asset: AssetRow) {
      await conn.query(
        `INSERT INTO assets (id, owner_sub, project_id, object_id, catalog_id, source_tier, path, thumbnail, license, attribution, fidelity, poly_count, hash, dim_w, dim_l, dim_h, mime, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [asset.id, asset.ownerSub, asset.projectId, asset.objectId, asset.catalogId, asset.sourceTier, asset.path, asset.thumbnail, asset.license, asset.attribution, asset.fidelity, asset.polyCount, null, null, null, null, asset.mime, now()],
      );
    },
    async getAsset(owner, id) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM assets WHERE id = ? AND owner_sub = ?", [id, owner]);
      return rows[0] ? mapAsset(rows[0]) : null;
    },
    async listAssets(catalogId) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM assets WHERE catalog_id = ? ORDER BY created_at DESC LIMIT 8", [catalogId]);
      return rows.map(mapAsset);
    },
    async createJob(job) {
      await conn.query(
        `INSERT INTO jobs (id, owner_sub, project_id, catalog_id, object_id, provider, status, progress, result_path, error, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [job.id, job.ownerSub, job.projectId, job.catalogId, job.objectId, job.provider, job.status, job.progress, job.resultPath, job.error, now(), now()],
      );
    },
    async updateJob(id, patch) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM jobs WHERE id = ?", [id]);
      if (!rows[0]) return;
      const status = patch.status ?? rows[0].status;
      const progress = patch.progress ?? rows[0].progress;
      const resultPath = patch.resultPath === undefined ? rows[0].result_path : patch.resultPath;
      const error = patch.error === undefined ? rows[0].error : patch.error;
      await conn.query("UPDATE jobs SET status=?, progress=?, result_path=?, error=?, updated_at=? WHERE id=?", [status, progress, resultPath, error, now(), id]);
    },
    async getJob(owner, id) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM jobs WHERE id = ? AND owner_sub = ?", [id, owner]);
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async listJobs(projectId) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC", [projectId]);
      return rows.map(mapJob);
    },
    async countJobs(projectId) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM jobs WHERE project_id = ?", [projectId]);
      return Number(rows[0]?.n ?? 0);
    },
  };
}

function mapAsset(row: RowDataPacket): AssetRow {
  return {
    id: row.id,
    ownerSub: row.owner_sub,
    projectId: row.project_id,
    objectId: row.object_id,
    catalogId: row.catalog_id,
    sourceTier: Number(row.source_tier),
    path: row.path,
    thumbnail: row.thumbnail,
    license: row.license,
    attribution: row.attribution,
    fidelity: row.fidelity,
    polyCount: row.poly_count == null ? null : Number(row.poly_count),
    mime: row.mime,
  };
}

function mapJob(row: RowDataPacket): JobRow {
  return {
    id: row.id,
    projectId: row.project_id,
    catalogId: row.catalog_id,
    objectId: row.object_id,
    provider: row.provider,
    status: row.status,
    progress: Number(row.progress),
    resultPath: row.result_path,
    error: row.error,
  };
}

export function mysqlConfigured(): boolean {
  return Boolean(dbUrl());
}
