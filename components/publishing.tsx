"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "../lib/client-api";
import { JOB_LABEL, type Asset, type Channel, type Content, type PublishJob, type PublishPackage, type Workspace } from "./types";
import { EmptyState, Spinner, fmtNum, relTime } from "./ui";

type Notify = { ok: (m: string) => void; fail: (m: string) => void };

const dateTimeLocal = (ms: number) => {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

/* ------------------------------------------------- aba do editor: publicar */

export function PublishTab({ content, ws, notify, onPublished }: {
  content: Content;
  ws: Workspace;
  notify: Notify;
  onPublished: () => void;
}) {
  const [state, setState] = useState<{ job: PublishJob | null; package: PublishPackage; preview: string } | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [runAt, setRunAt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ job: PublishJob | null; package: PublishPackage; preview: string }>(`/api/contents/${content.id}/schedule`),
      api.get<{ assets: Asset[] }>(`/api/contents/${content.id}/assets`),
    ])
      .then(([schedule, media]) => {
        if (!alive) return;
        setState(schedule);
        setAssets(media.assets);
        setRunAt(dateTimeLocal(schedule.job?.runAt ?? schedule.package.scheduledFor));
      })
      .catch((e: ApiClientError) => alive && setError(e.message));
    return () => { alive = false; };
  }, [content.id, attempt]);

  const reload = () => { setState(null); setAssets(null); setError(null); setAttempt((n) => n + 1); };

  const schedule = async () => {
    const ms = new Date(runAt).getTime();
    if (!Number.isFinite(ms)) return notify.fail("Informe uma data e hora válidas.");
    setBusy(true);
    try {
      await api.post(`/api/contents/${content.id}/schedule`, { runAt: ms });
      notify.ok("Aviso agendado.");
      reload();
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.del(`/api/contents/${content.id}/schedule`);
      notify.ok("Agendamento cancelado.");
      reload();
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/contents/${content.id}/schedule`, { permalink: content.permalink ?? "" });
      notify.ok("Publicação confirmada.");
      onPublished();
      reload();
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally { setBusy(false); }
  };

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const response = await fetch(`/api/contents/${content.id}/assets`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error((payload as { error?: { message: string } })?.error?.message ?? "Falha no envio.");
      setAssets((list) => [(payload as { data: { asset: Asset } }).data.asset, ...(list ?? [])]);
      notify.ok(`"${file.name}" anexado.`);
      setAttempt((n) => n + 1);
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "Falha no envio.");
    } finally { setBusy(false); }
  };

  const removeAsset = async (asset: Asset) => {
    if (!confirmDialog(`Remover "${asset.name}"?`)) return;
    try {
      await api.del(`/api/contents/${content.id}/assets?id=${asset.id}`);
      setAssets((list) => (list ?? []).filter((a) => a.id !== asset.id));
      setAttempt((n) => n + 1);
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    }
  };

  if (error) return <div className="empty-state error"><b>Não foi possível carregar</b><p>{error}</p><button className="primary" onClick={reload}>Tentar novamente</button></div>;
  if (!state) return <Spinner label="Carregando publicação..." />;

  const job = state.job;
  const live = job && ["pending", "sending", "sent"].includes(job.status);
  const noChannels = ws.members.length >= 0 && /canal de aviso/i.test(job?.lastError ?? "");

  return (
    <div className="publish-tab">
      <div className={`publish-status ${job?.status ?? "none"}`}>
        <div>
          <b>{job ? JOB_LABEL[job.status] : "Sem agendamento"}</b>
          <span>
            {job
              ? job.status === "sent" ? `Aviso enviado ${relTime(job.sentAt ?? job.runAt)} — confirme depois de publicar.`
              : job.status === "failed" ? job.lastError ?? "Falha na entrega."
              : job.status === "done" ? "Publicação confirmada."
              : `Dispara ${relTime(job.runAt)}.`
              : "No horário marcado, o responsável recebe o pacote pronto para postar."}
          </span>
        </div>
        {job?.status === "failed" && job.lastError && <p className="publish-error">{job.lastError}</p>}
      </div>

      {noChannels && (
        <p className="publish-warn">
          Nenhum canal de aviso configurado para este cliente. Vá em Configurações → Avisos de publicação.
        </p>
      )}

      <label className="full">
        Disparar o aviso em
        <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
      </label>
      <div className="approval-actions">
        {live && <button onClick={cancel} disabled={busy}>Cancelar agendamento</button>}
        {job?.status === "sent" && <button className="primary" onClick={confirm} disabled={busy}>Já publiquei</button>}
        <button className={live ? "" : "primary"} onClick={schedule} disabled={busy}>
          {live ? "Reagendar" : "Agendar aviso"}
        </button>
      </div>

      <fieldset>
        <legend>Arquivos da publicação</legend>
        {assets === null ? <Spinner /> : assets.length === 0 ? (
          <p className="muted-line">Nenhum arquivo anexado. Sem mídia, o aviso vai só com a legenda.</p>
        ) : (
          <div className="asset-list">
            {assets.map((a) => (
              <div key={a.id}>
                <span className="asset-kind">{a.kind === "video" ? "▶" : a.kind === "image" ? "▣" : "🔗"}</span>
                <b>{a.name}</b>
                {a.size ? <small>{fmtNum(Math.round(a.size / 1024))} KB</small> : null}
                <button className="delete" onClick={() => removeAsset(a)} aria-label={`Remover ${a.name}`}>×</button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          className="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
        <button onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Enviando..." : "+ Anexar arquivo"}
        </button>
      </fieldset>

      <label className="full">
        Prévia do que será enviado
        <textarea rows={12} readOnly value={state.preview} className="preview-box" />
      </label>
      <div className="approval-actions">
        <button onClick={() => { navigator.clipboard?.writeText(state.package.caption); notify.ok("Legenda copiada."); }}>
          Copiar legenda
        </button>
      </div>
    </div>
  );
}

/** `confirm` global isolado para manter o componente testável. */
function confirmDialog(message: string): boolean {
  return typeof window === "undefined" ? true : window.confirm(message);
}

/* -------------------------------------------- configurações: canais ------ */

export function ChannelsPanel({ ws, notify }: { ws: Workspace; notify: Notify }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [ready, setReady] = useState(true);
  const [kind, setKind] = useState<"telegram" | "webhook">("telegram");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get<{ channels: Channel[]; telegramReady: boolean }>(`/api/clients/${ws.client.id}/channels`)
      .then((d) => { if (alive) { setChannels(d.channels); setReady(d.telegramReady); } })
      .catch((e: ApiClientError) => alive && notify.fail(e.message));
    return () => { alive = false; };
  }, [ws.client.id, notify]);

  const add = async () => {
    if (!target.trim()) return;
    setBusy(true);
    try {
      const { channel } = await api.post<{ channel: Channel }>(`/api/clients/${ws.client.id}/channels`, {
        kind, target: target.trim(), label: label.trim(),
      });
      setChannels((list) => [...(list ?? []), channel]);
      setTarget(""); setLabel("");
      notify.ok("Canal adicionado.");
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    } finally { setBusy(false); }
  };

  const remove = async (channel: Channel) => {
    if (!confirmDialog(`Remover este canal de aviso?`)) return;
    try {
      await api.del(`/api/clients/${ws.client.id}/channels?id=${channel.id}`);
      setChannels((list) => (list ?? []).filter((c) => c.id !== channel.id));
    } catch (e) {
      notify.fail((e as ApiClientError).message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">AVISOS DE PUBLICAÇÃO</p>
      <h3>Para onde vai o aviso no horário</h3>

      {!ready && (
        <p className="publish-warn">
          O bot do Telegram não está configurado neste ambiente. Defina a variável
          <code> TELEGRAM_BOT_TOKEN</code> — sem ela o canal é salvo mas nunca entrega.
        </p>
      )}

      {channels === null ? <Spinner /> : channels.length === 0 ? (
        <EmptyState icon="◷" title="Nenhum canal configurado"
          hint="Sem um canal, os agendamentos ficam presos na fila e nada é avisado." />
      ) : (
        <div className="tax-list">
          {channels.map((c) => (
            <div className="tax-row channel-row" key={c.id}>
              <span className={`status-dot ${c.kind === "telegram" ? "blue" : "slate"}`} />
              <b>{c.label || (c.kind === "telegram" ? "Telegram" : "Webhook")}</b>
              <small>{c.target}</small>
              <button className="delete" onClick={() => remove(c)} aria-label="Remover canal">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="form-grid">
        <label>Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value as "telegram" | "webhook")}>
            <option value="telegram">Telegram</option>
            <option value="webhook">Webhook</option>
          </select>
        </label>
        <label>{kind === "telegram" ? "chat_id" : "URL https"}
          <input value={target} onChange={(e) => setTarget(e.target.value)}
            placeholder={kind === "telegram" ? "Ex.: 123456789" : "https://..."} />
        </label>
        <label>Apelido
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Celular do Rodrigo" />
        </label>
      </div>
      <div className="approval-actions">
        <button className="primary" onClick={add} disabled={busy || !target.trim()}>Adicionar canal</button>
      </div>
      <p className="muted-line">
        Para descobrir o <code>chat_id</code>: mande uma mensagem para o seu bot e abra
        <code> api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>.
      </p>
    </section>
  );
}
