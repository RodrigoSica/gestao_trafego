import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // Dispara a fila de publicação a cada 5 minutos. Nem toda hospedagem honra
  // `triggers`; por isso a fila também roda por POST /api/publishing/run, que
  // qualquer agendador externo pode chamar. Ver README > Agendamento.
  triggers: { crons: ["*/5 * * * *"] },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

// Vercel (and other Nitro-supported platforms) build with `vite build`
// directly instead of `vinext build`, and don't have Cloudflare bindings.
// Vercel sets `VERCEL=1` in its build environment; detect that here so the
// Cloudflare-specific dev/deploy path stays untouched everywhere else.
const isVercelBuild = !!process.env.VERCEL;

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  if (isVercelBuild) {
    const { nitro } = await import("nitro/vite");
    const { fileURLToPath } = await import("node:url");
    return {
      plugins: [vinext(), sites(), nitro()],
      resolve: {
        alias: {
          tailwindcss: fileURLToPath(
            new URL("./node_modules/tailwindcss/index.css", import.meta.url)
          ),
        },
      },
    };
  }

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
