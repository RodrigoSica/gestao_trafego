"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError } from "../lib/client-api";
import { ActivityView, ClientsView, SettingsView } from "./admin";
import { Editor } from "./editor";
import type { Client, Content, SessionUser, Workspace } from "./types";
import { Board, Calendar, Library, Overview, Results, type ViewProps } from "./views";
import { Avatar, ErrorState, Spinner, Toasts, useToasts, fmtDay } from "./ui";

const VIEWS = [
  ["Visão geral", "◈"], ["Calendário", "▦"], ["Fluxo de produção", "↳"],
  ["Biblioteca", "⌘"], ["Resultados", "◌"], ["Histórico", "≡"], ["Configurações", "⚙"],
] as const;

type ViewName = (typeof VIEWS)[number][0] | "Clientes";
type Boot = "loading" | "ready" | "error";

export function Studio() {
  const notify = useToasts();
  const [boot, setBoot] = useState<Boot>("loading");
  const [bootError, setBootError] = useState("");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [wsError, setWsError] = useState<{ clientId: string; message: string } | null>(null);
  const [view, setView] = useState<ViewName>("Visão geral");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ content: Content | null; seed?: Partial<Content> } | null>(null);
  const [palette, setPalette] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  /**
   * O tema vive num atributo de `<html>`, aplicado pelo script inline do
   * layout antes da hidratação. Sem estado React aqui: evita divergência de
   * hidratação e o flash de tema na primeira pintura.
   */
  const toggleTheme = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("studio-theme", next);
  };

  /* ------------------------------------------------------------------- boot */

  const loadClients = useCallback(async (): Promise<Client[]> => {
    // Duas tentativas: a segunda só acontece após provisionar o banco.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await api.get<{ session: SessionUser; clients: Client[] }>("/api/clients");
        setSession(data.session);
        setClients(data.clients);
        return data.clients;
      } catch (error) {
        const err = error as ApiClientError;
        if (attempt === 0 && err.isNotProvisioned) {
          // Primeiro acesso: cria o esquema e a conta inicial, depois recarrega.
          await api.post("/api/bootstrap");
          continue;
        }
        throw err;
      }
    }
    throw new ApiClientError(500, { code: "internal", message: "Não foi possível carregar os clientes." });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await loadClients();
        if (!alive) return;
        const params = new URLSearchParams(window.location.search);
        const stored = localStorage.getItem("studio-client");
        const pick = list.find((c) => c.slug === params.get("c"))?.id
          ?? list.find((c) => c.id === stored)?.id
          ?? list[0]?.id
          ?? null;
        const wanted = params.get("v");
        const validView = VIEWS.some(([v]) => v === wanted) || wanted === "Clientes";
        setActiveId(pick);
        setView(!pick ? "Clientes" : validView ? (wanted as ViewName) : "Visão geral");
        setBoot("ready");
      } catch (error) {
        if (!alive) return;
        setBootError((error as ApiClientError).message);
        setBoot("error");
      }
    })();
    return () => { alive = false; };
  }, [loadClients]);

  /* -------------------------------------------------------------- workspace */

  /**
   * Só escreve estado depois da resposta. O "carregando" é derivado no render
   * comparando o workspace em memória com o cliente ativo — nada de reset
   * síncrono dentro do effect.
   */
  const loadWorkspace = useCallback(async (clientId: string) => {
    try {
      const data = await api.get<Workspace>(`/api/clients/${clientId}`);
      setWs(data);
      setWsError(null);
    } catch (error) {
      setWs(null);
      setWsError({ clientId, message: (error as ApiClientError).message });
    }
  }, []);

  // Carrega ao trocar de cliente. O guarda `alive` descarta respostas de uma
  // conta que o usuário já abandonou (troca rápida = resposta fora de ordem).
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    localStorage.setItem("studio-client", activeId);
    (async () => {
      try {
        const data = await api.get<Workspace>(`/api/clients/${activeId}`);
        if (!alive) return;
        setWs(data);
        setWsError(null);
      } catch (error) {
        if (!alive) return;
        setWs(null);
        setWsError({ clientId: activeId, message: (error as ApiClientError).message });
      }
    })();
    return () => { alive = false; };
  }, [activeId]);

  /** Troca de cliente: a seleção em lote nunca atravessa contas. */
  const changeClient = useCallback((id: string) => {
    setSelection(new Set());
    setActiveId(id);
    setView("Visão geral");
  }, []);

  // Deep link: ?c=<slug>&v=<view>
  useEffect(() => {
    if (!ws) return;
    const params = new URLSearchParams({ c: ws.client.slug, v: view });
    window.history.replaceState(null, "", `?${params}`);
  }, [ws, view]);

  /* -------------------------------------------------------------- mutações */

  const patchContent = useCallback(async (id: string, patch: Partial<Content>) => {
    if (!ws) return;
    const previous = ws.contents;
    setWs((w) => (w ? { ...w, contents: w.contents.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : w));
    try {
      const { content } = await api.patch<{ content: Content }>(`/api/contents/${id}`, patch);
      setWs((w) => (w ? { ...w, contents: w.contents.map((c) => (c.id === id ? content : c)) } : w));
    } catch (error) {
      setWs((w) => (w ? { ...w, contents: previous } : w));
      notify.fail((error as ApiClientError).message);
    }
  }, [ws, notify]);

  const bulkPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!ws || selection.size === 0) return;
    const ids = [...selection];
    try {
      await api.patch(`/api/clients/${ws.client.id}/contents`, { ids, ...patch });
      notify.ok(`${ids.length} conteúdo(s) atualizados.`);
      setSelection(new Set());
      await loadWorkspace(ws.client.id);
    } catch (error) {
      notify.fail((error as ApiClientError).message);
    }
  }, [ws, selection, notify, loadWorkspace]);

  const toggleSelect = useCallback((id: string) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onSaved = useCallback((content: Content, isNew: boolean) => {
    setWs((w) => {
      if (!w) return w;
      const contents = isNew ? [...w.contents, content] : w.contents.map((c) => (c.id === content.id ? content : c));
      return { ...w, contents };
    });
    if (isNew) setClients((list) => list.map((c) => (c.id === content.clientId
      ? { ...c, stats: { ...(c.stats ?? { total: 0, pending: 0, published: 0 }), total: (c.stats?.total ?? 0) + 1 } }
      : c)));
  }, []);

  const onDeleted = useCallback((id: string) => {
    setWs((w) => (w ? { ...w, contents: w.contents.filter((c) => c.id !== id) } : w));
  }, []);

  /* -------------------------------------------------------------- atalhos */

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key.toLowerCase() === "n" && ws) { e.preventDefault(); setEditing({ content: null }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  /* ----------------------------------------------------------------- render */

  // Workspace válido apenas quando corresponde ao cliente selecionado.
  const activeWs = ws && ws.client.id === activeId ? ws : null;
  const activeError = wsError && wsError.clientId === activeId ? wsError.message : null;

  const viewProps: ViewProps | null = useMemo(() => (ws ? {
    ws,
    onOpen: (content: Content) => setEditing({ content }),
    onPatch: patchContent,
    onCreate: (seed?: Partial<Content>) => setEditing({ content: null, seed }),
    onGo: (v: string) => setView(v as ViewName),
    selection,
    toggleSelect,
    clearSelection: () => setSelection(new Set()),
    onBulk: bulkPatch,
    search,
  } : null), [ws, patchContent, selection, toggleSelect, bulkPatch, search]);

  const active = clients.find((c) => c.id === activeId) ?? null;
  const canManage = session?.role === "owner" || session?.role === "admin";

  if (boot === "loading") return <main className="shell boot"><Spinner label="Preparando o estúdio..." /></main>;
  if (boot === "error") {
    return (
      <main className="shell boot">
        <ErrorState message={bootError} onRetry={() => { setBoot("loading"); loadClients().then(() => setBoot("ready")).catch((e) => { setBootError(e.message); setBoot("error"); }); }} />
      </main>
    );
  }

  return (
    <main
      className={`shell ${navOpen ? "nav-open" : ""}`}
      style={active ? ({ "--brand": active.brandPrimary, "--brand-accent": active.brandAccent } as React.CSSProperties) : undefined}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div><b>STUDIO OS</b><span>rodrigo sicheroli</span></div>
        </div>

        <button className="client-switch" onClick={() => setView("Clientes")}>
          {active ? (
            <>
              <span className="client-mark small" style={{ background: active.brandPrimary }}>{active.initials ?? "??"}</span>
              <div><b>{active.name}</b><small>{clients.length} cliente(s)</small></div>
            </>
          ) : <div><b>Selecionar cliente</b><small>{clients.length} disponível(is)</small></div>}
          <i>⇅</i>
        </button>

        <nav>
          <button className={view === "Clientes" ? "nav active" : "nav"} onClick={() => { setView("Clientes"); setNavOpen(false); }}>
            <span>◇</span>Clientes
          </button>
          {VIEWS.map(([item, icon]) => (
            <button
              key={item}
              className={view === item ? "nav active" : "nav"}
              onClick={() => { setView(item); setNavOpen(false); }}
              disabled={!activeId}
            >
              <span>{icon}</span>{item}
            </button>
          ))}
        </nav>

        <div className="side-note">
          <span>ATALHOS</span>
          <b>Ctrl+K busca tudo</b>
          <p>“/” foca a busca · “N” cria conteúdo</p>
        </div>

        <div className="profile">
          <Avatar name={session?.name ?? session?.email ?? "?"} accent={session?.accent} size={34} />
          <span>{session?.name ?? "—"}<br /><small>{session?.role}</small></span>
        </div>
      </aside>

      <section className="workspace">
        <header>
          <div className="header-left">
            <button className="nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">☰</button>
            <div>
              <p className="eyebrow">{active ? active.name.toUpperCase() : "ESTÚDIO"}</p>
              <h1>{view}</h1>
            </div>
          </div>
          <div className="header-actions">
            <label className="search">⌕
              <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar conteúdo  (/)" />
            </label>
            <button className="icon-button theme-toggle" aria-label="Alternar tema" title="Alternar tema"
              onClick={toggleTheme}>
              <span className="on-dark">☀</span><span className="on-light">☾</span>
            </button>
            {activeId && <button className="primary" onClick={() => setEditing({ content: null })}>+ Novo conteúdo</button>}
          </div>
        </header>

        {view === "Clientes" && (
          <ClientsView
            clients={clients}
            activeId={activeId}
            canManage={!!canManage}
            notify={notify}
            onSelect={changeClient}
            onCreated={(client) => { setClients((l) => [...l, client]); changeClient(client.id); }}
            onArchived={(id) => setClients((l) => l.map((c) => (c.id === id ? { ...c, status: "archived" } : c)))}
            onRemoved={(id) => {
              // Some da lista; se era o cliente aberto, cai no próximo disponível.
              setClients((list) => {
                const rest = list.filter((c) => c.id !== id);
                if (activeId === id) {
                  setSelection(new Set());
                  setWs(null);
                  setActiveId(rest[0]?.id ?? null);
                }
                return rest;
              });
            }}
          />
        )}

        {view !== "Clientes" && !activeId && (
          <div className="page"><ErrorState message="Nenhum cliente selecionado." onRetry={() => setView("Clientes")} /></div>
        )}

        {view !== "Clientes" && activeId && activeError && (
          <div className="page"><ErrorState message={activeError} onRetry={() => loadWorkspace(activeId)} /></div>
        )}

        {view !== "Clientes" && activeId && !activeError && !activeWs && (
          <div className="page"><Spinner label="Carregando workspace..." /></div>
        )}

        {view !== "Clientes" && activeWs && viewProps && (
          <>
            {view === "Visão geral" && <Overview {...viewProps} />}
            {view === "Fluxo de produção" && <Board {...viewProps} />}
            {view === "Calendário" && <Calendar {...viewProps} />}
            {view === "Biblioteca" && <Library {...viewProps} />}
            {view === "Resultados" && <Results {...viewProps} />}
            {view === "Histórico" && <ActivityView ws={activeWs} />}
            {view === "Configurações" && (
              <SettingsView
                ws={activeWs}
                notify={notify}
                onWorkspaceChange={(patch) => setWs((w) => (w ? { ...w, ...patch } : w))}
                onClientChange={(client) => {
                  setWs((w) => (w ? { ...w, client } : w));
                  setClients((l) => l.map((c) => (c.id === client.id ? { ...c, ...client } : c)));
                }}
              />
            )}
          </>
        )}
      </section>

      {editing && activeWs && (
        <Editor
          ws={activeWs}
          content={editing.content}
          seed={editing.seed}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onDeleted={onDeleted}
          notify={notify}
        />
      )}

      {palette && (
        <CommandPalette
          ws={activeWs}
          clients={clients}
          onClose={() => setPalette(false)}
          onPickContent={(c) => { setEditing({ content: c }); setPalette(false); }}
          onPickClient={(id) => { changeClient(id); setPalette(false); }}
          onPickView={(v) => { setView(v as ViewName); setPalette(false); }}
        />
      )}

      <Toasts toasts={notify.toasts} onDismiss={notify.dismiss} />
    </main>
  );
}

/* ------------------------------------------------------------- paleta Ctrl+K */

function CommandPalette({ ws, clients, onClose, onPickContent, onPickClient, onPickView }: {
  ws: Workspace | null;
  clients: Client[];
  onClose: () => void;
  onPickContent: (c: Content) => void;
  onPickClient: (id: string) => void;
  onPickView: (v: string) => void;
}) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();

  const contentHits = (ws?.contents ?? [])
    .filter((c) => !term || c.title.toLowerCase().includes(term))
    .slice(0, 6);
  const clientHits = clients.filter((c) => !term || c.name.toLowerCase().includes(term)).slice(0, 4);
  const viewHits = VIEWS.map(([v]) => v).filter((v) => !term || v.toLowerCase().includes(term)).slice(0, 4);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conteúdo, cliente ou seção..." />
        <div className="palette-results">
          {contentHits.length > 0 && <p className="palette-group">Conteúdos</p>}
          {contentHits.map((c) => (
            <button key={c.id} onClick={() => onPickContent(c)}>
              <span>▣</span><b>{c.title}</b><small>{fmtDay(c.publishDate)}</small>
            </button>
          ))}
          {clientHits.length > 0 && <p className="palette-group">Clientes</p>}
          {clientHits.map((c) => (
            <button key={c.id} onClick={() => onPickClient(c.id)}>
              <span>◇</span><b>{c.name}</b><small>{c.stats?.total ?? 0} conteúdos</small>
            </button>
          ))}
          {viewHits.length > 0 && <p className="palette-group">Ir para</p>}
          {viewHits.map((v) => (
            <button key={v} onClick={() => onPickView(v)}><span>→</span><b>{v}</b></button>
          ))}
          {!contentHits.length && !clientHits.length && !viewHits.length && (
            <p className="palette-group">Nada encontrado para “{q}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}
