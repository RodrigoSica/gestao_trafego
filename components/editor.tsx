"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "../lib/client-api";
import {
  APPROVAL_LABEL, FORMATS, PLATFORMS, PRIORITY_LABEL,
  type Comment, type Content, type Metric, type Workspace,
} from "./types";
import { Avatar, Spinner, fmtFull, fmtMoney, fmtNum, relTime, todayIso } from "./ui";

type Draft = Omit<Content, "id" | "clientId" | "createdAt" | "updatedAt" | "createdBy"> & { id?: string };

const emptyDraft = (ws: Workspace, seed?: Partial<Content>): Draft => ({
  title: "",
  format: "Vídeo",
  publishDate: todayIso(),
  publishTime: null,
  stageId: ws.stages[0]?.id ?? "",
  pillarId: ws.pillars[0]?.id ?? null,
  funnelId: ws.funnels[0]?.id ?? null,
  platforms: ["Instagram"],
  cta: "",
  hook: "",
  script: "",
  notes: "",
  assigneeId: null,
  priority: 0,
  approval: "none",
  publishedAt: null,
  permalink: null,
  archived: false,
  position: 0,
  ...seed,
});

type Tab = "ficha" | "roteiro" | "aprovacao" | "metricas";

export function Editor({ ws, content, seed, onClose, onSaved, onDeleted, notify }: {
  ws: Workspace;
  content: Content | null;
  seed?: Partial<Content>;
  onClose: () => void;
  onSaved: (content: Content, isNew: boolean) => void;
  onDeleted: (id: string) => void;
  notify: { ok: (m: string) => void; fail: (m: string) => void };
}) {
  const isNew = !content;
  const [draft, setDraft] = useState<Draft>(() => (content ? { ...content } : emptyDraft(ws, seed)));
  const [tab, setTab] = useState<Tab>("ficha");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Comment[] | null>(isNew ? [] : null);
  const [metrics, setMetrics] = useState<Metric[] | null>(isNew ? [] : null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Carrega comentários e métricas sob demanda.
  useEffect(() => {
    if (isNew || !content || comments !== null) return;
    api.get<{ comments: Comment[]; metrics: Metric[] }>(`/api/contents/${content.id}`)
      .then((d) => { setComments(d.comments); setMetrics(d.metrics); })
      .catch((e: ApiClientError) => notify.fail(e.message));
  }, [isNew, content, comments, notify]);

  const save = async () => {
    setErrors({});
    if (!draft.title.trim()) return setErrors({ title: "Informe um título." });
    setSaving(true);
    try {
      const payload = {
        title: draft.title, format: draft.format, publishDate: draft.publishDate,
        stageId: draft.stageId, pillarId: draft.pillarId ?? "", funnelId: draft.funnelId ?? "",
        platforms: draft.platforms, cta: draft.cta ?? "", hook: draft.hook ?? "",
        script: draft.script ?? "", notes: draft.notes ?? "", priority: draft.priority,
        approval: draft.approval, permalink: draft.permalink ?? "",
      };
      if (isNew) {
        const { content: created } = await api.post<{ content: Content }>(`/api/clients/${ws.client.id}/contents`, payload);
        onSaved(created, true);
        notify.ok("Conteúdo criado.");
      } else {
        const { content: updated } = await api.patch<{ content: Content }>(`/api/contents/${content!.id}`, payload);
        onSaved(updated, false);
        notify.ok("Alterações salvas.");
      }
      onClose();
    } catch (e) {
      const err = e as ApiClientError;
      if (err.failure.fields) setErrors(err.failure.fields);
      notify.fail(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!content || !confirm(`Excluir "${content.title}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.del(`/api/contents/${content.id}`);
      onDeleted(content.id);
      notify.ok("Conteúdo excluído.");
      onClose();
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    }
  };

  const togglePlatform = (name: string) =>
    set("platforms", draft.platforms.includes(name)
      ? draft.platforms.filter((x) => x !== name)
      : [...draft.platforms, name]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="editor wide" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header>
          <div>
            <p className="eyebrow">{isNew ? "NOVO CONTEÚDO" : `FICHA · ${ws.client.name.toUpperCase()}`}</p>
            <h2>{isNew ? "Criar conteúdo" : draft.title || "Editar criação"}</h2>
          </div>
          <button className="close" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <nav className="tabs">
          {([["ficha", "Ficha"], ["roteiro", "Roteiro"], ["aprovacao", "Aprovação"], ["metricas", "Métricas"]] as const)
            .map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
                disabled={isNew && key !== "ficha" && key !== "roteiro"}
              >
                {label}
                {key === "aprovacao" && comments?.length ? <em>{comments.length}</em> : null}
              </button>
            ))}
        </nav>

        <div className="editor-body">
          {tab === "ficha" && (
            <>
              <label className="full">
                Título
                <input value={draft.title} onChange={(e) => set("title", e.target.value)} autoFocus />
                {errors.title && <small className="field-error">{errors.title}</small>}
              </label>
              <div className="form-grid">
                <label>Data de publicação
                  <input type="date" value={draft.publishDate} onChange={(e) => set("publishDate", e.target.value)} />
                </label>
                <label>Formato
                  <select value={draft.format} onChange={(e) => set("format", e.target.value)}>
                    {FORMATS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </label>
                <label>Etapa do fluxo
                  <select value={draft.stageId} onChange={(e) => set("stageId", e.target.value)}>
                    {ws.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>Funil
                  <select value={draft.funnelId ?? ""} onChange={(e) => set("funnelId", e.target.value || null)}>
                    <option value="">—</option>
                    {ws.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label>Pilar
                  <select value={draft.pillarId ?? ""} onChange={(e) => set("pillarId", e.target.value || null)}>
                    <option value="">—</option>
                    {ws.pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label>Prioridade
                  <select value={draft.priority} onChange={(e) => set("priority", Number(e.target.value))}>
                    {PRIORITY_LABEL.map((label, i) => <option key={label} value={i}>{label}</option>)}
                  </select>
                </label>
              </div>
              <fieldset>
                <legend>Plataformas</legend>
                {PLATFORMS.map((p) => (
                  <label className="toggle" key={p}>
                    <input type="checkbox" checked={draft.platforms.includes(p)} onChange={() => togglePlatform(p)} />
                    <span />{p}
                  </label>
                ))}
              </fieldset>
              <label className="full">CTA
                <input value={draft.cta ?? ""} onChange={(e) => set("cta", e.target.value)} placeholder="Ex.: Solicite um orçamento" />
              </label>
              {!isNew && (
                <label className="full">Link da publicação
                  <input value={draft.permalink ?? ""} onChange={(e) => set("permalink", e.target.value)} placeholder="https://..." />
                </label>
              )}
            </>
          )}

          {tab === "roteiro" && (
            <>
              <label className="full">Gancho (primeiros 3 segundos)
                <input value={draft.hook ?? ""} onChange={(e) => set("hook", e.target.value)} placeholder="A frase que segura a atenção" />
              </label>
              <label className="full">Roteiro
                <textarea rows={10} value={draft.script ?? ""} onChange={(e) => set("script", e.target.value)}
                  placeholder="Cena a cena, texto na tela, narração..." />
              </label>
              <label className="full">Observações de produção
                <textarea rows={4} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)}
                  placeholder="Referências, links, materiais necessários..." />
              </label>
            </>
          )}

          {tab === "aprovacao" && content && (
            <ApprovalTab
              content={content}
              comments={comments}
              onPosted={(c, approval) => {
                setComments((list) => [...(list ?? []), c]);
                if (approval) set("approval", approval);
              }}
              notify={notify}
            />
          )}

          {tab === "metricas" && content && (
            <MetricsTab content={content} metrics={metrics} onAdded={(m) => setMetrics((l) => [m, ...(l ?? [])])} notify={notify} />
          )}
        </div>

        <footer>
          {!isNew && <button className="delete" onClick={remove}>Excluir</button>}
          <div>
            {!isNew && <small className="muted-line">Atualizado {relTime(content!.updatedAt)}</small>}
            <button onClick={onClose}>Cancelar</button>
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? "Salvando..." : isNew ? "Criar conteúdo" : "Salvar alterações"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- aprovação */

function ApprovalTab({ content, comments, onPosted, notify }: {
  content: Content;
  comments: Comment[] | null;
  onPosted: (comment: Comment, approval?: Content["approval"]) => void;
  notify: { ok: (m: string) => void; fail: (m: string) => void };
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const post = async (kind: Comment["kind"]) => {
    const text = body.trim() || (kind === "approval" ? "Aprovado." : kind === "changes" ? "Ajustes solicitados." : "");
    if (!text) return;
    setBusy(true);
    try {
      const { comment } = await api.post<{ comment: Comment }>(`/api/contents/${content.id}/comments`, { body: text, kind });
      onPosted(comment, kind === "approval" ? "approved" : kind === "changes" ? "changes" : undefined);
      setBody("");
      notify.ok(kind === "approval" ? "Conteúdo aprovado." : kind === "changes" ? "Ajustes registrados." : "Comentário enviado.");
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="approval-tab">
      <div className={`approval-banner ${content.approval}`}>
        <b>{APPROVAL_LABEL[content.approval]}</b>
        <span>O ciclo de validação fica registrado junto ao conteúdo.</span>
      </div>

      {comments === null ? <Spinner label="Carregando conversa..." /> : (
        <div className="comment-list">
          {comments.length === 0 && <p className="muted-line">Nenhum comentário ainda.</p>}
          {comments.map((c) => (
            <div className={`comment ${c.kind}`} key={c.id}>
              <Avatar name={c.userName} accent={c.userAccent} size={26} />
              <div>
                <b>{c.userName ?? "Alguém"}
                  {c.kind !== "comment" && <em>{c.kind === "approval" ? "aprovou" : "pediu ajustes"}</em>}
                </b>
                <p>{c.body}</p>
                <small>{relTime(c.createdAt)}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="full">Nova mensagem
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva um comentário ou registre a decisão..." />
      </label>
      <div className="approval-actions">
        <button onClick={() => post("comment")} disabled={busy || !body.trim()}>Comentar</button>
        <button className="ghost-warn" onClick={() => post("changes")} disabled={busy}>Solicitar ajustes</button>
        <button className="primary" onClick={() => post("approval")} disabled={busy}>Aprovar</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- métricas */

const METRIC_FIELDS: Array<[keyof Metric, string]> = [
  ["reach", "Alcance"], ["impressions", "Impressões"], ["likes", "Curtidas"],
  ["saves", "Salvamentos"], ["shares", "Compartilhamentos"], ["replies", "Comentários"],
  ["clicks", "Cliques"], ["leads", "Leads"], ["revenue", "Receita (R$)"],
];

function MetricsTab({ content, metrics, onAdded, notify }: {
  content: Content;
  metrics: Metric[] | null;
  onAdded: (m: Metric) => void;
  notify: { ok: (m: string) => void; fail: (m: string) => void };
}) {
  const [form, setForm] = useState<Record<string, number>>({});
  const [platform, setPlatform] = useState(content.platforms[0] ?? "Instagram");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { metric } = await api.post<{ metric: Metric }>(`/api/contents/${content.id}/metrics`, { platform, ...form });
      onAdded(metric);
      setForm({});
      notify.ok("Métrica registrada.");
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="metrics-tab">
      {metrics === null ? <Spinner /> : metrics.length > 0 && (
        <div className="metric-history">
          {metrics.map((m) => (
            <div key={m.id}>
              <b>{m.platform}</b>
              <span>{fmtNum(m.reach)} alcance</span>
              <span>{fmtNum(m.clicks)} cliques</span>
              <span>{m.leads} leads</span>
              <span>{fmtMoney(m.revenue)}</span>
              <small>{fmtFull(new Date(m.capturedAt).toISOString().slice(0, 10))}</small>
            </div>
          ))}
        </div>
      )}

      <label className="full">Plataforma
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {(content.platforms.length ? content.platforms : ["Instagram"]).map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <div className="form-grid">
        {METRIC_FIELDS.map(([key, label]) => (
          <label key={key as string}>{label}
            <input
              type="number" min={0}
              value={form[key as string] ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, [key as string]: Number(e.target.value) || 0 }))}
            />
          </label>
        ))}
      </div>
      <div className="approval-actions">
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? "Registrando..." : "Registrar leitura"}
        </button>
      </div>
    </div>
  );
}
