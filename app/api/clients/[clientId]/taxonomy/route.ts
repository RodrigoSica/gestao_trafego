import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { contents, funnels, pillars, stages } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { logActivity } from "../../../../../lib/data";
import { badRequest, conflict, notFound, ok, parse, parsePartial, readJson, route, v } from "../../../../../lib/http";
import { newId } from "../../../../../lib/ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clientId: string }> };
type Kind = "stage" | "pillar" | "funnel";

const TABLES = { stage: stages, pillar: pillars, funnel: funnels } as const;
const PREFIX = { stage: "stg", pillar: "plr", funnel: "fnl" } as const;
const CONTENT_FK = { stage: contents.stageId, pillar: contents.pillarId, funnel: contents.funnelId } as const;

function kindOf(value: unknown): Kind {
  if (value !== "stage" && value !== "pillar" && value !== "funnel")
    throw badRequest("Tipo inválido.", { type: "Use stage, pillar ou funnel." });
  return value;
}

const createShape = {
  name: v.string({ min: 1, max: 60 }),
  color: v.string({ min: 2, max: 20 }),
  kind: v.string({ min: 0, max: 20 }),
  description: v.string({ min: 0, max: 400 }),
};

/** Cria uma etapa, pilar ou etapa de funil. */
export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const body = (await readJson(request)) as Record<string, unknown>;
    const type = kindOf(body.type);
    const input = parse(createShape, { color: "blue", kind: "production", description: "", ...body });
    const table = TABLES[type];

    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(position), -1) + 1` })
      .from(table)
      .where(eq(table.clientId, clientId));

    const base = { id: newId(PREFIX[type]), clientId, name: input.name, color: input.color, position: Number(next) };
    const row =
      type === "stage" ? { ...base, kind: input.kind || "production", wipLimit: null }
      : type === "pillar" ? { ...base, description: input.description || null }
      : base;

    await db.insert(table as typeof stages).values(row as typeof stages.$inferInsert);
    await logActivity(db, { clientId, userId: session.user.id, action: `${type}.created`, meta: { name: input.name } });
    return ok({ type, item: row }, 201);
  });
}

const patchShape = {
  name: v.string({ min: 1, max: 60 }),
  color: v.string({ min: 2, max: 20 }),
  position: v.int({ min: 0, max: 999 }),
  description: v.string({ min: 0, max: 400 }),
  wipLimit: v.int({ min: 0, max: 99 }),
};

/** Renomeia, recolore ou reordena um item da taxonomia. */
export async function PATCH(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const body = (await readJson(request)) as Record<string, unknown>;
    const type = kindOf(body.type);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) throw badRequest("Informe o id do item.", { id: "Obrigatório." });

    const patch = parsePartial(patchShape, body);
    if (!Object.keys(patch).length) throw badRequest("Nenhuma alteração informada.");
    if (type !== "stage") delete (patch as { wipLimit?: number }).wipLimit;
    if (type !== "pillar") delete (patch as { description?: string }).description;

    const table = TABLES[type];
    const result = await db
      .update(table as typeof stages)
      .set(patch)
      .where(and(eq(table.id, id), eq(table.clientId, clientId)));
    if ((result as { meta?: { changes?: number } }).meta?.changes === 0) throw notFound("Item não encontrado.");

    await logActivity(db, { clientId, userId: session.user.id, action: `${type}.updated`, meta: patch });
    return ok({ type, id, patch });
  });
}

/**
 * Remove um item. Etapas exigem destino (`moveTo`) para não órfãos;
 * pilares e funis apenas desvinculam os conteúdos.
 */
export async function DELETE(request: Request, { params }: Ctx) {
  return route(async () => {
    const { clientId } = await params;
    const db = getDb();
    const session = await getSession();
    await assertClientAccess(session, clientId, true);

    const url = new URL(request.url);
    const type = kindOf(url.searchParams.get("type"));
    const id = url.searchParams.get("id") ?? "";
    const moveTo = url.searchParams.get("moveTo");
    if (!id) throw badRequest("Informe o id do item.", { id: "Obrigatório." });

    const table = TABLES[type];

    if (type === "stage") {
      const remaining = await db
        .select({ id: stages.id })
        .from(stages)
        .where(eq(stages.clientId, clientId))
        .orderBy(asc(stages.position));
      if (remaining.length <= 1) throw conflict("O fluxo precisa de ao menos uma etapa.");

      const target = moveTo && remaining.some((s) => s.id === moveTo)
        ? moveTo
        : remaining.find((s) => s.id !== id)!.id;
      await db
        .update(contents)
        .set({ stageId: target, updatedAt: Date.now() })
        .where(and(eq(contents.clientId, clientId), eq(contents.stageId, id)));
    } else {
      await db
        .update(contents)
        .set({ [type === "pillar" ? "pillarId" : "funnelId"]: null, updatedAt: Date.now() })
        .where(and(eq(contents.clientId, clientId), eq(CONTENT_FK[type], id)));
    }

    await db.delete(table as typeof stages).where(and(eq(table.id, id), eq(table.clientId, clientId)));
    await logActivity(db, { clientId, userId: session.user.id, action: `${type}.deleted`, meta: { id } });
    return ok({ deleted: true, type, id });
  });
}
