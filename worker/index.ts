import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil?(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

async function runPublishingQueue(): Promise<void> {
  try {
    const [{ getDb }, { processDueJobs }] = await Promise.all([
      import("../db"),
      import("../lib/publishing"),
    ]);
    const baseUrl = process.env.PUBLIC_BASE_URL || `https://${process.env.VERCEL_URL || 'localhost:3000'}`;
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
  async scheduled(): Promise<void> {
    await runPublishingQueue();
  },

  async fetch(request: Request, env: Env = {}, ctx: ExecutionContext = {}): Promise<Response> {
    // Vercel/Node.js environment - skip image optimization for now
    // Images are served via Next.js Image Optimization
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
