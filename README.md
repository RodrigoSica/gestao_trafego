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
       │                           ├─ channels  (para onde vai o aviso)
       │                           └─ contents ─┬─ comments      (aprovação do cliente)
       │                                        ├─ metrics       (desempenho publicado)
       │                                        ├─ assets        (mídia no R2 ou link)
       │                                        └─ publish_jobs  (fila de publicação)
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
| GET · POST · PATCH · DELETE | `/api/contents/:id/schedule` | prévia do aviso · agenda · confirma publicação · cancela |
| GET · POST · DELETE | `/api/contents/:id/assets` | anexos (upload R2 ou link externo) |
| GET · POST · DELETE | `/api/clients/:id/channels` | canais de aviso do cliente |
| POST | `/api/publishing/run` | executa a fila de publicação |
| GET | `/media/<chave>` | serve a mídia do R2 (público) |

## Agendamento de publicações

Funciona em **modo notificado**: no horário marcado o sistema entrega o pacote
pronto — legenda montada, arquivos e link de confirmação — para quem vai
publicar. Cobre todas as redes e formatos, sem depender de aprovação de
plataforma. A publicação automática via API é a fase seguinte.

Ciclo: `pending` → `sending` → `sent` (avisado) → `done` (confirmado no sistema).
`failed` e `canceled` são terminais.

### Quem dispara a fila

Dois caminhos, seguros de rodar juntos:

1. **Cron do Cloudflare** — declarado em `vite.config.ts` (`*/5 * * * *`) e
   tratado por `scheduled()` em `worker/index.ts`. **Nem toda hospedagem honra
   `triggers`** — o `wrangler.json` gerado sai com `"triggers":{}` até a
   plataforma preencher. Confirme no seu ambiente antes de confiar nele.
2. **`POST /api/publishing/run`** — para qualquer agendador externo
   (cron-job.org, n8n, Agendador de Tarefas do Windows). Autentica pelo header
   `x-publishing-token` igual ao segredo `PUBLISHING_TOKEN`, ou por sessão de
   owner/admin.

A reserva de job é um compare-and-swap (`UPDATE ... WHERE status = 'pending'`):
mesmo que os dois disparem juntos, a mesma publicação nunca é avisada duas
vezes. A chave `idempotency_key` (`contentId:runAt`) cobre o reagendamento.

### Variáveis de ambiente

| Variável | Para quê |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot criado no @BotFather. Sem ela o canal salva mas nunca entrega — a interface avisa |
| `PUBLIC_BASE_URL` | Origem pública do sistema. **Obrigatória para o cron**: sem ela os links de mídia sairiam quebrados, então a fila nem roda |
| `PUBLISHING_TOKEN` | Segredo do disparo externo. Sem ela, só owner/admin logado dispara |

### Canais de aviso

Por cliente, em Configurações → Avisos de publicação. Telegram (`chat_id`) ou
webhook. Webhook aceita https, e http apenas em localhost, para receptor
auto-hospedado.

> O campo do webhook **não** é uma defesa contra SSRF — `https://interno/...`
> passa. A proteção é o controle de acesso: só quem tem escrita no cliente
> cadastra canal. Se um dia usuários menos confiáveis puderem configurar
> canais, é preciso uma allowlist em `isAllowedWebhook()`.

### Mídia

Upload vai para o R2 e é servido por `GET /media/<chave>`. **A rota é pública
de propósito**: no modo notificado a pessoa abre no celular sem estar logada, e
na publicação automática é a própria plataforma que busca o arquivo por URL. A
proteção é a chave, que não é adivinhável. Não anexe nada que não possa
circular por link.

## Migrations

`db/schema.ts` é a fonte de verdade. Depois de alterá-lo:

1. `npm run db:generate` — gera o SQL em `drizzle/` para o pipeline do host;
2. atualize `db/ddl.ts` — é o DDL idempotente que `POST /api/bootstrap` aplica.

`npm test` compara as duas fontes e falha se divergirem (tabelas, colunas ou
índices de tenant).

> D1 aceita no máximo 100 parâmetros por statement. Inserções em massa precisam
> ser fatiadas — ver `CHUNK` em `lib/provision.ts`.

## Limitações conhecidas

- **Publicação automática**: o modo notificado está pronto; publicar direto
  pela API depende de App Review da Meta, auditoria da TikTok e cota do
  YouTube. `POST /api/contents/:id/schedule` recusa `mode: "auto"` até lá.
- **Cron da hospedagem**: não confirmado neste ambiente — ver Agendamento.
- **Convite de equipe**: `memberships` está modelado e é respeitado nas
  permissões, mas não há tela de convite por e-mail.
- **WhatsApp como canal**: só Telegram e webhook. WhatsApp passaria de novo pela
  revisão da Meta — o mesmo gargalo que o modo notificado existe para evitar.
- `worker/index.ts` (arquivo do template) tem 2 erros de `tsc` por não declarar
  `Fetcher`/`D1Database`. São anteriores a este trabalho e não afetam o build.

## Estrutura

```
app/              rotas — página única, 14 route handlers de API e /media
components/       studio (shell), views, editor, admin, publishing, ui, types
lib/              http (envelope + validação), auth, provision, data, ids,
                  publishing (fila e pacote), notify (Telegram/webhook)
db/               schema (Drizzle), ddl (bootstrap), seed-forja
tests/            paridade schema↔DDL, superfície de API, checagem de tenant
```
