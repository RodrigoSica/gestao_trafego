/**
 * Armazenamento de mídia — R2 no Cloudflare, Vercel Blob no Vercel.
 *
 * O especificador "cloudflare:workers" é montado em runtime (não como string
 * literal em `import()`) para que o bundler do Vercel (Rolldown/Nitro) não
 * tente resolvê-lo em build time — nesse ambiente ele nunca existe.
 */
type R2Object = {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string; cacheControl?: string };
};
type R2ListResult = { objects: { key: string }[]; truncated: boolean; cursor?: string };
type R2Bucket = {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: Record<string, string> }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<R2ListResult>;
};

async function getR2Bucket(): Promise<R2Bucket | null> {
  try {
    const spec = ["cloudflare", "workers"].join(":");
    const mod = (await import(/* @vite-ignore */ spec)) as { env: { MEDIA?: R2Bucket } };
    return mod.env.MEDIA ?? null;
  } catch {
    return null;
  }
}

export type StoredObject = {
  body: ReadableStream;
  size: number;
  etag: string;
  contentType?: string;
  cacheControl?: string;
};

/** Lê um objeto pela chave. Só funciona no Cloudflare — no Vercel os assets
 * carregam sua própria URL pública (Vercel Blob) e não passam por aqui. */
export async function storageGet(key: string): Promise<StoredObject | null> {
  const bucket = await getR2Bucket();
  if (!bucket) return null;

  const object = await bucket.get(key);
  if (!object) return null;
  return {
    body: object.body,
    size: object.size,
    etag: object.httpEtag,
    contentType: object.httpMetadata?.contentType,
    cacheControl: object.httpMetadata?.cacheControl,
  };
}

/** Sobe um objeto. Retorna a URL pública quando o backend for Vercel Blob
 * (para gravar direto em `assets.url`); `null` quando for R2 (servido via
 * `/media/[...key]`). Lança se nenhum backend de storage estiver configurado. */
export async function storagePut(
  key: string,
  data: ArrayBuffer,
  contentType: string
): Promise<{ url: string | null }> {
  const bucket = await getR2Bucket();
  if (bucket) {
    await bucket.put(key, data, {
      httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    });
    return { url: null };
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "Nenhum storage de mídia configurado: falta o binding R2 `MEDIA` (Cloudflare) ou a variável BLOB_READ_WRITE_TOKEN (Vercel Blob)."
    );
  }
  const { put } = await import("@vercel/blob");
  const blob = await put(key, data, { access: "public", contentType, addRandomSuffix: false });
  return { url: blob.url };
}

export async function storageDelete(keyOrUrl: string): Promise<void> {
  const bucket = await getR2Bucket();
  if (bucket) {
    await bucket.delete(keyOrUrl);
    return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const { del } = await import("@vercel/blob");
  await del(keyOrUrl);
}

/** Remove todos os objetos sob um prefixo (ex.: pasta de um cliente). Retorna a quantidade removida. */
export async function storageDeletePrefix(prefix: string): Promise<number> {
  const bucket = await getR2Bucket();
  if (bucket) {
    let removed = 0;
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, cursor });
      if (page.objects.length) {
        await bucket.delete(page.objects.map((o) => o.key));
        removed += page.objects.length;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return removed;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 0;
  const { list, del } = await import("@vercel/blob");
  const { blobs } = await list({ prefix });
  if (blobs.length) await del(blobs.map((b) => b.url));
  return blobs.length;
}
