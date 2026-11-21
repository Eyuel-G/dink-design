CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(191) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  owner_sub VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  current_version INT NOT NULL DEFAULT 0,
  draft_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_projects_owner (owner_sub, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  content TEXT NOT NULL,
  images_json MEDIUMTEXT NULL,
  status ENUM('pending','done') NOT NULL DEFAULT 'done',
  created_at DATETIME(3) NOT NULL,
  INDEX idx_messages_project (project_id, created_at),
  CONSTRAINT fk_messages_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scene_specs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  parent_version INT NULL,
  spec JSON NOT NULL,
  label VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_spec_version (project_id, version),
  CONSTRAINT fk_specs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scene_objects (
  id VARCHAR(80) NOT NULL,
  project_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  catalog_id VARCHAR(64) NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  z DOUBLE NOT NULL,
  rotation_y DOUBLE NOT NULL,
  zone VARCHAR(64) NULL,
  PRIMARY KEY (project_id, version, id),
  CONSTRAINT fk_objects_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assets (
  id CHAR(36) PRIMARY KEY,
  owner_sub VARCHAR(191) NOT NULL,
  project_id CHAR(36) NULL,
  object_id VARCHAR(80) NULL,
  catalog_id VARCHAR(64) NOT NULL,
  source_tier TINYINT NOT NULL,
  path VARCHAR(512) NOT NULL,
  thumbnail VARCHAR(512) NULL,
  license VARCHAR(128) NULL,
  attribution TEXT NULL,
  fidelity ENUM('representative','generated','exact') NOT NULL,
  poly_count INT NULL,
  hash CHAR(64) NULL,
  dim_w DOUBLE NULL,
  dim_l DOUBLE NULL,
  dim_h DOUBLE NULL,
  mime VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_assets_catalog (catalog_id),
  INDEX idx_assets_owner (owner_sub, project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_items (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  category VARCHAR(64) NOT NULL,
  tags JSON NOT NULL,
  dim_w DOUBLE NOT NULL,
  dim_l DOUBLE NOT NULL,
  dim_h DOUBLE NOT NULL,
  unit VARCHAR(16) NOT NULL,
  base_price_etb DECIMAL(14,2) NOT NULL,
  glb_path VARCHAR(512) NULL,
  price_query_en VARCHAR(255) NOT NULL,
  price_query_am VARCHAR(255) NOT NULL,
  color VARCHAR(16) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  placeable TINYINT(1) NOT NULL,
  mount VARCHAR(16) NOT NULL,
  cheaper_id VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_sources (
  id CHAR(36) PRIMARY KEY,
  owner_sub VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  search_url_template VARCHAR(1024) NOT NULL,
  currency CHAR(3) NOT NULL,
  categories JSON NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  refresh_hours INT NOT NULL DEFAULT 12,
  strategy VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  robots_ok TINYINT(1) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  config_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_sources_owner (owner_sub, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listings (
  id CHAR(36) PRIMARY KEY,
  source_id CHAR(36) NOT NULL,
  catalog_id VARCHAR(64) NOT NULL,
  title VARCHAR(512) NOT NULL,
  price DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  url VARCHAR(1024) NOT NULL,
  host VARCHAR(255) NOT NULL,
  image_url VARCHAR(1024) NULL,
  `condition` ENUM('new','used','unknown') NOT NULL,
  unit VARCHAR(32) NULL,
  relevance DOUBLE NOT NULL,
  fetched_at DATETIME(3) NOT NULL,
  stale TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_listings_catalog (catalog_id, fetched_at),
  CONSTRAINT fk_listings_source FOREIGN KEY (source_id) REFERENCES price_sources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_snapshots (
  id CHAR(36) PRIMARY KEY,
  catalog_id VARCHAR(64) NOT NULL,
  currency CHAR(3) NOT NULL,
  min_price DECIMAL(14,2) NULL,
  median_price DECIMAL(14,2) NULL,
  max_price DECIMAL(14,2) NULL,
  listing_count INT NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  INDEX idx_snap (catalog_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_cache (
  key_hash VARCHAR(96) PRIMARY KEY,
  payload JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  INDEX idx_cache_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_settings (
  owner_sub VARCHAR(191) PRIMARY KEY,
  reference_photo_mode VARCHAR(16) NOT NULL,
  reference_photo_source VARCHAR(16) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  price_mode VARCHAR(16) NOT NULL,
  day_night VARCHAR(8) NOT NULL,
  labor_pct DOUBLE NOT NULL,
  contingency_pct DOUBLE NOT NULL,
  usd_etb_rate DOUBLE NOT NULL,
  bookmarks JSON NOT NULL,
  theme VARCHAR(8) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS share_links (
  token CHAR(48) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  read_only TINYINT(1) NOT NULL DEFAULT 1,
  owner_sub VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_share_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usage_log (
  id CHAR(36) PRIMARY KEY,
  owner_sub VARCHAR(191) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  tokens INT NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  kind VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_usage_owner (owner_sub, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id CHAR(36) PRIMARY KEY,
  owner_sub VARCHAR(191) NOT NULL,
  project_id CHAR(36) NOT NULL,
  catalog_id VARCHAR(64) NOT NULL,
  object_id VARCHAR(80) NULL,
  provider VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  result_path VARCHAR(512) NULL,
  error VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_jobs_project (project_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
