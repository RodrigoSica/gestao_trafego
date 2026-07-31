import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { DDL } from "../../../db/ddl";
import { getSession } from "../../../lib/auth";
import { ok, route, ApiError } from "../../../lib/http";
import { countClients, seedForja } from "../../../lib/provision";

export const dynamic = "force-dynamic";

/** Fatia mínima do binding D1 usada aqui — evita depender de @cloudflare/workers-types. */
type D1Exec = { prepare(query: string): { run(): Promise<unknown> } };

/**
 * Cria/atualiza o esquema e semeia a primeira conta.
 * Idempotente — pode ser chamado a cada deploy sem efeito colateral.
 */
export async function POST() {
  return route(async () => {
    const db = (env as { DB?: D1Exec }).DB;
    if (!db) throw new ApiError(503, "no_database", "Binding D1 `DB` indisponível neste ambiente.");

    for (const statement of DDL) await db.prepare(statement).run();

    const orm = getDb();
    const session = await getSession();
    const before = await countClients(orm);
    const seeded = before === 0 ? await seedForja(orm, session.user.id) : null;

    return ok({
      schema: "ready",
      tables: DDL.filter((s) => s.startsWith("CREATE TABLE")).length,
      owner: { id: session.user.id, email: session.user.email, role: session.user.role },
      seeded: seeded ? { id: seeded.id, name: seeded.name, slug: seeded.slug } : null,
      clients: seeded ? before + 1 : before,
    });
  });
}
