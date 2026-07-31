import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { contents } from "../../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../../lib/auth";
import { logActivity } from "../../../../../../lib/data";
import { badRequest, ok, readJson, route } from "../../../../../../lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clientId: string }> };

/** Distância entre posições após normalizar: espaço para ~50 encaixes. */
const SPACING = 1000;

/**
 * Reescreve as posições de uma etapa como 0, 1000, 2000...
 *
 * O quadro reordena calculando o ponto médio entre os vizinhos, o que gasta
 * precisão a cada encaixe no mesmo intervalo. Quando o espaço acaba, o front
 * chama esta rota e a coluna volta a ter folga. É raro, mas sem isso a ordem
 * acabaria colapsando em silêncio depois de dezenas de encaixes seguidos.
 *
 * A ordem é calculada aqui e gravada com valores explícitos. A versão anterior
 * usava uma subconsulta correlacionada contando os irmãos anteriores — e ela
 * rankeava contra a tabela em pleno UPDATE: cada linha já gravada entrava na
 * contagem da seguinte e a coluna inteira colapsava em posições repetidas.
 */
export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const body = (await readJson(request)) as { stageId?: string; by?: string };
    const stageId = typeof body.stageId === "string" ? body.stageId : "";
    if (!stageId) throw badRequest("Informe a etapa.", { stageId: "Obrigatório." });

    // `position` mantém a fila atual e só recria a folga entre os cards.
    // `publishDate` devolve a coluna à ordem do calendário editorial.
    const by = body.by === "publishDate" ? "publishDate" : "position";

    const scope = and(
      eq(contents.clientId, clientId),
      eq(contents.stageId, stageId),
      eq(contents.archived, 0)
    );

    const current = await db
      .select({ id: contents.id })
      .from(contents)
      .where(scope)
      .orderBy(
        ...(by === "publishDate"
          ? [asc(contents.publishDate), asc(contents.id)]
          : [asc(contents.position), asc(contents.id)])
      );

    // D1 limita 100 parâmetros por statement; são 3 por linha (CASE + IN).
    const CHUNK = 25;
    const stamp = Date.now();
    for (let i = 0; i < current.length; i += CHUNK) {
      const slice = current.slice(i, i + CHUNK);
      const branches = sql.join(
        slice.map((row, k) => sql`when ${row.id} then ${(i + k) * SPACING}`),
        sql` `
      );
      await db
        .update(contents)
        .set({ position: sql`case ${contents.id} ${branches} end`, updatedAt: stamp })
        .where(and(eq(contents.clientId, clientId), inArray(contents.id, slice.map((r) => r.id))));
    }

    const rows = await db
      .select({ id: contents.id, position: contents.position })
      .from(contents)
      .where(scope)
      .orderBy(asc(contents.position));

    await logActivity(db, {
      clientId, userId: session.user.id,
      action: "contents.reordered", meta: { stageId, total: rows.length, by },
    });
    return ok({ stageId, by, positions: rows, spacing: SPACING });
  });
}
