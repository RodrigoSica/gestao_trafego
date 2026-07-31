import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  activities, clients, contents, funnels, memberships, pillars, publishJobs, stages, users,
} from "../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../lib/auth";
import { logActivity, toContentDto } from "../../../../lib/data";
import { notFound, ok, parsePartial, readJson, route, v } from "../../../../lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clientId: string }> };

/** Bundle completo do workspace — uma chamada carrega o app inteiro. */
export async function GET(_request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    const role = await assertClientAccess(session, clientId);

    const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) throw notFound("Cliente não encontrado.");

    const [stageRows, pillarRows, funnelRows, contentRows, memberRows, feed, jobRows] = await Promise.all([
      db.select().from(stages).where(eq(stages.clientId, clientId)).orderBy(asc(stages.position)),
      db.select().from(pillars).where(eq(pillars.clientId, clientId)).orderBy(asc(pillars.position)),
      db.select().from(funnels).where(eq(funnels.clientId, clientId)).orderBy(asc(funnels.position)),
      db
        .select()
        .from(contents)
        .where(and(eq(contents.clientId, clientId), eq(contents.archived, 0)))
        .orderBy(asc(contents.publishDate)),
      db
        .select({ id: users.id, name: users.name, email: users.email, accent: users.accent, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.clientId, clientId)),
      db
        .select()
        .from(activities)
        .where(eq(activities.clientId, clientId))
        .orderBy(desc(activities.createdAt))
        .limit(40),
      // Só os jobs vivos — o histórico completo fica na ficha do conteúdo.
      db
        .select({
          contentId: publishJobs.contentId, status: publishJobs.status, runAt: publishJobs.runAt,
          mode: publishJobs.mode, lastError: publishJobs.lastError, attempts: publishJobs.attempts,
        })
        .from(publishJobs)
        .where(and(eq(publishJobs.clientId, clientId), sql`${publishJobs.status} in ('pending', 'sending', 'sent', 'failed')`)),
    ]);

    return ok({
      client,
      role,
      stages: stageRows,
      pillars: pillarRows,
      funnels: funnelRows,
      contents: contentRows.map(toContentDto),
      members: memberRows,
      activity: feed.map((a) => ({ ...a, meta: a.meta ? JSON.parse(a.meta) : null })),
      jobs: jobRows,
    });
  });
}

const patchShape = {
  name: v.string({ min: 2, max: 80 }),
  tagline: v.string({ min: 0, max: 140 }),
  brandPrimary: v.string({ min: 4, max: 9 }),
  brandAccent: v.string({ min: 4, max: 9 }),
  timezone: v.string({ min: 1, max: 60 }),
  monthlyGoal: v.int({ min: 0, max: 500 }),
  status: v.enum(["active", "paused", "archived"] as const),
  notes: v.string({ min: 0, max: 4000 }),
};

export async function PATCH(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const patch = parsePartial(patchShape, await readJson(request));
    if (!Object.keys(patch).length) throw notFound("Nada para atualizar.");

    await db
      .update(clients)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(clients.id, clientId));

    const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    await logActivity(db, { clientId, userId: session.user.id, action: "client.updated", meta: patch });
    return ok({ client });
  });
}

/** Arquiva o cliente (soft delete) — o histórico é preservado. */
export async function DELETE(_request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    await db.update(clients).set({ status: "archived", updatedAt: Date.now() }).where(eq(clients.id, clientId));
    await logActivity(db, { clientId, userId: session.user.id, action: "client.archived" });
    return ok({ archived: true });
  });
}
