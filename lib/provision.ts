/**
 * Provisionamento de clientes: cria a conta com uma taxonomia inicial
 * (etapas de fluxo, pilares e funil) que o operador pode reconfigurar depois.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { FORJA_PLAN } from "../db/seed-forja";
import {
  clients, stages, pillars, funnels, contents, memberships,
  type ClientRow, type StageRow, type PillarRow, type FunnelRow,
} from "../db/schema";
import { newId, slugify, initialsOf } from "./ids";
import { conflict } from "./http";

type Db = ReturnType<typeof getDb>;

export const DEFAULT_STAGES: Array<[string, string, string]> = [
  ["Ideias", "slate", "backlog"],
  ["Captação", "orange", "production"],
  ["Em edição", "blue", "production"],
  ["Revisão", "amber", "review"],
  ["Agendado", "teal", "scheduled"],
  ["Publicado", "green", "done"],
];

export const DEFAULT_FUNNELS: Array<[string, string]> = [
  ["Descoberta", "blue"],
  ["Consideração", "amber"],
  ["Conversão", "red"],
  ["Pós-venda", "violet"],
  ["Autoridade", "teal"],
  ["Confiança", "violet"],
];

export const DEFAULT_PILLARS: Array<[string, string]> = [
  ["Marca", "violet"],
  ["Autoridade", "teal"],
  ["Confiança", "blue"],
  ["Bastidores", "amber"],
  ["Ofertas", "red"],
];

/** Pilares específicos da Forja do Sica. */
const FORJA_PILLARS: Array<[string, string]> = [
  ["Guias e Orixás", "violet"],
  ["Personalizados", "orange"],
  ["Autoridade", "teal"],
  ["Confiança", "blue"],
  ["Marca", "red"],
];

export type NewClientInput = {
  name: string;
  slug?: string;
  tagline?: string | null;
  brandPrimary?: string;
  brandAccent?: string;
  timezone?: string;
  monthlyGoal?: number;
  pillarNames?: string[];
};

export async function createClient(
  db: Db,
  ownerUserId: string,
  input: NewClientInput
): Promise<{ client: ClientRow; stages: StageRow[]; pillars: PillarRow[]; funnels: FunnelRow[] }> {
  const slug = slugify(input.slug || input.name);
  const clash = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
  if (clash.length) throw conflict(`Já existe um cliente com o identificador "${slug}".`);

  const stamp = Date.now();
  const client: ClientRow = {
    id: newId("cli"),
    slug,
    name: input.name,
    tagline: input.tagline ?? null,
    initials: initialsOf(input.name),
    brandPrimary: input.brandPrimary ?? "#e96f34",
    brandAccent: input.brandAccent ?? "#5c75d8",
    timezone: input.timezone ?? "America/Sao_Paulo",
    status: "active",
    monthlyGoal: input.monthlyGoal ?? 30,
    notes: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  const stageRows: StageRow[] = DEFAULT_STAGES.map(([name, color, kind], i) => ({
    id: newId("stg"), clientId: client.id, name, color, position: i, kind, wipLimit: null,
  }));
  const funnelRows: FunnelRow[] = DEFAULT_FUNNELS.map(([name, color], i) => ({
    id: newId("fnl"), clientId: client.id, name, color, position: i,
  }));
  const pillarSource = input.pillarNames?.length
    ? input.pillarNames.map((name, i) => [name, DEFAULT_PILLARS[i % DEFAULT_PILLARS.length][1]] as [string, string])
    : DEFAULT_PILLARS;
  const pillarRows: PillarRow[] = pillarSource.map(([name, color], i) => ({
    id: newId("plr"), clientId: client.id, name, color, description: null, position: i,
  }));

  await db.insert(clients).values(client);
  await db.insert(stages).values(stageRows);
  await db.insert(funnels).values(funnelRows);
  await db.insert(pillars).values(pillarRows);
  await db.insert(memberships).values({
    id: newId("mem"), clientId: client.id, userId: ownerUserId, role: "owner", createdAt: stamp,
  });

  return { client, stages: stageRows, pillars: pillarRows, funnels: funnelRows };
}

/**
 * Cria a conta da Forja do Sica com a pauta editorial de 60 conteúdos.
 * Idempotente: se o slug já existe, não faz nada.
 */
export async function seedForja(db: Db, ownerUserId: string): Promise<ClientRow | null> {
  const existing = await db.select().from(clients).where(eq(clients.slug, "forja-do-sica")).limit(1);
  if (existing.length) return null;

  const { client, stages: stageRows, pillars: pillarRows, funnels: funnelRows } = await createClient(
    db,
    ownerUserId,
    {
      name: "Forja do Sica",
      slug: "forja-do-sica",
      tagline: "Estúdio criativo — esculturas que guardam histórias",
      brandPrimary: "#e96f34",
      brandAccent: "#5c75d8",
      monthlyGoal: 30,
      pillarNames: FORJA_PILLARS.map(([name]) => name),
    }
  );

  // Tudo entra na primeira etapa. A versão anterior espalhava os conteúdos
  // pelo fluxo por índice, o que fazia o painel afirmar que havia gravação e
  // edição em andamento antes de qualquer peça existir.
  const firstStageId = stageRows[0].id;
  const pillarId = (name: string) => pillarRows.find((p) => p.name === name)?.id ?? null;
  const funnelId = (name: string) => funnelRows.find((f) => f.name === name)?.id ?? null;

  const stamp = Date.now();
  const rows = FORJA_PLAN.map(([date, format, title, funnel, pillar, cta], i) => ({
    id: newId("cnt"),
    clientId: client.id,
    title,
    format,
    publishDate: date,
    publishTime: null,
    stageId: firstStageId,
    pillarId: pillarId(pillar),
    funnelId: funnelId(funnel),
    platforms: JSON.stringify(format === "Vídeo" ? ["Instagram", "TikTok"] : ["Instagram"]),
    cta,
    hook: null,
    script: null,
    notes: null,
    assigneeId: null,
    priority: 0,
    approval: "none",
    publishedAt: null,
    permalink: null,
    archived: 0,
    position: i,
    createdBy: ownerUserId,
    createdAt: stamp,
    updatedAt: stamp,
  }));

  // D1 aceita no máximo 100 parâmetros por statement; são 24 colunas por linha.
  const CHUNK = 4;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(contents).values(rows.slice(i, i + CHUNK));
  }
  return client;
}

export async function countClients(db: Db): Promise<number> {
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(clients);
  return Number(total);
}
