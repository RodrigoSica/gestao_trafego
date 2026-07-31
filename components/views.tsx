"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "../lib/client-api";
import {
  APPROVAL_LABEL, FORMATS, JOB_LABEL, PLATFORM_GLYPH, PRIORITY_LABEL,
  type Content, type Insights, type JobStatus, type Workspace,
} from "./types";
import {
  Avatar, EmptyState, ErrorState, Spinner, fmtDay, fmtMoney, fmtMonth, fmtNum,
  monthIso, relTime, shiftMonth, todayIso,
} from "./ui";

export type ViewProps = {
  ws: Workspace;
  onOpen: (content: Content) => void;
  onPatch: (id: string, patch: Partial<Content>) => Promise<void>;
  onCreate: (seed?: Partial<Content>) => void;
  onGo: (view: string) => void;
  selection: Set<string>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  onBulk: (patch: Record<string, unknown>) => Promise<void>;
  search: string;
};

/* ------------------------------------------------------------- utilidades */

function useTaxonomy(ws: Workspace) {
  return useMemo(() => ({
    stage: new Map(ws.stages.map((s) => [s.id, s])),
    pillar: new Map(ws.pillars.map((p) => [p.id, p])),
    funnel: new Map(ws.funnels.map((f) => [f.id, f])),
    member: new Map(ws.members.map((m) => [m.id, m])),
  }), [ws]);
}

export function filterContents(ws: Workspace, search: string, extra?: (c: Content) => boolean) {
  const q = search.trim().toLowerCase();
  const pillar = new Map(ws.pillars.map((p) => [p.id, p.name.toLowerCase()]));
  return ws.contents.filter((c) => {
    if (extra && !extra(c)) return false;
    if (!q) return true;
    const haystack = `${c.title} ${c.format} ${c.cta ?? ""} ${pillar.get(c.pillarId ?? "") ?? ""}`;
    return haystack.toLowerCase().includes(q);
  });
}

function ApprovalBadge({ value }: { value: Content["approval"] }) {
  if (value === "none") return null;
  return <span className={`approval ${value}`}>{APPROVAL_LABEL[value]}</span>;
}

/** Estado do aviso de publicação, quando existe um job vivo para o conteúdo. */
function JobFlag({ ws, contentId }: { ws: Workspace; contentId: string }) {
  const job = ws.jobs?.find((j) => j.contentId === contentId);
  if (!job) return null;
  return <span className={`job-flag ${job.status}`} title={job.lastError ?? undefined}>{JOB_LABEL[job.status as JobStatus]}</span>;
}

/* ------------------------------------------------------------- visão geral */

