import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { channels } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { logActivity } from "../../../../../lib/data";
import { badRequest, notFound, ok, parse, readJson, route, v } from "../../../../../lib/http";
import { newId } from "../../../../../lib/ids";
import { telegramConfigured } from "../../../../../lib/notify";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId);

    const rows = await db.select().from(channels).where(eq(channels.clientId, clientId));
    return ok({
      channels: rows.map((r) => ({ ...r, active: r.active === 1 })),
      // A interface avisa quando o bot não está configurado no ambiente —
      // sem isso o canal existe mas nunca entrega, e a falha só apareceria
      // no horário da publicação.
      telegramReady: telegramConfigured(),
    });
  });
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Aceita https, e http apenas em localhost — receptor auto-hospedado (n8n,
 * Make local) é caso de uso legítimo.
 *
 * Isto NÃO é uma defesa contra SSRF: `https://servico-interno/...` passa
 * igual. A proteção real é o controle de acesso — só quem tem permissão de
 * escrita no cliente cadastra canal. Se um dia usuários menos confiáveis
 * puderem configurar canais, é aqui que precisa entrar uma allowlist.
 */
function isAllowedWebhook(target: string): boolean {
  try {
    const url = new URL(target);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const shape = {
  kind: v.enum(["telegram", "webhook"] as const),
  target: v.string({ min: 1, max: 400 }),
  label: v.string({ min: 0, max: 60 }),
};

export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const input = parse(shape, { kind: "telegram", label: "", ...(await readJson(request)) as object });
    if (input.kind === "webhook" && !isAllowedWebhook(input.target)) {
      throw badRequest("Webhook precisa de URL https (http só em localhost).", {
        target: "Use https:// — ou http://127.0.0.1 para um receptor local.",
      });
    }
    if (input.kind === "telegram" && !/^-?\d+$/.test(input.target)) {
      throw badRequest("Informe o chat_id numérico do Telegram.", {
        target: "Converse com o bot e use o chat_id (pode ser negativo em grupos).",
      });
    }

    const row = {
      id: newId("chn"), clientId, kind: input.kind, target: input.target,
      label: input.label || null, active: 1, createdAt: Date.now(),
    };
    await db.insert(channels).values(row);
    await logActivity(db, {
      clientId, userId: session.user.id, action: "channel.created", meta: { kind: row.kind },
    });
    return ok({ channel: { ...row, active: true } }, 201);
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) throw badRequest("Informe o id do canal.", { id: "Obrigatório." });

    const result = await db.delete(channels).where(and(eq(channels.id, id), eq(channels.clientId, clientId)));
    if ((result as { meta?: { changes?: number } }).meta?.changes === 0) throw notFound("Canal não encontrado.");

    await logActivity(db, { clientId, userId: session.user.id, action: "channel.deleted" });
    return ok({ deleted: true });
  });
}
