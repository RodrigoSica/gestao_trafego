import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { assets, clients, contents, publishJobs } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { getContentOrThrow, logActivity } from "../../../../../lib/data";
import { badRequest, notFound, ok, readJson, route } from "../../../../../lib/http";
import { buildPackage, renderMessage, scheduleContent, scheduledEpoch } from "../../../../../lib/publishing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ contentId: string }> };

/** Job atual + prévia exata do que o responsável vai receber. */
export async function GET(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId);

    const [[job], [client], mediaRows] = await Promise.all([
      db
        .select()
        .from(publishJobs)
        .where(eq(publishJobs.contentId, contentId))
        .orderBy(desc(publishJobs.createdAt))
        .limit(1),
      db.select().from(clients).where(eq(clients.id, content.clientId)).limit(1),
      db
        .select({ name: assets.name, kind: assets.kind, url: assets.url, storageKey: assets.storageKey })
        .from(assets)
        .where(eq(assets.contentId, contentId)),
    ]);

    const pkg = buildPackage({
      content,
      clientName: client.name,
      clientSlug: client.slug,
      mediaRows,
      baseUrl: new URL(request.url).origin,
    });

    return ok({ job: job ?? null, package: pkg, preview: renderMessage(pkg) });
  });
}

/**
 * Agenda o aviso. Sem `runAt` no corpo, usa a data e a hora planejadas
 * do próprio conteúdo.
 */
export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId, true);

    const body = (await readJson(request)) as { runAt?: number; mode?: string };
    const runAt = typeof body.runAt === "number" ? body.runAt : scheduledEpoch(content);
    if (!Number.isFinite(runAt)) throw badRequest("Horário inválido.", { runAt: "Data ou hora não reconhecida." });

    const mode = body.mode === "auto" ? "auto" : "notify";
    if (mode === "auto") {
      throw badRequest(
        "Publicação automática ainda não está liberada — depende da aprovação das plataformas. Use o modo notificado."
      );
    }

    const job = await scheduleContent(db, { content, runAt, mode, userId: session.user.id });
    await logActivity(db, {
      clientId: content.clientId, contentId, userId: session.user.id,
      action: "publish.scheduled", meta: { title: content.title, runAt },
    });
    return ok({ job }, 201);
  });
}

/** Confirma que o conteúdo foi publicado de fato — fecha o ciclo. */
export async function PATCH(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId, true);

    const body = (await readJson(request)) as { permalink?: string };
    const stamp = Date.now();

    const updated = await db
      .update(publishJobs)
      .set({ status: "done", doneAt: stamp, updatedAt: stamp })
      .where(and(eq(publishJobs.contentId, contentId), sql`${publishJobs.status} in ('sent', 'pending', 'sending')`));

    if ((updated as { meta?: { changes?: number } }).meta?.changes === 0) {
      throw notFound("Não há publicação agendada para confirmar.");
    }

    await db
      .update(contents)
      .set({
        publishedAt: stamp,
        permalink: typeof body.permalink === "string" && body.permalink ? body.permalink : content.permalink,
        updatedAt: stamp,
      })
      .where(eq(contents.id, contentId));

    await logActivity(db, {
      clientId: content.clientId, contentId, userId: session.user.id,
      action: "publish.confirmed", meta: { title: content.title },
    });
    return ok({ confirmed: true, publishedAt: stamp });
  });
}

/**
 * Sem parâmetro, cancela o agendamento ativo (o registro fica no histórico).
 * Com `?purge=1`, apaga os jobs do conteúdo de vez — é o que limpa o selo de
 * "Falhou" que, de outro modo, ficaria preso no card para sempre.
 */
export async function DELETE(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId, true);

    const purge = new URL(request.url).searchParams.get("purge") === "1";

    if (purge) {
      const removed = await db.delete(publishJobs).where(eq(publishJobs.contentId, contentId));
      await logActivity(db, {
        clientId: content.clientId, contentId, userId: session.user.id,
        action: "publish.job_removed", meta: { title: content.title },
      });
      return ok({ purged: true, removed: (removed as { meta?: { changes?: number } }).meta?.changes ?? 0 });
    }

    await db
      .update(publishJobs)
      .set({ status: "canceled", updatedAt: Date.now() })
      .where(and(eq(publishJobs.contentId, contentId), sql`${publishJobs.status} in ('pending', 'sending', 'sent')`));

    await logActivity(db, {
      clientId: content.clientId, contentId, userId: session.user.id,
      action: "publish.canceled", meta: { title: content.title },
    });
    return ok({ canceled: true });
  });
}
