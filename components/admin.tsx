"use client";

import { useState } from "react";
import { api, ApiClientError } from "../lib/client-api";
import type { Client, Funnel, Pillar, Stage, Workspace } from "./types";
import { EmptyState, Modal, relTime } from "./ui";

type Notify = { ok: (m: string) => void; fail: (m: string) => void };

/* ---------------------------------------------------------------- clientes */

export function ClientsView({ clients, activeId, onSelect, onCreated, canManage, notify }: {
  clients: Client[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreated: (client: Client) => void;
  canManage: boolean;
  notify: Notify;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="page clients-page">
      <div className="library-top">
        <div>
          <p className="eyebrow">CARTEIRA DO ESTÚDIO · {clients.length} CONTA(S)</p>
          <h2>Clientes</h2>
        </div>
        {canManage && <button className="primary" onClick={() => setCreating(true)}>+ Novo cliente</button>}
      </div>

      {clients.length === 0 ? (
        <EmptyState icon="◈" title="Nenhum cliente cadastrado"
          hint="Cadastre a primeira conta para começar a planejar conteúdo."
          action={canManage ? <button className="primary" onClick={() => setCreating(true)}>+ Novo cliente</button> : undefined} />
      ) : (
        <div className="client-grid">
          {clients.map((c) => (
            <button
              key={c.id}
              className={`client-card ${c.id === activeId ? "active" : ""} ${c.status !== "active" ? "muted" : ""}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="client-mark" style={{ background: c.brandPrimary }}>{c.initials ?? "??"}</span>
              <div>
                <b>{c.name}</b>
                <small>{c.tagline ?? c.slug}</small>
              </div>
              <div className="client-stats">
                <span><em>{c.stats?.total ?? 0}</em>conteúdos</span>
                <span><em>{c.stats?.pending ?? 0}</em>com o cliente</span>
                <span><em>{c.stats?.published ?? 0}</em>publicados</span>
              </div>
              {c.status !== "active" && <span className="client-status">{c.status}</span>}
            </button>
          ))}
        </div>
      )}

      {creating && <NewClientModal onClose={() => setCreating(false)} onCreated={onCreated} notify={notify} />}
    </div>
  );
}

function NewClientModal({ onClose, onCreated, notify }: {
  onClose: () => void; onCreated: (client: Client) => void; notify: Notify;
}) {
  const [form, setForm] = useState({
    name: "", slug: "", tagline: "", brandPrimary: "#e96f34", brandAccent: "#5c75d8", monthlyGoal: 30,
  });
  const [pillars, setPillars] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setErrors({});
    if (form.name.trim().length < 2) return setErrors({ name: "Informe o nome do cliente." });
    setBusy(true);
    try {
      const { client } = await api.post<{ client: Client }>("/api/clients", {
        ...form,
        pillarNames: pillars.split(",").map((s) => s.trim()).filter(Boolean),
      });
      onCreated(client);
      notify.ok(`Cliente "${client.name}" criado com fluxo e taxonomia padrão.`);
      onClose();
    } catch (e) {
      const err = e as ApiClientError;
      if (err.failure.fields) setErrors(err.failure.fields);
      notify.fail(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow="NOVA CONTA"
      title="Cadastrar cliente"
      onClose={onClose}
      footer={
        <div>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" onClick={submit} disabled={busy}>{busy ? "Criando..." : "Criar cliente"}</button>
        </div>
      }
    >
      <label className="full">Nome
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Ex.: Forja do Sica" />
        {errors.name && <small className="field-error">{errors.name}</small>}
      </label>
      <label className="full">Descrição curta
        <input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="O que o cliente faz" />
      </label>
      <div className="form-grid">
        <label>Identificador
          <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="gerado do nome" />
        </label>
        <label>Meta mensal
          <input type="number" min={0} value={form.monthlyGoal}
            onChange={(e) => setForm({ ...form, monthlyGoal: Number(e.target.value) || 0 })} />
        </label>
        <label>Cor principal
          <input type="color" value={form.brandPrimary} onChange={(e) => setForm({ ...form, brandPrimary: e.target.value })} />
        </label>
        <label>Cor de apoio
          <input type="color" value={form.brandAccent} onChange={(e) => setForm({ ...form, brandAccent: e.target.value })} />
        </label>
      </div>
      <label className="full">Pilares editoriais (separados por vírgula)
        <input value={pillars} onChange={(e) => setPillars(e.target.value)} placeholder="Marca, Autoridade, Bastidores, Ofertas" />
      </label>
      <p className="muted-line">
        O cliente já nasce com o fluxo padrão de 6 etapas e as 6 fases de funil — tudo editável em Configurações.
      </p>
    </Modal>
  );
}

/* ----------------------------------------------------------- configurações */

type TaxKind = "stage" | "pillar" | "funnel";
const COLORS = ["blue", "orange", "amber", "red", "violet", "teal", "green", "slate"];

export function SettingsView({ ws, onWorkspaceChange, onClientChange, notify }: {
  ws: Workspace;
  onWorkspaceChange: (patch: Partial<Workspace>) => void;
  onClientChange: (client: Client) => void;
  notify: Notify;
}) {
  const [form, setForm] = useState({
    name: ws.client.name,
    tagline: ws.client.tagline ?? "",
    monthlyGoal: ws.client.monthlyGoal,
    brandPrimary: ws.client.brandPrimary,
    brandAccent: ws.client.brandAccent,
    notes: ws.client.notes ?? "",
  });
  const [busy, setBusy] = useState(false);

  const saveClient = async () => {
    setBusy(true);
    try {
      const { client } = await api.patch<{ client: Client }>(`/api/clients/${ws.client.id}`, form);
      onClientChange(client);
      notify.ok("Dados do cliente atualizados.");
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page settings-page">
      <div className="library-top">
        <div>
          <p className="eyebrow">CONFIGURAÇÃO DA CONTA</p>
          <h2>{ws.client.name}</h2>
        </div>
      </div>

      <section className="panel">
        <p className="eyebrow">IDENTIDADE</p>
        <h3>Dados do cliente</h3>
        <label className="full">Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="full">Descrição<input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></label>
        <div className="form-grid">
          <label>Meta mensal
            <input type="number" min={0} value={form.monthlyGoal}
              onChange={(e) => setForm({ ...form, monthlyGoal: Number(e.target.value) || 0 })} />
          </label>
          <label>Cor principal
            <input type="color" value={form.brandPrimary} onChange={(e) => setForm({ ...form, brandPrimary: e.target.value })} />
          </label>
          <label>Cor de apoio
            <input type="color" value={form.brandAccent} onChange={(e) => setForm({ ...form, brandAccent: e.target.value })} />
          </label>
        </div>
        <label className="full">Anotações internas
          <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div className="approval-actions">
          <button className="primary" onClick={saveClient} disabled={busy}>{busy ? "Salvando..." : "Salvar dados"}</button>
        </div>
      </section>

      <TaxonomyEditor kind="stage" title="Etapas do fluxo" hint="Definem as colunas do kanban."
        items={ws.stages} ws={ws} onWorkspaceChange={onWorkspaceChange} notify={notify} />
      <TaxonomyEditor kind="funnel" title="Fases do funil" hint="Classificam a intenção de cada conteúdo."
        items={ws.funnels} ws={ws} onWorkspaceChange={onWorkspaceChange} notify={notify} />
      <TaxonomyEditor kind="pillar" title="Pilares editoriais" hint="Os temas recorrentes da marca."
        items={ws.pillars} ws={ws} onWorkspaceChange={onWorkspaceChange} notify={notify} />

      <section className="panel">
        <p className="eyebrow">EQUIPE</p>
        <h3>Quem tem acesso</h3>
        <div className="member-list">
          {ws.members.map((m) => (
            <div key={m.id}>
              <b>{m.name ?? m.email}</b><small>{m.email}</small><span className="stage">{m.role}</span>
            </div>
          ))}
        </div>
        <p className="muted-line">Convites por e-mail entram na próxima camada — hoje o acesso é do dono do estúdio.</p>
      </section>
    </div>
  );
}

const KEY_OF: Record<TaxKind, "stages" | "pillars" | "funnels"> = {
  stage: "stages", pillar: "pillars", funnel: "funnels",
};

function TaxonomyEditor({ kind, title, hint, items, ws, onWorkspaceChange, notify }: {
  kind: TaxKind;
  title: string;
  hint: string;
  items: Array<Stage | Pillar | Funnel>;
  ws: Workspace;
  onWorkspaceChange: (patch: Partial<Workspace>) => void;
  notify: Notify;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const key = KEY_OF[kind];

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { item } = await api.post<{ item: Stage | Pillar | Funnel }>(
        `/api/clients/${ws.client.id}/taxonomy`,
        { type: kind, name: name.trim(), color: COLORS[items.length % COLORS.length] }
      );
      onWorkspaceChange({ [key]: [...items, item] } as Partial<Workspace>);
      setName("");
      notify.ok(`"${item.name}" adicionado.`);
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const update = async (id: string, patch: Record<string, unknown>) => {
    const next = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    onWorkspaceChange({ [key]: next } as Partial<Workspace>);
    try {
      await api.patch(`/api/clients/${ws.client.id}/taxonomy`, { type: kind, id, ...patch });
    } catch (e) {
      onWorkspaceChange({ [key]: items } as Partial<Workspace>);
      notify.fail((e as ApiClientError).message);
    }
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`Remover "${label}"? Os conteúdos vinculados serão realocados.`)) return;
    try {
      await api.del(`/api/clients/${ws.client.id}/taxonomy?type=${kind}&id=${id}`);
      onWorkspaceChange({ [key]: items.filter((i) => i.id !== id) } as Partial<Workspace>);
      notify.ok("Item removido.");
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">{title.toUpperCase()}</p>
      <h3>{hint}</h3>
      <div className="tax-list">
        {items.map((item) => (
          <div className="tax-row" key={item.id}>
            <span className={`status-dot ${item.color}`} />
            <input value={item.name} onChange={(e) => update(item.id, { name: e.target.value })} aria-label="Nome" />
            <select value={item.color} onChange={(e) => update(item.id, { color: e.target.value })} aria-label="Cor">
              {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {kind === "stage" && (
              <input
                type="number" min={0} placeholder="WIP"
                value={(item as Stage).wipLimit ?? ""}
                onChange={(e) => update(item.id, { wipLimit: Number(e.target.value) || 0 })}
                aria-label="Limite de trabalho em andamento"
              />
            )}
            <button className="delete" onClick={() => remove(item.id, item.name)} aria-label={`Remover ${item.name}`}>×</button>
          </div>
        ))}
      </div>
      <div className="tax-add">
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} placeholder={`Adicionar em ${title.toLowerCase()}`} />
        <button onClick={add} disabled={busy || !name.trim()}>Adicionar</button>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- feed */

export function ActivityView({ ws }: { ws: Workspace }) {
  return (
    <div className="page">
      <div className="library-top">
        <div>
          <p className="eyebrow">TRILHA DE AUDITORIA</p>
          <h2>Histórico da conta</h2>
        </div>
      </div>
      <section className="panel">
        {ws.activity.length === 0
          ? <EmptyState icon="◌" title="Sem registros" hint="As ações da equipe aparecem aqui." />
          : (
            <div className="activity-feed full-feed">
              {ws.activity.map((a) => {
                const member = ws.members.find((m) => m.id === a.userId);
                return (
                  <div className="activity-row" key={a.id}>
                    <span className="activity-tag">{a.action}</span>
                    <div>
                      <b>{(a.meta?.title as string) ?? ws.client.name}</b>
                      <small>{member?.name ?? "sistema"} · {relTime(a.createdAt)}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </section>
    </div>
  );
}
