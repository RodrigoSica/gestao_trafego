"use client";

import { useCallback, useRef, useState } from "react";

/* ------------------------------------------------------------- formatação */

export const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${iso}T12:00:00`));

export const fmtFull = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00`));

export const fmtMonth = (ym: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(`${ym}-01T12:00:00`));

export const fmtNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(".0", "")}k`
  : String(n);

export const fmtMoney = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);

export function relTime(ms: number): string {
  const diff = Math.round((ms - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["second", 60], ["minute", 60], ["hour", 24], ["day", 7], ["week", 4.35], ["month", 12], ["year", Infinity],
  ];
  let value = diff;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) return new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }).format(Math.round(value), unit);
    value /= size;
  }
  return "";
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const monthIso = (iso: string) => iso.slice(0, 7);

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ toasts */

export type Toast = { id: number; tone: "ok" | "error" | "info"; message: string };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = ++seq.current;
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4200);
  }, []);

  return {
    toasts,
    ok: useCallback((m: string) => push("ok", m), [push]),
    fail: useCallback((m: string) => push("error", m), [push]),
    info: useCallback((m: string) => push("info", m), [push]),
    dismiss: useCallback((id: number) => setToasts((c) => c.filter((t) => t.id !== id)), []),
  };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button className={`toast ${t.tone}`} key={t.id} onClick={() => onDismiss(t.id)}>
          <span>{t.tone === "ok" ? "✓" : t.tone === "error" ? "!" : "i"}</span>
          {t.message}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- blocos */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="loading-state">
      <i className="spinner" />
      <span>{label ?? "Carregando..."}</span>
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: {
  icon: string; title: string; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <b>{title}</b>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state error">
      <div className="empty-icon">!</div>
      <b>Não foi possível carregar</b>
      <p>{message}</p>
      {onRetry && <button className="primary" onClick={onRetry}>Tentar novamente</button>}
    </div>
  );
}

export function Avatar({ name, accent, size = 28 }: { name: string | null; accent?: string | null; size?: number }) {
  const label = (name ?? "?").trim().slice(0, 2).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, background: accent ?? "#5c75d8", fontSize: size * 0.4 }}>
      {label}
    </span>
  );
}

export function Modal({ title, eyebrow, onClose, children, footer, wide }: {
  title: string; eyebrow?: string; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className={`editor ${wide ? "wide" : ""}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header>
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button className="close" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="editor-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}
