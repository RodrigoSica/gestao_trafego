import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { contents, funnels, metrics, pillars, stages } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { ok, route } from "../../../../../lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clientId: string }> };

/**
 * Agregações de desempenho calculadas no banco — o front só desenha.
 * Base do painel de Resultados: volume por etapa/pilar/funil, ritmo mensal
 * e o desempenho consolidado dos conteúdos que já têm métrica registrada.
 */
export async function GET(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId);

    const days = Math.min(Number(new URL(request.url).searchParams.get("days") ?? 90) || 90, 365);
    const since = Date.now() - days * 86_400_000;
    const scope = and(eq(contents.clientId, clientId), eq(contents.archived, 0));

    const [byStage, byPillar, byFunnel, byMonth, totals, top] = await Promise.all([
      db
        .select({ id: stages.id, name: stages.name, color: stages.color, total: sql<number>`count(${contents.id})` })
        .from(stages)
        .leftJoin(contents, and(eq(contents.stageId, stages.id), eq(contents.archived, 0)))
        .where(eq(stages.clientId, clientId))
        .groupBy(stages.id)
        .orderBy(stages.position),
      db
        .select({ id: pillars.id, name: pillars.name, color: pillars.color, total: sql<number>`count(${contents.id})` })
        .from(pillars)
        .leftJoin(contents, and(eq(contents.pillarId, pillars.id), eq(contents.archived, 0)))
        .where(eq(pillars.clientId, clientId))
        .groupBy(pillars.id)
        .orderBy(pillars.position),
      db
        .select({ id: funnels.id, name: funnels.name, color: funnels.color, total: sql<number>`count(${contents.id})` })
        .from(funnels)
        .leftJoin(contents, and(eq(contents.funnelId, funnels.id), eq(contents.archived, 0)))
        .where(eq(funnels.clientId, clientId))
        .groupBy(funnels.id)
        .orderBy(funnels.position),
      db
        .select({
          month: sql<string>`substr(${contents.publishDate}, 1, 7)`,
          total: sql<number>`count(*)`,
          published: sql<number>`sum(case when ${contents.publishedAt} is not null then 1 else 0 end)`,
        })
        .from(contents)
        .where(scope)
        .groupBy(sql`substr(${contents.publishDate}, 1, 7)`)
        .orderBy(sql`substr(${contents.publishDate}, 1, 7)`),
      db
        .select({
          reach: sql<number>`coalesce(sum(${metrics.reach}), 0)`,
          impressions: sql<number>`coalesce(sum(${metrics.impressions}), 0)`,
          saves: sql<number>`coalesce(sum(${metrics.saves}), 0)`,
          clicks: sql<number>`coalesce(sum(${metrics.clicks}), 0)`,
          leads: sql<number>`coalesce(sum(${metrics.leads}), 0)`,
          revenue: sql<number>`coalesce(sum(${metrics.revenue}), 0)`,
          samples: sql<number>`count(*)`,
        })
        .from(metrics)
        .where(and(eq(metrics.clientId, clientId), gte(metrics.capturedAt, since))),
      db
        .select({
          id: contents.id,
          title: contents.title,
          format: contents.format,
          reach: sql<number>`coalesce(sum(${metrics.reach}), 0)`,
          leads: sql<number>`coalesce(sum(${metrics.leads}), 0)`,
          revenue: sql<number>`coalesce(sum(${metrics.revenue}), 0)`,
        })
        .from(metrics)
        .innerJoin(contents, eq(contents.id, metrics.contentId))
        .where(eq(metrics.clientId, clientId))
        .groupBy(contents.id)
        .orderBy(sql`sum(${metrics.reach}) desc`)
        .limit(8),
    ]);

    const t = totals[0];
    return ok({
      byStage: byStage.map((r) => ({ ...r, total: Number(r.total) })),
      byPillar: byPillar.map((r) => ({ ...r, total: Number(r.total) })),
      byFunnel: byFunnel.map((r) => ({ ...r, total: Number(r.total) })),
      byMonth: byMonth.map((r) => ({ ...r, total: Number(r.total), published: Number(r.published) })),
      performance: {
        reach: Number(t?.reach ?? 0),
        impressions: Number(t?.impressions ?? 0),
        saves: Number(t?.saves ?? 0),
        clicks: Number(t?.clicks ?? 0),
        leads: Number(t?.leads ?? 0),
        revenue: Number(t?.revenue ?? 0),
        samples: Number(t?.samples ?? 0),
        ctr: Number(t?.impressions ?? 0) > 0 ? Number(t.clicks) / Number(t.impressions) : 0,
      },
      topContents: top.map((r) => ({ ...r, reach: Number(r.reach), leads: Number(r.leads), revenue: Number(r.revenue) })),
      windowDays: days,
    });
  });
}
