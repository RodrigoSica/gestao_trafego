import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { assets, channels, clients, contents, publishJobs, type ContentRow } from "../db/schema";
import { deliver } from "./notify";
import { logActivity, safeJsonArray } from "./data";
import { newId } from "./ids";

type Db = ReturnType<typeof getDb>;

/** pending → sending → sent → done. `failed` e `canceled` são terminais. */
export const JOB_STATUS = ["pending", "sending", "sent", "done", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

const MAX_ATTEMPTS = 5;

/**
 * Chave de idempotência: mesmo conteúdo no mesmo horário nunca gera dois jobs.
 * É o que impede o post duplicado quando alguém reagenda duas vezes seguidas
 * ou quando dois processadores acordam juntos.
 */
export const idempotencyKeyFor = (contentId: string, runAt: number) => `${contentId}:${runAt}`;

/* ---------------------------------------------------------------- pacote */

export type PublishPackage = {
  contentId: string;
  clientName: string;
  title: string;
  format: string;
  platforms: string[];
  scheduledFor: number;
  caption: string;
  media: Array<{ name: string; kind: string; url: string }>;
  openUrl: string;
};

/** Legenda pronta para copiar: gancho, roteiro e chamada, na ordem. */
export function buildCaption(content: Pick<ContentRow, "hook" | "script" | "cta">): string {
  return [content.hook, content.script, content.cta]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

export function buildPackage(input: {
  content: ContentRow;
  clientName: string;
  clientSlug: string;
  mediaRows: Array<{ name: string; kind: string; url: string | null; storageKey: string | null }>;
  baseUrl: string;
}): PublishPackage {
  const { content, clientName, clientSlug, mediaRows, baseUrl } = input;
  const origin = baseUrl.replace(/\/+$/, "");

  return {
    contentId: content.id,
    clientName,
    title: content.title,
    format: content.format,
    platforms: safeJsonArray(content.platforms),
    scheduledFor: scheduledEpoch(content),
    caption: buildCaption(content),
    media: mediaRows.map((row) => ({
      name: row.name,
      kind: row.kind,
      url: row.storageKey ? `${origin}/media/${row.storageKey}` : (row.url ?? ""),
    })),
    openUrl: `${origin}/?c=${encodeURIComponent(clientSlug)}&v=Calend%C3%A1rio`,
  };
}

/** Data + hora planejadas convertidas para epoch ms. Sem hora, assume 09:00. */
export function scheduledEpoch(content: Pick<ContentRow, "publishDate" | "publishTime">): number {
  const time = /^\d{2}:\d{2}$/.test(content.publishTime ?? "") ? content.publishTime : "09:00";
  return new Date(`${content.publishDate}T${time}:00`).getTime();
}

/** Mensagem enviada ao responsável. Texto puro: cola direto no app da rede. */
export function renderMessage(pkg: PublishPackage): string {
  const when = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(pkg.scheduledFor));

  const lines = [
    `HORA DE PUBLICAR — ${pkg.clientName}`,
    "",
    `${pkg.title}`,
    `${pkg.format} · ${pkg.platforms.join(", ") || "sem plataforma definida"} · ${when}`,
  ];

  if (pkg.caption) lines.push("", "--- LEGENDA (copie abaixo) ---", pkg.caption);

  if (pkg.media.length) {
    lines.push("", "--- ARQUIVOS ---");
    for (const item of pkg.media) lines.push(`${item.name}: ${item.url}`);
  } else {
    lines.push("", "Sem arquivo anexado — publique com a mídia que já tiver em mãos.");
  }

  lines.push("", `Depois de publicar, confirme aqui: ${pkg.openUrl}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------ fila ------ */

export type RunReport = { claimed: number; sent: number; failed: number; skipped: number };

/**
 * Processa os jobs vencidos.
 *
 * A reserva é um compare-and-swap (`UPDATE ... WHERE status = 'pending'`):
 * o D1 não tem `SELECT FOR UPDATE`, então quem conseguir mudar a linha é o
 * dono do job. Sem isso, dois disparos simultâneos — o cron e uma chamada
 * manual, por exemplo — notificariam a mesma publicação duas vezes.
 */
export async function processDueJobs(
  db: Db,
  options: { now?: number; limit?: number; baseUrl: string }
): Promise<RunReport> {
  const now = options.now ?? Date.now();
  const limit = Math.min(options.limit ?? 25, 100);
  const report: RunReport = { claimed: 0, sent: 0, failed: 0, skipped: 0 };

  const due = await db
    .select({ id: publishJobs.id })
    .from(publishJobs)
    .where(and(eq(publishJobs.status, "pending"), lte(publishJobs.runAt, now)))
    .orderBy(asc(publishJobs.runAt))
    .limit(limit);

  for (const { id } of due) {
    const claimed = await db
      .update(publishJobs)
      .set({ status: "sending", attempts: sql`${publishJobs.attempts} + 1`, updatedAt: Date.now() })
      .where(and(eq(publishJobs.id, id), eq(publishJobs.status, "pending")));

    // Outro processador chegou primeiro.
    if ((claimed as { meta?: { changes?: number } }).meta?.changes === 0) {
      report.skipped++;
      continue;
    }
    report.claimed++;

    const outcome = await runJob(db, id, options.baseUrl);
    if (outcome) report.sent++;
    else report.failed++;
  }

  return report;
}

async function runJob(db: Db, jobId: string, baseUrl: string): Promise<boolean> {
  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, jobId)).limit(1);
  if (!job) return false;

  const fail = async (message: string) => {
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await db
      .update(publishJobs)
      .set({
        // Volta para `pending` enquanto houver tentativa sobrando.
        status: exhausted ? "failed" : "pending",
        lastError: message.slice(0, 400),
        updatedAt: Date.now(),
      })
      .where(eq(publishJobs.id, jobId));
    if (exhausted) {
      await logActivity(db, {
        clientId: job.clientId, contentId: job.contentId,
        action: "publish.failed", meta: { error: message.slice(0, 200) },
      });
    }
    return false;
  };

  const [content] = await db.select().from(contents).where(eq(contents.id, job.contentId)).limit(1);
  if (!content) return fail("Conteúdo não existe mais.");

  const [client] = await db.select().from(clients).where(eq(clients.id, job.clientId)).limit(1);
  if (!client) return fail("Cliente não existe mais.");

  const targets = await db
    .select({ kind: channels.kind, target: channels.target })
    .from(channels)
    .where(and(eq(channels.clientId, job.clientId), eq(channels.active, 1)));

  if (!targets.length) {
    return fail("Nenhum canal de aviso ativo para este cliente. Configure em Configurações > Avisos.");
  }

  const mediaRows = await db
    .select({ name: assets.name, kind: assets.kind, url: assets.url, storageKey: assets.storageKey })
    .from(assets)
    .where(eq(assets.contentId, job.contentId));

  const pkg = buildPackage({
    content,
    clientName: client.name,
    clientSlug: client.slug,
    mediaRows,
    baseUrl,
  });
  const message = renderMessage(pkg);

  const results = await Promise.all(targets.map((t) => deliver(t, message, pkg)));
  const delivered = results.filter((r) => r.ok).length;

  if (delivered === 0) {
    const reasons = results.map((r) => (r.ok ? "" : r.error)).filter(Boolean).join(" | ");
    return fail(reasons || "Nenhum canal aceitou a entrega.");
  }

  await db
    .update(publishJobs)
    .set({ status: "sent", sentAt: Date.now(), lastError: null, updatedAt: Date.now() })
    .where(eq(publishJobs.id, jobId));

  await logActivity(db, {
    clientId: job.clientId,
    contentId: job.contentId,
    action: "publish.notified",
    meta: { title: content.title, channels: delivered, partial: delivered < results.length },
  });
  return true;
}

/** Cria ou reagenda o job de um conteúdo. Reagendar cancela o anterior. */
export async function scheduleContent(
  db: Db,
  input: { content: ContentRow; runAt: number; mode?: string; userId: string }
) {
  const { content, runAt, userId } = input;
  const mode = input.mode ?? "notify";

  await db
    .update(publishJobs)
    .set({ status: "canceled", updatedAt: Date.now() })
    .where(
      and(
        eq(publishJobs.contentId, content.id),
        sql`${publishJobs.status} in ('pending', 'sending')`
      )
    );

  const stamp = Date.now();
  const row = {
    id: newId("job"),
    clientId: content.clientId,
    contentId: content.id,
    mode,
    runAt,
    status: "pending",
    attempts: 0,
    lastError: null,
    idempotencyKey: idempotencyKeyFor(content.id, runAt),
    sentAt: null,
    doneAt: null,
    createdBy: userId,
    createdAt: stamp,
    updatedAt: stamp,
  };

  // A chave única cobre o reagendamento para o mesmo instante: nesse caso o
  // job antigo é reativado em vez de duplicar a linha.
  try {
    await db.insert(publishJobs).values(row);
    return row;
  } catch {
    await db
      .update(publishJobs)
      .set({ status: "pending", attempts: 0, lastError: null, mode, updatedAt: stamp })
      .where(eq(publishJobs.idempotencyKey, row.idempotencyKey));
    const [existing] = await db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.idempotencyKey, row.idempotencyKey))
      .limit(1);
    return existing;
  }
}
