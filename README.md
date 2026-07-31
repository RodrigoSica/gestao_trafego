# Studio OS

Sistema proprietário de gestão editorial e produção de conteúdo de Rodrigo
Sicheroli. Multi-tenant: uma instalação atende qualquer número de clientes, cada
um com fluxo de produção, pilares e funil próprios.

Stack: vinext (Next.js App Router) + React 19 + Cloudflare Workers + D1 + Drizzle.

## Como rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:3001`. No primeiro acesso o front chama
`POST /api/bootstrap` sozinho: cria as tabelas e semeia a conta **Forja do Sica**
com os 60 conteúdos do cronograma original.

| Comando | O que faz |
| --- | --- |
| `npm run dev` | desenvolvimento local com D1 simulado (Miniflare) |
| `npm run build` | build de produção |
| `npm test` | build + suíte de testes |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | gera migration Drizzle após mudar `db/schema.ts` |

## Modelo de dados

```
users ─┬─ memberships ─── clients ─┬─ stages    (colunas do kanban)
       │                           ├─ pillars   (temas editoriais)
       │                           ├─ funnels   (fases do funil)
       │                           └─ contents ─┬─ comments  (aprovação do cliente)
       │                                        ├─ metrics   (desempenho publicado)
       │                                        └─ assets    (peças e referências)
       └─ activities (trilha de auditoria por cliente)
```

A taxonomia é **por cliente**: é o que permite operar contas com processos
editoriais completamente diferentes na mesma instalação.

## Identidade e permissões

A sessão vem dos headers de identidade do host (`oai-authenticated-user-*`). O
usuário é criado no primeiro acesso e **o primeiro usuário do banco vira `owner`**
do estúdio. Sem headers — desenvolvimento local — cai na conta do dono.

Papéis: `owner`/`admin` enxergam todos os clientes; `member` e `client` só os
clientes onde têm `membership`. `client` (aprovador externo) tem leitura e pode
comentar/aprovar, mas não editar.

Toda rota de dados chama `assertClientAccess()` antes de tocar o banco — há um
teste que falha se alguma rota esquecer.

## API

Envelope padrão: `{ data }` em sucesso, `{ error: { code, message, fields? } }` em falha.

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/api/bootstrap` | cria o esquema e semeia a primeira conta (idempotente) |
| GET · POST | `/api/clients` | lista clientes com resumo · cadastra cliente |
| GET · PATCH · DELETE | `/api/clients/:id` | bundle do workspace · edita · arquiva |
| GET · POST · PATCH | `/api/clients/:id/contents` | lista filtrada · cria · ações em lote |
| POST · PATCH · DELETE | `/api/clients/:id/taxonomy` | etapas, pilares e funil |
| GET | `/api/clients/:id/insights` | agregações de desempenho |
| GET · PATCH · DELETE | `/api/contents/:id` | ficha completa · edita · exclui |
| POST | `/api/contents/:id/comments` | comenta, aprova ou pede ajustes |
| POST | `/api/contents/:id/metrics` | registra leitura de desempenho |

## Migrations

`db/schema.ts` é a fonte de verdade. Depois de alterá-lo:

1. `npm run db:generate` — gera o SQL em `drizzle/` para o pipeline do host;
2. atualize `db/ddl.ts` — é o DDL idempotente que `POST /api/bootstrap` aplica.

`npm test` compara as duas fontes e falha se divergirem (tabelas, colunas ou
índices de tenant).

> D1 aceita no máximo 100 parâmetros por statement. Inserções em massa precisam
> ser fatiadas — ver `CHUNK` em `lib/provision.ts`.

## Limitações conhecidas

- **Upload de arquivo**: a tabela `assets` existe e a API aceita URLs externas,
  mas não há upload para R2 — `.openai/hosting.json` mantém `"r2": null`.
- **Convite de equipe**: `memberships` está modelado e é respeitado nas
  permissões, mas não há tela de convite por e-mail.
- **Publicação nas redes**: o sistema planeja, aprova e mede; não publica.
- `worker/index.ts` (arquivo do template) tem 2 erros de `tsc` por não declarar
  `Fetcher`/`D1Database`. São anteriores a este trabalho e não afetam o build.

## Estrutura

```
app/              rotas — página única + 9 route handlers de API
components/       studio (shell), views, editor, admin, ui, types
lib/              http (envelope + validação), auth, provision, data, ids
db/               schema (Drizzle), ddl (bootstrap), seed-forja
tests/            paridade schema↔DDL, superfície de API, checagem de tenant
```
