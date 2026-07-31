import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

/**
 * O worker construído importa `cloudflare:workers` (binding D1), que o loader
 * ESM do Node não resolve — renderizar aqui exigiria o runtime workerd.
 * Validamos então o bundle e a fonte do layout, que é onde os erros dessa
 * camada aparecem na prática.
 */
test("o build embute o shell e a superfície de API", async () => {
  const bundle = await read("dist/server/index.js");
  for (const marker of ["/api/bootstrap", "/api/clients", "/api/contents", "Studio OS"]) {
    assert.ok(bundle.includes(marker), `marcador ausente no bundle: ${marker}`);
  }
});

test("o layout aplica as preferências antes da hidratação", async () => {
  const layout = await read("app/layout.tsx");
  // Sem este script o usuário vê um flash de tema claro antes do escuro assumir.
  assert.match(layout, /dangerouslySetInnerHTML/);
  assert.match(layout, /studio-theme/);
  assert.match(layout, /prefers-color-scheme/);
  assert.match(layout, /suppressHydrationWarning/);
  // studio.css precisa vir depois de globals.css para vencer no cascade.
  const globalsAt = layout.indexOf('"./globals.css"');
  const studioAt = layout.indexOf('"./studio.css"');
  assert.ok(globalsAt >= 0 && studioAt > globalsAt, "ordem de import do CSS invertida");
});

/* -------------------------------------------------------------------------
   Paridade entre `db/schema.ts` (fonte de verdade do Drizzle) e `db/ddl.ts`
   (aplicado por POST /api/bootstrap). Como o DDL é escrito à mão, qualquer
   coluna nova no schema precisa aparecer aqui — senão o deploy quebra em
   produção com "no such column".
   ------------------------------------------------------------------------- */

function tablesFromSchema(source) {
  const tables = new Map();
  const re = /sqliteTable\("([a-z_]+)",\s*\{/g;
  let match;
  while ((match = re.exec(source))) {
    const name = match[1];
    const rest = source.slice(re.lastIndex);
    const end = rest.search(/\n\}/);
    const body = rest.slice(0, end === -1 ? rest.length : end);

    const columns = new Set();
    for (const [, column] of body.matchAll(/\b(?:text|integer|real)\("([a-z_]+)"/g)) columns.add(column);
    if (/\bpk\(\)/.test(body)) columns.add("id");
    if (/\bcreatedAt\(\)/.test(body)) columns.add("created_at");
    if (/\bupdatedAt\(\)/.test(body)) columns.add("updated_at");
    tables.set(name, columns);
  }
  return tables;
}

function tablesFromDdl(source) {
  const tables = new Map();
  for (const [, name, body] of source.matchAll(
    /CREATE TABLE IF NOT EXISTS ([a-z_]+) \(([\s\S]*?)\)`/g
  )) {
    tables.set(name, body);
  }
  return tables;
}

test("o DDL do bootstrap cobre todas as tabelas e colunas do schema", async () => {
  const [schemaSource, ddlSource] = await Promise.all([read("db/schema.ts"), read("db/ddl.ts")]);
  const schema = tablesFromSchema(schemaSource);
  const ddl = tablesFromDdl(ddlSource);

  assert.ok(schema.size >= 12, `esperado ao menos 12 tabelas, achei ${schema.size}`);
  assert.deepEqual(
    [...ddl.keys()].sort(),
    [...schema.keys()].sort(),
    "tabelas do DDL divergem do schema"
  );

  for (const [table, columns] of schema) {
    const body = ddl.get(table);
    for (const column of columns) {
      assert.match(body, new RegExp(`\\b${column}\\b`), `${table}.${column} ausente no DDL`);
    }
  }
});

test("toda tabela com client_id tem índice por cliente", async () => {
  const [schemaSource, ddlSource] = await Promise.all([read("db/schema.ts"), read("db/ddl.ts")]);
  const schema = tablesFromSchema(schemaSource);
  const scoped = [...schema].filter(([, columns]) => columns.has("client_id")).map(([name]) => name);

  // `templates` aceita client_id nulo (templates globais) e não precisa de índice.
  for (const table of scoped.filter((t) => t !== "templates")) {
    assert.match(
      ddlSource,
      new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \\w+ ON ${table} \\((client_id|content_id)`),
      `${table} sem índice de tenant`
    );
  }
});

/* ------------------------------------------------------------------ rotas */

