import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { DDL } from "../../../db/ddl";
import { getSession } from "../../../lib/auth";
import { ok, route } from "../../../lib/http";
import { countClients, seedForja } from "../../../lib/provision";

export const dynamic = "force-dynamic";

/**
 * Cria/atualiza o esquema e semeia a primeira conta.
 * Idempotente — pode ser chamado a cada deploy sem efeito colateral.
 */
export async function POST() {
  return route(async () => {
    const orm = getDb();
    for (const statement of DDL) await orm.run(sql.raw(statement));
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
