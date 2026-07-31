import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { comments, contents } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { getContentOrThrow, logActivity } from "../../../../../lib/data";
import { ok, parse, readJson, route, v } from "../../../../../lib/http";
import { newId } from "../../../../../lib/ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ contentId: string }> };

const shape = {
  body: v.string({ min: 1, max: 4000 }),
  kind: v.enum(["comment", "approval", "changes"] as const),
};

/**
 * Comenta, aprova ou solicita ajustes.
 * Aprovações e pedidos de ajuste refletem no campo `approval` do conteúdo —
 * é o ciclo de validação com o cliente dentro do próprio fluxo.
 */
export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    // Aprovadores externos (papel `client`) têm permissão de escrita aqui.
    await assertClientAccess(session, content.clientId);

    const input = parse(shape, { kind: "comment", ...(await readJson(request)) as object });

    const row = {
      id: newId("cmt"),
      clientId: content.clientId,
      contentId,
      userId: session.user.id,
      body: input.body,
      kind: input.kind,
      resolved: 0,
      createdAt: Date.now(),
    };
    await db.insert(comments).values(row);

    if (input.kind !== "comment") {
      await db
        .update(contents)
        .set({ approval: input.kind === "approval" ? "approved" : "changes", updatedAt: Date.now() })
        .where(eq(contents.id, contentId));
    }

    await logActivity(db, {
      clientId: content.clientId, contentId, userId: session.user.id,
      action: input.kind === "approval" ? "content.approved"
        : input.kind === "changes" ? "content.changes_requested" : "content.commented",
      meta: { title: content.title },
    });

    return ok(
      {
        comment: {
          ...row,
          resolved: false,
          userName: session.user.name,
          userAccent: session.user.accent,
        },
      },
      201
    );
  });
}
