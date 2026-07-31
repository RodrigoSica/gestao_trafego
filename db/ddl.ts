/**
 * DDL idempotente aplicado por `POST /api/bootstrap`.
 * Espelha `db/schema.ts` e permite subir o sistema em um D1 vazio
 * sem depender do pipeline de migrations do host.
 */
export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, external_id TEXT, email TEXT NOT NULL, name TEXT,
    role TEXT NOT NULL DEFAULT 'member', accent TEXT, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email)`,
  `CREATE INDEX IF NOT EXISTS users_external_idx ON users (external_id)`,

  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, tagline TEXT, initials TEXT,
    brand_primary TEXT NOT NULL DEFAULT '#e96f34', brand_accent TEXT NOT NULL DEFAULT '#5c75d8',
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo', status TEXT NOT NULL DEFAULT 'active',
    monthly_goal INTEGER NOT NULL DEFAULT 30, notes TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS clients_slug_idx ON clients (slug)`,

  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memberships_pair_idx ON memberships (client_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id)`,

  `CREATE TABLE IF NOT EXISTS stages (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'blue', position INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'production', wip_limit INTEGER)`,
  `CREATE INDEX IF NOT EXISTS stages_client_idx ON stages (client_id, position)`,

  `CREATE TABLE IF NOT EXISTS pillars (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'violet', description TEXT, position INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS pillars_client_idx ON pillars (client_id, position)`,

  `CREATE TABLE IF NOT EXISTS funnels (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'blue', position INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS funnels_client_idx ON funnels (client_id, position)`,

  `CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, title TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'Vídeo', publish_date TEXT NOT NULL, publish_time TEXT,
    stage_id TEXT NOT NULL, pillar_id TEXT, funnel_id TEXT,
    platforms TEXT NOT NULL DEFAULT '[]', cta TEXT, hook TEXT, script TEXT, notes TEXT,
    assignee_id TEXT, priority INTEGER NOT NULL DEFAULT 0, approval TEXT NOT NULL DEFAULT 'none',
    published_at INTEGER, permalink TEXT, archived INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0, created_by TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS contents_client_idx ON contents (client_id, archived)`,
  `CREATE INDEX IF NOT EXISTS contents_date_idx ON contents (client_id, publish_date)`,
  `CREATE INDEX IF NOT EXISTS contents_stage_idx ON contents (client_id, stage_id, position)`,

  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, content_id TEXT NOT NULL, name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image', mime TEXT, size INTEGER, storage_key TEXT, url TEXT,
    created_by TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS assets_content_idx ON assets (content_id)`,

  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, content_id TEXT NOT NULL, user_id TEXT NOT NULL,
    body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'comment', resolved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS comments_content_idx ON comments (content_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, content_id TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'Instagram', captured_at INTEGER NOT NULL,
    reach INTEGER NOT NULL DEFAULT 0, impressions INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0, saves INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0, leads INTEGER NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS metrics_content_idx ON metrics (content_id)`,
  `CREATE INDEX IF NOT EXISTS metrics_client_idx ON metrics (client_id, captured_at)`,

  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, content_id TEXT, user_id TEXT,
    action TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS activities_client_idx ON activities (client_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS publish_jobs (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, content_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'notify', run_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, idempotency_key TEXT NOT NULL, sent_at INTEGER, done_at INTEGER,
    created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_key_idx ON publish_jobs (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS publish_jobs_due_idx ON publish_jobs (status, run_at)`,
  `CREATE INDEX IF NOT EXISTS publish_jobs_client_idx ON publish_jobs (client_id, content_id)`,

  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'telegram',
    target TEXT NOT NULL, label TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS channels_client_idx ON channels (client_id, active)`,

  `CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY, client_id TEXT, name TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'Vídeo', hook TEXT, script TEXT, cta TEXT,
    platforms TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`,
];
