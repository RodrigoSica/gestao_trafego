import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { contents, stages } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { logActivity, toContentDto } from "../../../../../lib/data";
import { badRequest, ok, parse, parsePartial, readJson, route, v } from "../../../../../lib/http";
import { newId } from "../../../../../lib/ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clientId: string }> };

/** Listagem filtrada e paginada. Filtros: stage, pillar, funnel, from, to, q, archived. */
export async function GET(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId);

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 500);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

    const filters = [
      eq(contents.clientId, clientId),
      eq(contents.archived, url.searchParams.get("archived") === "1" ? 1 : 0),
    ];
    const stage = url.searchParams.get("stage");
    const pillar = url.searchParams.get("pillar");
    const funnel = url.searchParams.get("funnel");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (stage) filters.push(eq(contents.stageId, stage));
    if (pillar) filters.push(eq(contents.pillarId, pillar));
    if (funnel) filters.push(eq(contents.funnelId, funnel));
    if (from) filters.push(gte(contents.publishDate, from));
    if (to) filters.push(lte(contents.publishDate, to));
    if (q) filters.push(sql`lower(${contents.title}) like ${"%" + q + "%"}`);

    const rows = await db
      .select()
      .from(contents)
      .where(and(...filters))
      .orderBy(asc(contents.publishDate))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(contents)
      .where(and(...filters));

    return ok({ contents: rows.map(toContentDto), total: Number(total), limit, offset });
  });
}

const createShape = {
  title: v.string({ min: 1, max: 180 }),
  format: v.string({ min: 1, max: 40 }),
  publishDate: v.date(),
  stageId: v.string({ min: 1, max: 40 }),
  pillarId: v.string({ min: 0, max: 40 }),
  funnelId: v.string({ min: 0, max: 40 }),
  platforms: v.stringArray({ max: 10 }),
  cta: v.string({ min: 0, max: 180 }),
  hook: v.string({ min: 0, max: 400 }),
  script: v.string({ min: 0, max: 8000 }),
  notes: v.string({ min: 0, max: 8000 }),
  priority: v.int({ min: 0, max: 2 }),
};

export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const body = (await readJson(request)) as Record<string, unknown>;
    const first = await db
      .select({ id: stages.id })
      .from(stages)
      .where(eq(stages.clientId, clientId))
      .orderBy(asc(stages.position))
      .limit(1);

    const input = parse(createShape, {
      format: "Vídeo", pillarId: "", funnelId: "", platforms: ["Instagram"],
      cta: "", hook: "", script: "", notes: "", priority: 0,
      stageId: first[0]?.id ?? "",
      ...body,
    });
    if (!input.stageId) throw badRequest("Cliente sem etapas de fluxo configuradas.");

    const stamp = Date.now();
    const row = {
      id: newId("cnt"),
      clientId,
      title: input.title,
      format: input.format,
      publishDate: input.publishDate,
      publishTime: null,
      stageId: input.stageId,
      pillarId: input.pillarId || null,
      funnelId: input.funnelId || null,
      platforms: JSON.stringify(input.platforms),
      cta: input.cta || null,
      hook: input.hook || null,
      script: input.script || null,
      notes: input.notes || null,
      assigneeId: null,
      priority: input.priority,
      approval: "none",
      publishedAt: null,
      permalink: null,
      archived: 0,
      position: stamp,
      createdBy: session.user.id,
      createdAt: stamp,
      updatedAt: stamp,
    };

    await db.insert(contents).values(row);
    await logActivity(db, {
      clientId, contentId: row.id, userId: session.user.id,
      action: "content.created", meta: { title: row.title },
    });
    return ok({ content: toContentDto(row) }, 201);
  });
}

const bulkShape = {
  ids: v.stringArray({ max: 200 }),
  stageId: v.string({ min: 1, max: 40 }),
  pillarId: v.string({ min: 1, max: 40 }),
  funnelId: v.string({ min: 1, max: 40 }),
  priority: v.int({ min: 0, max: 2 }),
  archived: v.bool(),
};

/** Ações em lote — mover, arquivar ou reclassificar vários conteúdos. */
export async function PATCH(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const body = parsePartial(bulkShape, await readJson(request));
    const ids = body.ids ?? [];
    if (!ids.length) throw badRequest("Informe ao menos um conteúdo.", { ids: "Lista vazia." });

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (body.stageId) patch.stageId = body.stageId;
    if (body.pillarId) patch.pillarId = body.pillarId;
    if (body.funnelId) patch.funnelId = body.funnelId;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.archived !== undefined) patch.archived = body.archived ? 1 : 0;
    if (Object.keys(patch).length === 1) throw badRequest("Nenhuma alteração informada.");

    await db
      .update(contents)
      .set(patch)
      .where(and(eq(contents.clientId, clientId), inArray(contents.id, ids)));

    await logActivity(db, {
      clientId, userId: session.user.id, action: "content.bulk_updated",
      meta: { count: ids.length, fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
    });
    return ok({ updated: ids.length });
  });
}
