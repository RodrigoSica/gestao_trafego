import { getDb } from "../../../../db";
import { getSession } from "../../../../lib/auth";
import { ApiError, ok, route } from "../../../../lib/http";
import { processDueJobs } from "../../../../lib/publishing";

export const dynamic = "force-dynamic";

/**
 * Executa a fila de publicação.
 *
 * Dois chamadores possíveis:
 * - um agendador externo (cron-job.org, n8n, Agendador do Windows) enviando
 *   o header `x-publishing-token` igual ao segredo `PUBLISHING_TOKEN`;
 * - o dono do estúdio pela interface, para disparar na hora.
 *
 * O cron nativo do Cloudflare chama `processDueJobs` direto pelo worker,
 * sem passar por aqui. Ver `worker/index.ts`.
 */
export async function POST(request: Request) {
  return route(async () => {
    const secret = process.env.PUBLISHING_TOKEN;
    const presented = request.headers.get("x-publishing-token");

    if (secret && presented === secret) {
      // Autorizado pelo segredo compartilhado — sem sessão de usuário.
    } else {
      const session = await getSession();
      if (!session.isOwner && session.user.role !== "admin") {
        throw new ApiError(403, "forbidden", "Apenas o dono do estúdio pode disparar a fila.");
      }
    }

    const url = new URL(request.url);
    const report = await processDueJobs(getDb(), {
      limit: Number(url.searchParams.get("limit") ?? 25) || 25,
      baseUrl: process.env.PUBLIC_BASE_URL ?? url.origin,
    });

    return ok({ ...report, ranAt: Date.now() });
  });
}
