import type { Metadata } from "next";
import "./globals.css";
// Carregado depois para vencer no cascade as regras do layout original.
import "./studio.css";

export const metadata: Metadata = {
  title: "Studio OS | Rodrigo Sicheroli",
  description: "Sistema proprietário de gestão editorial e produção de conteúdo multi-cliente",
};

/**
 * Aplica tema e conforto de leitura antes da primeira pintura.
 * Sem isso o usuário veria um flash claro antes do tema escuro assumir.
 */
const PREFS_SCRIPT = `(()=>{try{var r=document.documentElement,t=localStorage.getItem("studio-theme");
r.dataset.theme=t==="dark"||t==="light"?t:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
r.dataset.reading=localStorage.getItem("studio-reading")==="large"?"large":"normal";}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light" data-reading="normal" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
