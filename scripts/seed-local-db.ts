/** Cria o banco SQLite local e semeia a Forja do Sica — mesma lógica de POST /api/bootstrap. */
import { sql } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import { DDL } from "../db/ddl.ts";
import { users } from "../db/schema.ts";
import { countClients, seedForja } from "../lib/provision.ts";
import { newId } from "../lib/ids.ts";

async function main() {
  const db = getDb();

  for (const statement of DDL) await db.run(sql.raw(statement));

  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(users);
  let ownerId: string;
  if (Number(total) === 0) {
    ownerId = newId("usr");
    await db.insert(users).values({
      id: ownerId,
      externalId: "local-owner",
      email: "estudio@sicheroli.local",
      name: "Rodrigo Sicheroli",
      role: "owner",
      accent: "orange",
      createdAt: Date.now(),
    });
  } else {
    const [owner] = await db.select().from(users).limit(1);
    ownerId = owner.id;
  }

  const before = await countClients(db);
  const seeded = before === 0 ? await seedForja(db, ownerId) : null;

  console.log(JSON.stringify({
    tables: DDL.filter((s) => s.startsWith("CREATE TABLE")).length,
    owner: ownerId,
    seeded: seeded ? { id: seeded.id, name: seeded.name, slug: seeded.slug } : "já existia",
    clients: seeded ? before + 1 : before,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
