/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

/**
 * Cron da fila de publicação.
 *
 * Só roda se a hospedagem honrar `triggers.crons` (declarado em
 * `vite.config.ts`). Não há como garantir isso em toda plataforma, então a
 * fila continua acessível por `POST /api/publishing/run` para qualquer
 * agendador externo. Os dois caminhos são seguros de rodar juntos: a reserva
 * de job é um compare-and-swap, e a mesma publicação nunca é avisada duas
 * vezes. Ver `lib/publishing.ts`.
 */
async function runPublishingQueue(env: Env): Promise<void> {
  try {
    const [{ getDb }, { processDueJobs }] = await Promise.all([
      import("../db"),
      import("../lib/publishing"),
    ]);
    const baseUrl = (env as unknown as { PUBLIC_BASE_URL?: string }).PUBLIC_BASE_URL;
    if (!baseUrl) {
      console.error("[cron] PUBLIC_BASE_URL ausente: os links de mídia sairiam quebrados. Fila não executada.");
      return;
    }
    const report = await processDueJobs(getDb(), { baseUrl });
    if (report.claimed > 0) console.log("[cron] fila de publicação", report);
  } catch (error) {
    console.error("[cron] falha ao processar a fila", error);
  }
}

const worker = {
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPublishingQueue(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
