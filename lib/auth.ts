import { headers } from "next/headers";
import { eq, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users, memberships, type UserRow } from "../db/schema";
import { newId } from "./ids";
import { forbidden } from "./http";

export type Session = {
  user: UserRow;
  isOwner: boolean;
};

const ACCENTS = ["#e96f34", "#5c75d8", "#2f9e79", "#b0459c", "#c9a227", "#d6455d"];

/**
 * Identidade vinda dos headers do host (Sign in with ChatGPT).
 * Sem headers — desenvolvimento local — cai na conta do dono do estúdio.
 */
async function identity() {
  const h = await headers();
  const externalId = h.get("oai-authenticated-user-id");
  const email = h.get("oai-authenticated-user-email");
  const encodedName = h.get("oai-authenticated-user-full-name");
  const name =
    encodedName && h.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? decodeURIComponent(encodedName)
      : encodedName;

  if (!email && !externalId) {
    return { externalId: "local-owner", email: "estudio@sicheroli.local", name: "Rodrigo Sicheroli" };
  }
  return {
    externalId: externalId ?? `email:${email}`,
    email: email ?? `${externalId}@unknown.local`,
    name: name ?? null,
  };
}

/**
 * Resolve a sessão, criando o usuário no primeiro acesso.
 * O primeiro usuário registrado no banco torna-se `owner` do estúdio.
 */
export async function getSession(): Promise<Session> {
  const db = getDb();
  const who = await identity();

  const found = await db
    .select()
    .from(users)
    .where(or(eq(users.externalId, who.externalId), eq(users.email, who.email)))
    .limit(1);

  if (found.length) {
    const user = found[0];
    // Reconcilia o vínculo externo quando o usuário foi criado por convite/e-mail.
    if (!user.externalId || user.externalId !== who.externalId) {
      await db.update(users).set({ externalId: who.externalId }).where(eq(users.id, user.id));
    }
    return { user, isOwner: user.role === "owner" };
  }

  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(users);
  const role = Number(total) === 0 ? "owner" : "member";
  const user: UserRow = {
    id: newId("usr"),
    externalId: who.externalId,
    email: who.email,
    name: who.name ?? who.email.split("@")[0],
    role,
    accent: ACCENTS[Number(total) % ACCENTS.length],
    createdAt: Date.now(),
  };
  await db.insert(users).values(user);
  return { user, isOwner: role === "owner" };
}

/** Papel efetivo do usuário em um cliente. Owner enxerga todos. */
export async function roleForClient(session: Session, clientId: string): Promise<string | null> {
  if (session.isOwner || session.user.role === "admin") return "owner";
  const db = getDb();
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(sql`${memberships.clientId} = ${clientId} and ${memberships.userId} = ${session.user.id}`)
    .limit(1);
  return rows.length ? rows[0].role : null;
}

const WRITE_ROLES = new Set(["owner", "admin", "member"]);

export async function assertClientAccess(session: Session, clientId: string, write = false) {
  const role = await roleForClient(session, clientId);
  if (!role) throw forbidden();
  if (write && !WRITE_ROLES.has(role)) throw forbidden("Seu papel permite apenas leitura e aprovação.");
  return role;
}
