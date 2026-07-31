import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { activities, contents, type ContentRow } from "../db/schema";
import { newId } from "./ids";
import { notFound } from "./http";

type Db = ReturnType<typeof getDb>;

/** Trilha de auditoria — nunca deve derrubar a requisição principal. */
export async function logActivity(
  db: Db,
  input: { clientId: string; contentId?: string | null; userId?: string | null; action: string; meta?: unknown }
) {
  try {
    await db.insert(activities).values({
      id: newId("act"),
      clientId: input.clientId,
      contentId: input.contentId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      meta: input.meta === undefined ? null : JSON.stringify(input.meta),
      createdAt: Date.now(),
    });
  } catch (error) {
    console.error("[activity]", error);
  }
}

export async function getContentOrThrow(db: Db, contentId: string): Promise<ContentRow> {
  const rows = await db.select().from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!rows.length) throw notFound("Conteúdo não encontrado.");
  return rows[0];
}

export async function getClientContent(db: Db, clientId: string, contentId: string) {
  const rows = await db
    .select()
    .from(contents)
    .where(and(eq(contents.id, contentId), eq(contents.clientId, clientId)))
    .limit(1);
  if (!rows.length) throw notFound("Conteúdo não encontrado.");
  return rows[0];
}

/** Converte a linha do banco no formato consumido pelo front. */
export function toContentDto(row: ContentRow) {
  return {
    ...row,
    platforms: safeJsonArray(row.platforms),
    archived: row.archived === 1,
  };
}

export function safeJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Descreve mudanças em português para o feed de atividade. */
export function describeChanges(before: ContentRow, patch: Record<string, unknown>): string[] {
  const labels: Record<string, string> = {
    title: "título", format: "formato", publishDate: "data", stageId: "etapa",
    pillarId: "pilar", funnelId: "funil", cta: "CTA", approval: "aprovação",
    priority: "prioridade", assigneeId: "responsável", platforms: "plataformas",
  };
  const out: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const label = labels[key];
    if (!label) continue;
    const previous = (before as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(previous) === JSON.stringify(value)) continue;
    out.push(label);
  }
  return out;
}
