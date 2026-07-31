import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { assets, comments, contents, metrics, users } from "../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../lib/auth";
import { describeChanges, getContentOrThrow, logActivity, toContentDto } from "../../../../lib/data";
import { badRequest, ok, parsePartial, readJson, route, v } from "../../../../lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ contentId: string }> };

/** Ficha completa: conteúdo + comentários + anexos + métricas. */
export async function GET(_request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId);

    const [commentRows, assetRows, metricRows] = await Promise.all([
      db
        .select({
          id: comments.id, body: comments.body, kind: comments.kind, resolved: comments.resolved,
          createdAt: comments.createdAt, userId: comments.userId,
          userName: users.name, userAccent: users.accent,
        })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.userId))
        .where(eq(comments.contentId, contentId))
        .orderBy(asc(comments.createdAt)),
      db.select().from(assets).where(eq(assets.contentId, contentId)).orderBy(desc(assets.createdAt)),
      db.select().from(metrics).where(eq(metrics.contentId, contentId)).orderBy(desc(metrics.capturedAt)),
    ]);

    return ok({
      content: toContentDto(content),
      comments: commentRows.map((c) => ({ ...c, resolved: c.resolved === 1 })),
      assets: assetRows,
      metrics: metricRows,
    });
  });
}

const patchShape = {
  title: v.string({ min: 1, max: 180 }),
  format: v.string({ min: 1, max: 40 }),
  publishDate: v.date(),
  publishTime: v.string({ min: 0, max: 5 }),
  stageId: v.string({ min: 1, max: 40 }),
  pillarId: v.string({ min: 0, max: 40 }),
  funnelId: v.string({ min: 0, max: 40 }),
  platforms: v.stringArray({ max: 10 }),
  cta: v.string({ min: 0, max: 180 }),
  hook: v.string({ min: 0, max: 400 }),
  script: v.string({ min: 0, max: 8000 }),
  notes: v.string({ min: 0, max: 8000 }),
  assigneeId: v.string({ min: 0, max: 40 }),
  priority: v.int({ min: 0, max: 2 }),
  approval: v.enum(["none", "pending", "approved", "changes"] as const),
  permalink: v.string({ min: 0, max: 400 }),
  position: v.number(),
  archived: v.bool(),
  publishedAt: v.int({ min: 0 }),
};

export async function PATCH(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const before = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, before.clientId, true);

    const input = parsePartial(patchShape, await readJson(request));
    if (!Object.keys(input).length) throw badRequest("Nenhuma alteração informada.");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(input)) {
      if (key === "platforms") patch.platforms = JSON.stringify(value);
      else if (key === "archived") patch.archived = value ? 1 : 0;
      else if (typeof value === "string" && value === "" && key !== "title") patch[key] = null;
      else patch[key] = value;
    }

    await db
      .update(contents)
      .set(patch)
      .where(and(eq(contents.id, contentId), eq(contents.clientId, before.clientId)));

    const [after] = await db.select().from(contents).where(eq(contents.id, contentId)).limit(1);
    const changed = describeChanges(before, input as Record<string, unknown>);
    if (changed.length) {
      await logActivity(db, {
        clientId: before.clientId, contentId, userId: session.user.id,
        action: input.stageId && changed.includes("etapa") ? "content.moved" : "content.updated",
        meta: { title: after.title, fields: changed },
      });
    }
    return ok({ content: toContentDto(after) });
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId, true);

    await db.delete(contents).where(eq(contents.id, contentId));
    await db.delete(comments).where(eq(comments.contentId, contentId));
    await db.delete(assets).where(eq(assets.contentId, contentId));
    await db.delete(metrics).where(eq(metrics.contentId, contentId));

    await logActivity(db, {
      clientId: content.clientId, userId: session.user.id,
      action: "content.deleted", meta: { title: content.title },
    });
    return ok({ deleted: true });
  });
}
