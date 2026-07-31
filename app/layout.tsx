import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Forja Flow | Sistema de Conteúdo", description: "Painel editorial e de produção da Forja do Sica" };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
