import { storageGet } from "../../../lib/storage";

export const dynamic = "force-dynamic";

/**
 * Serve a mídia anexada.
 *
 * A rota é pública de propósito: no modo notificado o responsável abre o link
 * no celular sem estar logado, e na publicação automática é a própria
 * plataforma (Instagram, TikTok) que busca o arquivo por URL. A proteção é a
 * chave do objeto, que não é adivinhável — não coloque aqui nada que não
 * possa circular por link.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const objectKey = key.join("/");

  const object = await storageGet(objectKey);
  if (!object) return new Response("Arquivo não encontrado.", { status: 404 });

  const etag = object.etag;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(object.body, {
    headers: {
      "content-type": object.contentType ?? "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": object.cacheControl ?? "public, max-age=31536000, immutable",
      etag,
      // Objetos são imutáveis e a chave é opaca; ainda assim, nada de indexação.
      "x-robots-tag": "noindex",
    },
  });
}