test("a superfície de API esperada existe", async () => {
  const routes = [
    "app/api/bootstrap/route.ts",
    "app/api/clients/route.ts",
    "app/api/clients/[clientId]/route.ts",
    "app/api/clients/[clientId]/contents/route.ts",
    "app/api/clients/[clientId]/taxonomy/route.ts",
    "app/api/clients/[clientId]/insights/route.ts",
    "app/api/contents/[contentId]/route.ts",
    "app/api/contents/[contentId]/comments/route.ts",
    "app/api/contents/[contentId]/metrics/route.ts",
    "app/api/contents/[contentId]/schedule/route.ts",
    "app/api/contents/[contentId]/assets/route.ts",
    "app/api/clients/[clientId]/channels/route.ts",
    "app/api/publishing/run/route.ts",
    "app/media/[...key]/route.ts",
  ];
  for (const route of routes) {
    await access(new URL(route, root));
  }
});

test("nenhuma rota de dados escapa da checagem de tenant", async () => {
  const routes = [
    "app/api/clients/[clientId]/route.ts",
    "app/api/clients/[clientId]/contents/route.ts",
    "app/api/clients/[clientId]/taxonomy/route.ts",
    "app/api/clients/[clientId]/insights/route.ts",
    "app/api/contents/[contentId]/route.ts",
    "app/api/contents/[contentId]/comments/route.ts",
    "app/api/contents/[contentId]/metrics/route.ts",
    "app/api/contents/[contentId]/schedule/route.ts",
    "app/api/contents/[contentId]/assets/route.ts",
    "app/api/clients/[clientId]/channels/route.ts",
  ];
  for (const route of routes) {
    const source = await read(route);
    assert.match(source, /assertClientAccess\(/, `${route} não valida acesso ao cliente`);
    assert.match(source, /export const dynamic = "force-dynamic"/, `${route} deveria ser dinâmica`);
  }
});

test("os bindings de D1 e R2 estão declarados no hosting", async () => {
  const hosting = JSON.parse(await read(".openai/hosting.json"));
  assert.equal(hosting.d1, "DB", "o binding D1 precisa estar declarado como DB");
  // Sem R2 o upload de mídia falha em runtime, e a mídia é o que torna o
  // pacote de publicação útil.
  assert.equal(hosting.r2, "MEDIA", "o binding R2 precisa estar declarado como MEDIA");
});

test("a fila roda mesmo se a hospedagem ignorar cron", async () => {
  // O cron é declarado, mas nem toda plataforma o honra. A rota manual é a
  // garantia de que o agendamento não depende disso.
  assert.match(await read("vite.config.ts"), /triggers:\s*\{\s*crons:/);
  assert.match(await read("worker/index.ts"), /async scheduled\(/);
  const runRoute = await read("app/api/publishing/run/route.ts");
  assert.match(runRoute, /PUBLISHING_TOKEN/, "a rota manual precisa de segredo compartilhado");
  assert.match(runRoute, /x-publishing-token/);
});

test("a exclusão definitiva de cliente é guardada e cascateia", async () => {
  const source = await read("app/api/clients/[clientId]/route.ts");
  // Arquivar continua sendo o padrão: só `?mode=purge` destrói.
  assert.match(source, /mode !== "purge"/);
  assert.match(source, /purgeClientMedia/, "o purge precisa limpar os arquivos no R2");
  assert.match(source, /forbidden\(/, "purge é restrito a owner ou admin");
  // Toda tabela filha precisa entrar na cascata, senão sobra órfão.
  for (const table of ["comments", "metrics", "assets", "publishJobs", "channels",
                       "contents", "stages", "pillars", "funnels", "memberships",
                       "activities", "templates"]) {
    assert.match(source, new RegExp(`\\b${table}\\b`), `${table} fora da cascata de exclusão`);
  }

  // O card não pode ter botão dentro de botão.
  const admin = await read("components/admin.tsx");
  assert.match(admin, /client-card-main/);
  assert.match(admin, /DeleteClientModal/);
});

test("dá para remover o registro de um job", async () => {
  const source = await read("app/api/contents/[contentId]/schedule/route.ts");
  // Sem isso, um job `failed` deixaria o selo preso no card para sempre.
  assert.match(source, /searchParams\.get\("purge"\) === "1"/);
  assert.match(source, /delete\(publishJobs\)/);
  assert.match(await read("components/publishing.tsx"), /Remover registro/);
});

test("a reserva de job impede aviso duplicado", async () => {
  const source = await read("lib/publishing.ts");
  // Compare-and-swap: só quem consegue sair de 'pending' processa o job.
  assert.match(source, /eq\(publishJobs\.status, "pending"\)/);
  assert.match(source, /meta\?\.changes === 0/);
  assert.match(source, /idempotencyKey/);
});
