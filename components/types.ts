export type Approval = "none" | "pending" | "approved" | "changes";

export type SessionUser = {
  id: string; name: string | null; email: string; role: string; accent: string | null;
};

export type Client = {
  id: string; slug: string; name: string; tagline: string | null; initials: string | null;
  brandPrimary: string; brandAccent: string; timezone: string; status: string;
  monthlyGoal: number; notes: string | null; createdAt: number; updatedAt: number;
  stats?: { total: number; pending: number; published: number };
};

export type Stage = { id: string; clientId: string; name: string; color: string; position: number; kind: string; wipLimit: number | null };
export type Pillar = { id: string; clientId: string; name: string; color: string; description: string | null; position: number };
export type Funnel = { id: string; clientId: string; name: string; color: string; position: number };

export type Content = {
  id: string; clientId: string; title: string; format: string;
  publishDate: string; publishTime: string | null;
  stageId: string; pillarId: string | null; funnelId: string | null;
  platforms: string[]; cta: string | null; hook: string | null;
  script: string | null; notes: string | null; assigneeId: string | null;
  priority: number; approval: Approval; publishedAt: number | null;
  permalink: string | null; archived: boolean; position: number;
  createdBy: string | null; createdAt: number; updatedAt: number;
};

export type Comment = {
  id: string; body: string; kind: "comment" | "approval" | "changes"; resolved: boolean;
  createdAt: number; userId: string; userName: string | null; userAccent: string | null;
};

export type Asset = {
  id: string; name: string; kind: string; mime: string | null; size: number | null;
  storageKey: string | null; url: string | null; createdAt: number;
};

export type Metric = {
  id: string; contentId: string; platform: string; capturedAt: number;
  reach: number; impressions: number; likes: number; saves: number; shares: number;
  replies: number; clicks: number; leads: number; revenue: number;
};

export type Member = { id: string; name: string | null; email: string; accent: string | null; role: string };

export type Activity = {
  id: string; clientId: string; contentId: string | null; userId: string | null;
  action: string; meta: Record<string, unknown> | null; createdAt: number;
};

export type JobStatus = "pending" | "sending" | "sent" | "done" | "failed" | "canceled";

export type PublishJob = {
  id?: string; contentId: string; status: JobStatus; runAt: number;
  mode: string; lastError: string | null; attempts: number;
  sentAt?: number | null; doneAt?: number | null;
};

export type Channel = {
  id: string; clientId: string; kind: "telegram" | "webhook";
  target: string; label: string | null; active: boolean; createdAt: number;
};

export type PublishPackage = {
  contentId: string; clientName: string; title: string; format: string;
  platforms: string[]; scheduledFor: number; caption: string;
  media: Array<{ name: string; kind: string; url: string }>; openUrl: string;
};

export type Workspace = {
  client: Client; role: string; stages: Stage[]; pillars: Pillar[]; funnels: Funnel[];
  contents: Content[]; members: Member[]; activity: Activity[]; jobs: PublishJob[];
};

export const JOB_LABEL: Record<JobStatus, string> = {
  pending: "Agendado", sending: "Enviando", sent: "Avisado",
  done: "Publicado", failed: "Falhou", canceled: "Cancelado",
};

export type Insights = {
  byStage: Array<{ id: string; name: string; color: string; total: number }>;
  byPillar: Array<{ id: string; name: string; color: string; total: number }>;
  byFunnel: Array<{ id: string; name: string; color: string; total: number }>;
  byMonth: Array<{ month: string; total: number; published: number }>;
  performance: {
    reach: number; impressions: number; saves: number; clicks: number;
    leads: number; revenue: number; samples: number; ctr: number;
  };
  topContents: Array<{ id: string; title: string; format: string; reach: number; leads: number; revenue: number }>;
  windowDays: number;
};

export const FORMATS = ["Vídeo", "Estático", "Carrossel", "Story", "Live", "Artigo"];
export const PLATFORMS = ["Instagram", "TikTok", "YouTube", "Facebook", "LinkedIn", "Pinterest"];
export const PLATFORM_GLYPH: Record<string, string> = {
  Instagram: "◎", TikTok: "♪", YouTube: "▶", Facebook: "f", LinkedIn: "in", Pinterest: "p",
};
export const PRIORITY_LABEL = ["Normal", "Alta", "Urgente"];
export const APPROVAL_LABEL: Record<Approval, string> = {
  none: "Sem revisão", pending: "Aguardando", approved: "Aprovado", changes: "Ajustes",
};
