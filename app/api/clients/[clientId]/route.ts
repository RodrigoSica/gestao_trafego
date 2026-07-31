import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  activities, assets, channels, clients, comments, contents, funnels, memberships,
  metrics, pillars, publishJobs, stages, templates, users,
} from "../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../lib/auth";
import { logActivity, toContentDto } from "../../../../lib/data";
import { forbidden, notFound, ok, parsePartial, readJson, route, v } from "../../../../lib/http";

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

/** Fatia do R2 usada na exclusão definitiva. */
type R2Bucket = {
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>; truncated: boolean; cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
};

/** Remove todos os arquivos do cliente no bucket, em páginas. */
async function purgeClientMedia(clientId: string): Promise<number> {
  const bucket = (env as { MEDIA?: R2Bucket }).MEDIA;
  if (!bucket) return 0;

  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `${clientId}/`, cursor });
    if (page.objects.length) {
      await bucket.delete(page.objects.map((o) => o.key));
      removed += page.objects.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

/**
 * `?mode=archive` (padrão) apenas esconde o cliente e preserva o histórico.
 * `?mode=purge` apaga tudo em definitivo: conteúdos, comentários, métricas,
 * anexos (inclusive os arquivos no R2), fila, canais, taxonomia e auditoria.
 *
 * A exclusão definitiva é restrita a owner/admin — quem tem apenas escrita no
 * cliente pode arquivar, não destruir.
 */
export async function DELETE(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const mode = new URL(request.url).searchParams.get("mode") ?? "archive";

    if (mode !== "purge") {
      await db.update(clients).set({ status: "archived", updatedAt: Date.now() }).where(eq(clients.id, clientId));
      await logActivity(db, { clientId, userId: session.user.id, action: "client.archived" });
      return ok({ archived: true });
    }

    if (!session.isOwner && session.user.role !== "admin") {
      throw forbidden("Apenas o dono do estúdio pode excluir um cliente em definitivo.");
    }

    const [existing] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!existing) throw notFound("Cliente não encontrado.");

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(contents)
      .where(eq(contents.clientId, clientId));

    // Os arquivos saem primeiro: se o bucket falhar, o registro continua de pé
    // e a operação pode ser repetida. O inverso deixaria lixo órfão no R2.
    const files = await purgeClientMedia(clientId);

    for (const table of [comments, metrics, assets, publishJobs, channels, contents,
                         stages, pillars, funnels, memberships, activities]) {
      await db.delete(table).where(eq(table.clientId, clientId));
    }
    await db.delete(templates).where(eq(templates.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));

    console.log(`[purge] cliente ${existing.slug}: ${Number(total)} conteúdos, ${files} arquivos`);
    return ok({ purged: true, name: existing.name, contents: Number(total), files });
  });
}
