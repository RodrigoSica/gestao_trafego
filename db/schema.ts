/**
 * Sicheroli Studio OS — esquema multi-tenant.
 *
 * Hierarquia: users → memberships → clients → (stages | pillars | funnels) → contents
 * Cada cliente carrega a própria taxonomia (etapas de fluxo, pilares, funil),
 * o que permite operar contas com processos editoriais completamente distintos.
 */
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const pk = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();

/* ------------------------------------------------------------------ pessoas */

export const users = sqliteTable("users", {
  id: pk(),
  externalId: text("external_id"),
  email: text("email").notNull(),
  name: text("name"),
  /** owner = Rodrigo. admin = operação. member = produção. client = aprovador externo. */
  role: text("role").notNull().default("member"),
  accent: text("accent"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
  index("users_external_idx").on(t.externalId),
]);

export const clients = sqliteTable("clients", {
  id: pk(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  initials: text("initials"),
  brandPrimary: text("brand_primary").notNull().default("#e96f34"),
  brandAccent: text("brand_accent").notNull().default("#5c75d8"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  /** active | paused | archived */
  status: text("status").notNull().default("active"),
  /** meta de conteúdos publicados por mês — alimenta o painel de ritmo */
  monthlyGoal: integer("monthly_goal").notNull().default(30),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("clients_slug_idx").on(t.slug)]);

export const memberships = sqliteTable("memberships", {
  id: pk(),
  clientId: text("client_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("memberships_pair_idx").on(t.clientId, t.userId),
  index("memberships_user_idx").on(t.userId),
]);

/* -------------------------------------------------------------- taxonomias */

/** Etapas do fluxo de produção — kanban configurável por cliente. */
export const stages = sqliteTable("stages", {
  id: pk(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  position: integer("position").notNull().default(0),
  /** backlog | production | review | scheduled | done */
  kind: text("kind").notNull().default("production"),
  wipLimit: integer("wip_limit"),
}, (t) => [index("stages_client_idx").on(t.clientId, t.position)]);

/** Pilares editoriais (temas recorrentes da marca). */
export const pillars = sqliteTable("pillars", {
  id: pk(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("violet"),
  description: text("description"),
  position: integer("position").notNull().default(0),
}, (t) => [index("pillars_client_idx").on(t.clientId, t.position)]);

/** Etapas de funil (Descoberta, Consideração, Conversão...). */
export const funnels = sqliteTable("funnels", {
  id: pk(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  position: integer("position").notNull().default(0),
}, (t) => [index("funnels_client_idx").on(t.clientId, t.position)]);

/* ---------------------------------------------------------------- conteúdo */

export const contents = sqliteTable("contents", {
  id: pk(),
  clientId: text("client_id").notNull(),
  title: text("title").notNull(),
  format: text("format").notNull().default("Vídeo"),
  /** ISO YYYY-MM-DD — data planejada de publicação */
  publishDate: text("publish_date").notNull(),
  publishTime: text("publish_time"),
  stageId: text("stage_id").notNull(),
  pillarId: text("pillar_id"),
  funnelId: text("funnel_id"),
  /** JSON array de plataformas */
  platforms: text("platforms").notNull().default("[]"),
  cta: text("cta"),
  hook: text("hook"),
  script: text("script"),
  notes: text("notes"),
  assigneeId: text("assignee_id"),
  /** 0 = normal, 1 = alta, 2 = urgente */
  priority: integer("priority").notNull().default(0),
  /** none | pending | approved | changes */
  approval: text("approval").notNull().default("none"),
  publishedAt: integer("published_at"),
  permalink: text("permalink"),
  archived: integer("archived").notNull().default(0),
  position: real("position").notNull().default(0),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("contents_client_idx").on(t.clientId, t.archived),
  index("contents_date_idx").on(t.clientId, t.publishDate),
  index("contents_stage_idx").on(t.clientId, t.stageId, t.position),
]);

export const assets = sqliteTable("assets", {
  id: pk(),
  clientId: text("client_id").notNull(),
  contentId: text("content_id").notNull(),
  name: text("name").notNull(),
  /** image | video | audio | doc | link */
  kind: text("kind").notNull().default("image"),
  mime: text("mime"),
  size: integer("size"),
  /** chave no bucket R2 (uploads) ou URL externa */
  storageKey: text("storage_key"),
  url: text("url"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
}, (t) => [index("assets_content_idx").on(t.contentId)]);

export const comments = sqliteTable("comments", {
  id: pk(),
  clientId: text("client_id").notNull(),
  contentId: text("content_id").notNull(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  /** comment | approval | changes */
  kind: text("kind").notNull().default("comment"),
  resolved: integer("resolved").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("comments_content_idx").on(t.contentId, t.createdAt)]);

export const metrics = sqliteTable("metrics", {
  id: pk(),
  clientId: text("client_id").notNull(),
  contentId: text("content_id").notNull(),
  platform: text("platform").notNull().default("Instagram"),
  capturedAt: integer("captured_at").notNull(),
  reach: integer("reach").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  revenue: real("revenue").notNull().default(0),
}, (t) => [
  index("metrics_content_idx").on(t.contentId),
  index("metrics_client_idx").on(t.clientId, t.capturedAt),
]);

/** Trilha de auditoria — quem mudou o quê, quando. */
export const activities = sqliteTable("activities", {
  id: pk(),
  clientId: text("client_id").notNull(),
  contentId: text("content_id"),
  userId: text("user_id"),
  action: text("action").notNull(),
  meta: text("meta"),
  createdAt: createdAt(),
}, (t) => [index("activities_client_idx").on(t.clientId, t.createdAt)]);

/** Receitas reutilizáveis de conteúdo — aceleram a criação de pauta. */
export const templates = sqliteTable("templates", {
  id: pk(),
  /** null = template global do estúdio, disponível para todos os clientes */
  clientId: text("client_id"),
  name: text("name").notNull(),
  format: text("format").notNull().default("Vídeo"),
  hook: text("hook"),
  script: text("script"),
  cta: text("cta"),
  platforms: text("platforms").notNull().default("[]"),
  createdAt: createdAt(),
});

export type UserRow = typeof users.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type StageRow = typeof stages.$inferSelect;
export type PillarRow = typeof pillars.$inferSelect;
export type FunnelRow = typeof funnels.$inferSelect;
export type ContentRow = typeof contents.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type MetricRow = typeof metrics.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