export function Overview({ ws, onOpen, onGo, onCreate }: ViewProps) {
  const tax = useTaxonomy(ws);
  const doneIds = new Set(ws.stages.filter((s) => s.kind === "done").map((s) => s.id));
  const scheduledIds = new Set(ws.stages.filter((s) => s.kind === "scheduled").map((s) => s.id));

  const inProduction = ws.contents.filter((c) => !doneIds.has(c.stageId) && !scheduledIds.has(c.stageId)).length;
  const scheduled = ws.contents.filter((c) => scheduledIds.has(c.stageId)).length;
  const awaiting = ws.contents.filter((c) => c.approval === "pending" || c.approval === "changes").length;
  const thisMonth = monthIso(todayIso());
  const publishedMonth = ws.contents.filter((c) => c.publishedAt && monthIso(c.publishDate) === thisMonth).length;
  const plannedMonth = ws.contents.filter((c) => monthIso(c.publishDate) === thisMonth).length;
  const goal = ws.client.monthlyGoal || 1;
  const pace = Math.min(Math.round((plannedMonth / goal) * 100), 999);

  const upcoming = useMemo(
    () => ws.contents
      .filter((c) => !doneIds.has(c.stageId) && c.publishDate >= todayIso())
      .sort((a, b) => a.publishDate.localeCompare(b.publishDate))
      .slice(0, 6),
    [ws.contents] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const late = useMemo(
    () => ws.contents.filter((c) => !doneIds.has(c.stageId) && c.publishDate < todayIso()),
    [ws.contents] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="page overview">
      <section className="hero">
        <div>
          <p className="eyebrow light">PAINEL DE {ws.client.name.toUpperCase()}</p>
          <h2>A arte certa.<br /><em>No momento certo.</em></h2>
          <p>{ws.client.tagline ?? "Organize a produção, publique com consistência e acompanhe o que faz a conta avançar."}</p>
          <button onClick={() => onGo("Fluxo de produção")}>Abrir fluxo de produção →</button>
        </div>
        <div className="hero-orbit">
          <div className="orbit-line" />
          <span className="orb o1">Ideia</span>
          <span className="orb o2">Arte</span>
          <span className="orb o3">Publicar</span>
          <div className="orb-center">✦</div>
        </div>
      </section>

      <section className="metric-row">
        <Metric n={inProduction} label="em produção" tone="orange" />
        <Metric n={scheduled} label="agendados" tone="blue" />
        <Metric n={awaiting} label="aguardando cliente" tone="violet" />
        <Metric n={publishedMonth} label="publicados no mês" tone="dark" />
      </section>

      <section className="pace-bar">
        <div>
          <p className="eyebrow">RITMO DO MÊS</p>
          <h3>{plannedMonth} de {ws.client.monthlyGoal} conteúdos planejados</h3>
        </div>
        <div className="pace-track"><i style={{ width: `${Math.min(pace, 100)}%` }} /></div>
        <b className={pace >= 100 ? "on-goal" : ""}>{pace}%</b>
      </section>

      {late.length > 0 && (
        <section className="alert-panel">
          <span>⚠</span>
          <div>
            <b>{late.length} conteúdo(s) com data vencida</b>
            <p>Ainda não saíram do fluxo e a data planejada já passou.</p>
          </div>
          <button onClick={() => onGo("Biblioteca")}>Revisar</button>
        </section>
      )}

      <section className="split">
        <div className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">PRÓXIMOS LANÇAMENTOS</p>
              <h3>Na sua linha do tempo</h3>
            </div>
            <button onClick={() => onGo("Calendário")}>Ver calendário</button>
          </div>
          <div className="timeline">
            {upcoming.length === 0 && (
              <EmptyState icon="◷" title="Nada agendado à frente"
                hint="Crie o próximo conteúdo para manter o ritmo."
                action={<button className="primary" onClick={() => onCreate()}>+ Novo conteúdo</button>} />
            )}
            {upcoming.map((item) => (
              <button className="timeline-row" key={item.id} onClick={() => onOpen(item)}>
                <time>{fmtDay(item.publishDate)}</time>
                <span className={`dot ${tax.funnel.get(item.funnelId ?? "")?.color ?? "blue"}`} />
                <div>
                  <b>{item.title}</b>
                  <small>{item.format} · {tax.pillar.get(item.pillarId ?? "")?.name ?? "sem pilar"}</small>
                </div>
                <ApprovalBadge value={item.approval} />
                <i>›</i>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <p className="eyebrow">ATIVIDADE RECENTE</p>
          <h3>O que mudou</h3>
          <div className="activity-feed">
            {ws.activity.length === 0 && <p className="muted-line">Nenhum movimento registrado ainda.</p>}
            {ws.activity.slice(0, 10).map((a) => (
              <div className="activity-row" key={a.id}>
                <Avatar name={tax.member.get(a.userId ?? "")?.name ?? "?"} accent={tax.member.get(a.userId ?? "")?.accent} size={22} />
                <div>
                  <b>{actionLabel(a.action)}</b>
                  <small>{(a.meta?.title as string) ?? ws.client.name} · {relTime(a.createdAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "content.created": "Conteúdo criado",
  "content.updated": "Conteúdo atualizado",
  "content.moved": "Etapa alterada",
  "content.deleted": "Conteúdo excluído",
  "content.commented": "Novo comentário",
  "content.approved": "Aprovado pelo cliente",
  "content.changes_requested": "Ajustes solicitados",
  "content.bulk_updated": "Alteração em lote",
  "metrics.recorded": "Métrica registrada",
  "client.created": "Cliente cadastrado",
  "client.updated": "Cliente atualizado",
  "client.archived": "Cliente arquivado",
};

const TAXONOMY_NOUN: Record<string, string> = { stage: "Etapa", pillar: "Pilar", funnel: "Fase do funil" };
const TAXONOMY_VERB: Record<string, string> = { created: "criada(o)", updated: "atualizada(o)", deleted: "removida(o)" };

function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const [kind, verb] = action.split(".");
  if (TAXONOMY_NOUN[kind] && TAXONOMY_VERB[verb]) return `${TAXONOMY_NOUN[kind]} ${TAXONOMY_VERB[verb]}`;
  return action;
}

function Metric({ n, label, tone }: { n: number; label: string; tone: string }) {
  return <div className={`metric ${tone}`}><b>{n}</b><span>{label}</span></div>;
}

/* -------------------------------------------------------- fluxo (kanban) */

/** Espaçamento usado ao mandar um card para o topo ou o fim de uma coluna. */
const POSITION_STEP = 1000;
/** Abaixo disto o ponto médio deixa de separar os vizinhos: hora de normalizar. */
const MIN_GAP = 0.000001;

/** Ordem de fila da coluna: posição, com a data como desempate estável. */
function byQueue(a: Content, b: Content) {
  return a.position - b.position || a.publishDate.localeCompare(b.publishDate) || a.id.localeCompare(b.id);
}

export function Board(props: ViewProps) {
  const { ws, onOpen, onPatch, onCreate, search, selection, toggleSelect } = props;
  const tax = useTaxonomy(ws);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  /** Onde a linha de encaixe aparece: antes de `beforeId`, ou no fim da coluna. */
  const [target, setTarget] = useState<{ stageId: string; beforeId: string | null } | null>(null);
  const [reordering, setReordering] = useState(false);
  const items = filterContents(ws, search);

  /** Lista completa da etapa, sem o filtro de busca — é ela que define os vizinhos. */
  const queueOf = (stageId: string) => ws.contents.filter((c) => c.stageId === stageId).sort(byQueue);

  const clearDrag = () => { setDragId(null); setOverStage(null); setTarget(null); };

  const drop = async (stageId: string) => {
    const id = dragId;
    const beforeId = target?.stageId === stageId ? target.beforeId : null;
    clearDrag();
    if (!id || beforeId === id) return;

    const dragged = ws.contents.find((c) => c.id === id);
    if (!dragged) return;

    // Vizinhos calculados sobre a fila real, sem o card arrastado.
    const queue = queueOf(stageId).filter((c) => c.id !== id);
    const index = beforeId ? queue.findIndex((c) => c.id === beforeId) : queue.length;
    const at = index === -1 ? queue.length : index;
    const prev = queue[at - 1];
    const next = queue[at];

    const sameStage = dragged.stageId === stageId;
    if (sameStage && prev?.id === id) return;

    let position: number;
    if (prev && next) {
      if (next.position - prev.position < MIN_GAP) {
        // Sem espaço entre os vizinhos: normaliza a coluna e refaz a conta.
        setReordering(true);
        try {
          const { positions } = await api.post<{ positions: Array<{ id: string; position: number }> }>(
            `/api/clients/${ws.client.id}/contents/reorder`,
            { stageId }
          );
          const fresh = new Map(positions.map((p) => [p.id, p.position]));
          const p = fresh.get(prev.id);
          const n = fresh.get(next.id);
          position = p !== undefined && n !== undefined ? (p + n) / 2 : (prev.position + next.position) / 2;
        } catch {
          position = (prev.position + next.position) / 2;
        } finally {
          setReordering(false);
        }
      } else {
        position = (prev.position + next.position) / 2;
      }
    } else if (prev) {
      position = prev.position + POSITION_STEP;
    } else if (next) {
      position = next.position - POSITION_STEP;
    } else {
      position = 0;
    }

    if (sameStage && dragged.position === position) return;
    await onPatch(id, sameStage ? { position } : { stageId, position });
  };

  /** Metade de cima do card insere antes dele; metade de baixo, depois. */
  const hoverCard = (event: React.DragEvent, stageId: string, cardId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    setOverStage(stageId);
    if (before) return setTarget({ stageId, beforeId: cardId });
    const queue = queueOf(stageId);
    const at = queue.findIndex((c) => c.id === cardId);
    setTarget({ stageId, beforeId: queue[at + 1]?.id ?? null });
  };

  return (
    <div className="page board-wrap">
      <div className="view-bar">
        <p>
          Arraste entre as etapas e solte na altura desejada — a linha laranja mostra onde o card encaixa.
          {reordering && " Reorganizando a fila..."}
        </p>
        <span className="count-pill">{items.length} conteúdo(s)</span>
      </div>
      <div className="board">
        {ws.stages.map((stage) => {
          const list = items.filter((x) => x.stageId === stage.id).sort(byQueue);
          const over = stage.wipLimit != null && list.length > stage.wipLimit;
          const atEnd = target?.stageId === stage.id && target.beforeId === null;
          return (
            <div
              className={`column ${overStage === stage.id ? "drop-target" : ""}`}
              key={stage.id}
              // Sem card sob o ponteiro, o alvo é o fim da fila.
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id); setTarget({ stageId: stage.id, beforeId: null }); }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setOverStage((s) => (s === stage.id ? null : s));
                setTarget((t) => (t?.stageId === stage.id ? null : t));
              }}
              onDrop={() => drop(stage.id)}
            >
              <div className="column-head">
                <span className={`status-dot ${stage.color}`} />
                <b>{stage.name}</b>
                <em className={over ? "over-wip" : ""}>{list.length}{stage.wipLimit != null ? `/${stage.wipLimit}` : ""}</em>
              </div>
              {list.map((item) => (
                <div key={item.id} className="card-slot">
                  {target?.stageId === stage.id && target.beforeId === item.id && <div className="drop-line" />}
                <article
                  className={`content-card ${dragId === item.id ? "dragging" : ""} ${selection.has(item.id) ? "picked" : ""} p${item.priority}`}
                  draggable
                  onDragStart={() => setDragId(item.id)}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => hoverCard(e, stage.id, item.id)}
                  onClick={(e) => (e.metaKey || e.ctrlKey ? toggleSelect(item.id) : onOpen(item))}
                >
                  <div className="card-top">
                    <span className={`chip ${tax.funnel.get(item.funnelId ?? "")?.color ?? "blue"}`}>
                      {tax.funnel.get(item.funnelId ?? "")?.name ?? "sem funil"}
                    </span>
                    <span>{fmtDay(item.publishDate)}</span>
                  </div>
                  <h4>{item.title}</h4>
                  <p>{item.format} · {tax.pillar.get(item.pillarId ?? "")?.name ?? "sem pilar"}</p>
                  <div className="card-foot">
                    <div className="avatars">
                      {item.platforms.map((p) => <span key={p} title={p}>{PLATFORM_GLYPH[p] ?? "•"}</span>)}
                    </div>
                    <ApprovalBadge value={item.approval} />
                    <JobFlag ws={ws} contentId={item.id} />
                    {item.priority > 0 && <span className={`prio p${item.priority}`}>{PRIORITY_LABEL[item.priority]}</span>}
                  </div>
                </article>
                </div>
              ))}
              {atEnd && dragId && <div className="drop-line" />}
              <button className="add-card" onClick={() => onCreate({ stageId: stage.id })}>+ Adicionar</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- calendário */

export function Calendar(props: ViewProps) {
  const { ws, onOpen, onCreate, onPatch, search } = props;
  const tax = useTaxonomy(ws);
  const [month, setMonth] = useState(() => {
    const dates = ws.contents.map((c) => c.publishDate).sort();
    return monthIso(dates[0] ?? todayIso());
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const items = filterContents(ws, search);

  const [year, m] = month.split("-").map(Number);
  const first = new Date(year, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, m, 0).getDate();
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const monthTotal = items.filter((c) => monthIso(c.publishDate) === month).length;

  return (
    <div className="page calendar-page">
      <div className="calendar-top">
        <div>
          <p className="eyebrow">PLANEJAMENTO EDITORIAL · {monthTotal} CONTEÚDOS</p>
          <h2>{fmtMonth(month)}</h2>
        </div>
        <div>
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
          <button onClick={() => setMonth(monthIso(todayIso()))}>Hoje</button>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
          <button className="primary" onClick={() => onCreate({ publishDate: `${month}-01` })}>+ Criar neste mês</button>
        </div>
      </div>
      <div className="weekday">{["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"].map((x) => <span key={x}>{x}</span>)}</div>
      <div className="calendar-grid">
        {cells.map((day, i) => {
          if (!day) return <div className="calendar-cell empty" key={`e${i}`} />;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const entries = items.filter((x) => x.publishDate === date);
          return (
            <div
              className={`calendar-cell ${date === todayIso() ? "today" : ""}`}
              key={date}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async () => {
                const id = dragId;
                setDragId(null);
                if (id) await onPatch(id, { publishDate: date });
              }}
              onDoubleClick={() => onCreate({ publishDate: date })}
            >
              <b>{day}</b>
              {entries.map((x) => (
                <button
                  draggable
                  onDragStart={() => setDragId(x.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(x)}
                  key={x.id}
                  className={`cal-item ${tax.funnel.get(x.funnelId ?? "")?.color ?? "blue"}`}
                >
                  <span>{x.format === "Vídeo" ? "▶" : "▣"}</span>{x.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- biblioteca */

type SortKey = "publishDate" | "title" | "format" | "updatedAt";

export function Library(props: ViewProps) {
  const { ws, onOpen, search, selection, toggleSelect, clearSelection, onBulk } = props;
  const tax = useTaxonomy(ws);
  const [stageId, setStageId] = useState("");
  const [pillarId, setPillarId] = useState("");
  const [funnelId, setFunnelId] = useState("");
  const [format, setFormat] = useState("");
  const [sort, setSort] = useState<SortKey>("publishDate");
  const [dir, setDir] = useState<1 | -1>(1);

  const rows = useMemo(() => {
    const list = filterContents(ws, search, (c) =>
      (!stageId || c.stageId === stageId) &&
      (!pillarId || c.pillarId === pillarId) &&
      (!funnelId || c.funnelId === funnelId) &&
      (!format || c.format === format));
    return [...list].sort((a, b) => {
      const av = a[sort] ?? "";
      const bv = b[sort] ?? "";
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [ws, search, stageId, pillarId, funnelId, format, sort, dir]);

  const header = (key: SortKey, label: string) => (
    <button
      className={`sortable ${sort === key ? "active" : ""}`}
      onClick={() => (sort === key ? setDir((d) => (d === 1 ? -1 : 1)) : (setSort(key), setDir(1)))}
    >
      {label}{sort === key ? (dir === 1 ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="page library">
      <div className="library-top">
        <div>
          <p className="eyebrow">BANCO EDITÁVEL · {rows.length} REGISTROS</p>
          <h2>Todos os conteúdos</h2>
        </div>
        <div className="filter-row">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)} aria-label="Etapa">
            <option value="">Todas as etapas</option>
            {ws.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={pillarId} onChange={(e) => setPillarId(e.target.value)} aria-label="Pilar">
            <option value="">Todos os pilares</option>
            {ws.pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={funnelId} onChange={(e) => setFunnelId(e.target.value)} aria-label="Funil">
            <option value="">Todo o funil</option>
            {ws.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Formato">
            <option value="">Todos os formatos</option>
            {FORMATS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>

      {selection.size > 0 && (
        <div className="bulk-bar">
          <b>{selection.size} selecionado(s)</b>
          <select defaultValue="" onChange={(e) => e.target.value && onBulk({ stageId: e.target.value })} aria-label="Mover para etapa">
            <option value="">Mover para...</option>
            {ws.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => e.target.value && onBulk({ pillarId: e.target.value })} aria-label="Definir pilar">
            <option value="">Definir pilar...</option>
            {ws.pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => onBulk({ archived: true })}>Arquivar</button>
          <button onClick={clearSelection}>Limpar</button>
        </div>
      )}

      <div className="data-table">
        <div className="data-head">
          <span />
          <span>{header("title", "Conteúdo")}</span>
          <span>{header("format", "Formato")}</span>
          <span>Funil</span>
          <span>{header("publishDate", "Publicação")}</span>
          <span>Etapa</span>
        </div>
        {rows.length === 0 && <EmptyState icon="⌘" title="Nenhum conteúdo encontrado" hint="Ajuste os filtros ou a busca." />}
        {rows.map((x) => (
          <div className={`data-row ${selection.has(x.id) ? "picked" : ""}`} key={x.id}>
            <input
              type="checkbox"
              checked={selection.has(x.id)}
              onChange={() => toggleSelect(x.id)}
              aria-label={`Selecionar ${x.title}`}
            />
            <button className="cell-main" onClick={() => onOpen(x)}>
              <strong>{x.title}<small>{tax.pillar.get(x.pillarId ?? "")?.name ?? "sem pilar"} · {x.platforms.join(", ") || "sem plataforma"}</small></strong>
            </button>
            <span>{x.format}</span>
            <span className={`chip ${tax.funnel.get(x.funnelId ?? "")?.color ?? "blue"}`}>
              {tax.funnel.get(x.funnelId ?? "")?.name ?? "—"}
            </span>
            <span>{fmtDay(x.publishDate)}</span>
            <span className="stage">{tax.stage.get(x.stageId)?.name ?? "—"}<ApprovalBadge value={x.approval} /><JobFlag ws={ws} contentId={x.id} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- resultados */

export function Results({ ws, onOpen }: ViewProps) {
  // Um único estado: o effect só escreve em callbacks assíncronos, e o retry
  // limpa o estado no próprio handler — nada de setState síncrono no effect.
  const [state, setState] = useState<{ data: Insights | null; error: string | null }>({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const clientId = ws.client.id;

  useEffect(() => {
    let alive = true;
    api.get<Insights>(`/api/clients/${clientId}/insights`)
      .then((d) => alive && setState({ data: d, error: null }))
      .catch((e: ApiClientError) => alive && setState({ data: null, error: e.message }));
    return () => { alive = false; };
  }, [clientId, attempt]);

  const retry = () => {
    setState({ data: null, error: null });
    setAttempt((n) => n + 1);
  };

  const { data, error } = state;
  if (error) return <div className="page"><ErrorState message={error} onRetry={retry} /></div>;
  if (!data) return <div className="page"><Spinner label="Consolidando resultados..." /></div>;

  const p = data.performance;
  const maxMonth = Math.max(...data.byMonth.map((m) => m.total), 1);

  return (
    <div className="page results">
      <section className="results-hero">
        <p className="eyebrow">VISÃO DE RESULTADOS · ÚLTIMOS {data.windowDays} DIAS</p>
        <h2>O que aconteceu<br />depois de publicar.</h2>
        <p>{p.samples > 0
          ? `${p.samples} leitura(s) de desempenho registradas.`
          : "Nenhuma métrica registrada ainda. Abra um conteúdo publicado e lance os números na aba Métricas."}</p>
      </section>

      <section className="kpi-grid">
        <Kpi label="Alcance" value={fmtNum(p.reach)} />
        <Kpi label="Impressões" value={fmtNum(p.impressions)} />
        <Kpi label="Salvamentos" value={fmtNum(p.saves)} />
        <Kpi label="Cliques" value={fmtNum(p.clicks)} />
        <Kpi label="CTR" value={`${(p.ctr * 100).toFixed(2)}%`} />
        <Kpi label="Leads" value={fmtNum(p.leads)} />
        <Kpi label="Receita atribuída" value={fmtMoney(p.revenue)} />
      </section>

      <section className="split">
        <div className="panel">
          <p className="eyebrow">DISTRIBUIÇÃO POR FUNIL</p>
          <h3>Equilíbrio da pauta</h3>
          <div className="funnel-stats">
            {data.byFunnel.map((f) => {
              const max = Math.max(...data.byFunnel.map((x) => x.total), 1);
              return (
                <div key={f.id}>
                  <span className={`dot ${f.color}`} /><b>{f.total}</b><small>{f.name}</small>
                  <div><i style={{ width: `${Math.max((f.total / max) * 100, 4)}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">RITMO MENSAL</p>
          <h3>Planejado vs publicado</h3>
          <div className="month-bars">
            {data.byMonth.map((m) => (
              <div key={m.month} className="month-bar">
                <div className="bar-track">
                  <i className="planned" style={{ height: `${(m.total / maxMonth) * 100}%` }} />
                  <i className="published" style={{ height: `${(m.published / maxMonth) * 100}%` }} />
                </div>
                <small>{m.month.slice(5)}/{m.month.slice(2, 4)}</small>
                <b>{m.published}/{m.total}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">DESTAQUES</p>
        <h3>Conteúdos com maior alcance</h3>
        {data.topContents.length === 0
          ? <EmptyState icon="◌" title="Sem métricas registradas" hint="Cadastre números para ver o ranking aqui." />
          : (
            <div className="rank-list">
              {data.topContents.map((c, i) => {
                const full = ws.contents.find((x) => x.id === c.id);
                return (
                  <button key={c.id} className="rank-row" onClick={() => full && onOpen(full)} disabled={!full}>
                    <em>{i + 1}</em>
                    <div><b>{c.title}</b><small>{c.format}</small></div>
                    <span>{fmtNum(c.reach)} alcance</span>
                    <span>{c.leads} leads</span>
                    <span>{fmtMoney(c.revenue)}</span>
                  </button>
                );
              })}
            </div>
          )}
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="kpi"><span>{label}</span><b>{value}</b></div>;
}
