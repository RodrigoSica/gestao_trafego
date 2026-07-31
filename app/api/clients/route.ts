import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, contents, memberships } from "../../../db/schema";
import { getSession } from "../../../lib/auth";
import { logActivity } from "../../../lib/data";
import { forbidden, ok, parse, readJson, route, v } from "../../../lib/http";
import { createClient } from "../../../lib/provision";

export const dynamic = "force-dynamic";

/** Lista os clientes visíveis para a sessão, com o resumo de produção de cada um. */
export async function GET() {
  return route(async () => {
    const db = getDb();
    const session = await getSession();

    const visible = session.isOwner || session.user.role === "admin"
      ? await db.select().from(clients).orderBy(asc(clients.name))
      : await db
          .select({ c: clients })
          .from(memberships)
          .innerJoin(clients, eq(clients.id, memberships.clientId))
          .where(eq(memberships.userId, session.user.id))
          .orderBy(asc(clients.name))
          .then((rows) => rows.map((r) => r.c));

    const ids = visible.map((c) => c.id);
    const totals = ids.length
      ? await db
          .select({
            clientId: contents.clientId,
            total: sql<number>`count(*)`,
            pending: sql<number>`sum(case when ${contents.approval} = 'pending' then 1 else 0 end)`,
            published: sql<number>`sum(case when ${contents.publishedAt} is not null then 1 else 0 end)`,
          })
          .from(contents)
          .where(and(inArray(contents.clientId, ids), eq(contents.archived, 0)))
          .groupBy(contents.clientId)
      : [];

    const byClient = new Map(totals.map((t) => [t.clientId, t]));
    return ok({
      session: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        accent: session.user.accent,
      },
      clients: visible.map((c) => ({
        ...c,
        stats: {
          total: Number(byClient.get(c.id)?.total ?? 0),
          pending: Number(byClient.get(c.id)?.pending ?? 0),
          published: Number(byClient.get(c.id)?.published ?? 0),
        },
      })),
    });
  });
}

const createShape = {
  name: v.string({ min: 2, max: 80 }),
  slug: v.string({ min: 0, max: 48 }),
  tagline: v.string({ min: 0, max: 140 }),
  brandPrimary: v.string({ min: 4, max: 9 }),
  brandAccent: v.string({ min: 4, max: 9 }),
  timezone: v.string({ min: 1, max: 60 }),
  monthlyGoal: v.int({ min: 0, max: 500 }),
  pillarNames: v.stringArray({ max: 12 }),
};

export async function POST(request: Request) {
  return route(async () => {
    const db = getDb();
    const session = await getSession();
    if (!session.isOwner && session.user.role !== "admin")
      throw forbidden("Apenas o dono do estúdio pode cadastrar clientes.");

    const body = (await readJson(request)) as Record<string, unknown>;
    const input = parse(createShape, {
      slug: "", tagline: "", brandPrimary: "#e96f34", brandAccent: "#5c75d8",
      timezone: "America/Sao_Paulo", monthlyGoal: 30, pillarNames: [],
      ...body,
    });

    const created = await createClient(db, session.user.id, {
      name: input.name,
      slug: input.slug || undefined,
      tagline: input.tagline || null,
      brandPrimary: input.brandPrimary,
      brandAccent: input.brandAccent,
      timezone: input.timezone,
      monthlyGoal: input.monthlyGoal,
      pillarNames: input.pillarNames.filter(Boolean),
    });

    await logActivity(db, {
      clientId: created.client.id,
      userId: session.user.id,
      action: "client.created",
      meta: { name: created.client.name },
    });

    return ok(created, 201);
  });
}
