import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { assets } from "../../../../../db/schema";
import { assertClientAccess, getSession } from "../../../../../lib/auth";
import { getContentOrThrow, logActivity } from "../../../../../lib/data";
import { ApiError, badRequest, notFound, ok, route } from "../../../../../lib/http";
import { newId } from "../../../../../lib/ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ contentId: string }> };

/** Fatia do binding R2 usada aqui. */
type R2Bucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<void>;
};

const MAX_BYTES = 45 * 1024 * 1024;
const KIND_BY_PREFIX: Array<[string, string]> = [
  ["image/", "image"], ["video/", "video"], ["audio/", "audio"],
];

function kindOf(mime: string): string {
  return KIND_BY_PREFIX.find(([prefix]) => mime.startsWith(prefix))?.[1] ?? "doc";
}

/** Nome de arquivo seguro para compor a chave do objeto. */
function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "arquivo";
}

export async function GET(_request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId);

    const rows = await db
      .select()
      .from(assets)
      .where(eq(assets.contentId, contentId))
      .orderBy(desc(assets.createdAt));
    return ok({ assets: rows });
  });
}

/**
 * Anexa mídia ao conteúdo.
 * `multipart/form-data` com `file` sobe para o R2; JSON com `url` apenas
 * registra um link externo (Drive, Dropbox) sem armazenar nada.
 */
export async function POST(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId, true);

    const contentType = request.headers.get("content-type") ?? "";
    const stamp = Date.now();
    let row;

    if (contentType.includes("multipart/form-data")) {
      const bucket = (env as { MEDIA?: R2Bucket }).MEDIA;
      if (!bucket) {
        throw new ApiError(
          503,
          "no_storage",
          "Armazenamento R2 indisponível. Declare `\"r2\": \"MEDIA\"` em .openai/hosting.json."
        );
      }

      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("Envie um arquivo no campo `file`.");
      if (file.size === 0) throw badRequest("Arquivo vazio.");
      if (file.size > MAX_BYTES) {
        throw badRequest(`Arquivo acima do limite de ${Math.floor(MAX_BYTES / 1024 / 1024)} MB.`);
      }

      const mime = file.type || "application/octet-stream";
      const key = `${content.clientId}/${contentId}/${newId("ast")}-${safeName(file.name)}`;
      await bucket.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" },
      });

      row = {
        id: newId("ast"), clientId: content.clientId, contentId,
        name: file.name || "arquivo", kind: kindOf(mime), mime, size: file.size,
        storageKey: key, url: null, createdBy: session.user.id, createdAt: stamp,
      };
    } else {
      const body = (await request.json().catch(() => null)) as { url?: string; name?: string } | null;
      const url = body?.url?.trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        throw badRequest("Informe um arquivo ou uma URL http(s).", { url: "URL inválida." });
      }
      row = {
        id: newId("ast"), clientId: content.clientId, contentId,
        name: body?.name?.trim() || url.split("/").pop() || "link",
        kind: "link", mime: null, size: null, storageKey: null, url,
        createdBy: session.user.id, createdAt: stamp,
      };
    }

    await db.insert(assets).values(row);
    await logActivity(db, {
      clientId: content.clientId, contentId, userId: session.user.id,
      action: "asset.added", meta: { name: row.name, kind: row.kind },
    });
    return ok({ asset: row }, 201);
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  return route(async () => {
    const { contentId } = await params;
    const db = getDb();
    const session = await getSession();
    const content = await getContentOrThrow(db, contentId);
    await assertClientAccess(session, content.clientId, true);

    const assetId = new URL(request.url).searchParams.get("id") ?? "";
    if (!assetId) throw badRequest("Informe o id do anexo.", { id: "Obrigatório." });

    const [row] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.contentId, contentId)))
      .limit(1);
    if (!row) throw notFound("Anexo não encontrado.");

    if (row.storageKey) {
      const bucket = (env as { MEDIA?: R2Bucket }).MEDIA;
      // O registro sai mesmo se o objeto não puder ser removido: um arquivo
      // órfão no bucket é menos grave que um anexo fantasma na interface.
      await bucket?.delete(row.storageKey).catch((error) => console.error("[r2]", error));
    }

    await db.delete(assets).where(eq(assets.id, assetId));
    return ok({ deleted: true });
  });
}
