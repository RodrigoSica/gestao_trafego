import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { contents, metrics } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { getContentOrThrow, logActivity } from "../../../../../lib/data";
import { ok, parse, readJson, route, v } from "../../../../../lib/http";
import { newId } from "../../../../../lib/ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ contentId: string }> };

const shape = {
  platform: v.string({ min: 1, max: 40 }),
  reach: v.int({ min: 0 }),
  impressions: v.int({ min: 0 }),
  likes: v.int({ min: 0 }),
  saves: v.int({ min: 0 }),
  shares: v.int({ min: 0 }),
  replies: v.int({ min: 0 }),
  clicks: v.int({ min: 0 }),
  leads: v.int({ min: 0 }),
  revenue: v.number({ min: 0 }),
};

/** Registra a leitura de desempenho de um conteúdo publicado. */
export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId, true);

    const input = parse(shape, {
      platform: "Instagram", reach: 0, impressions: 0, likes: 0, saves: 0,
      shares: 0, replies: 0, clicks: 0, leads: 0, revenue: 0,
      ...(await readJson(request)) as object,
    });

    const row = {
      id: newId("mtr"),
      clientId: content.clientId,
      contentId,
      capturedAt: Date.now(),
      ...input,
    };
    await db.insert(metrics).values(row);

    // A primeira leitura marca o conteúdo como publicado.
    if (!content.publishedAt) {
      await db
        .update(contents)
        .set({ publishedAt: Date.now(), updatedAt: Date.now() })
        .where(eq(contents.id, contentId));
    }

    await logActivity(db, {
      clientId: content.clientId, contentId, userId: session.user.id,
      action: "metrics.recorded", meta: { platform: input.platform, reach: input.reach },
    });
    return ok({ metric: row }, 201);
  });
}
