import * as schema from "./schema";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleLibSql } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

let dbInstance: ReturnType<typeof drizzleD1> | ReturnType<typeof drizzleLibSql> | null = null;

export function getDb() {
  if (dbInstance) return dbInstance;

  // Cloudflare Workers environment
  if (typeof globalThis !== "undefined" && "env" in globalThis) {
    try {
      const { env } = globalThis as any;
      if (env?.DB) {
        dbInstance = drizzleD1(env.DB, { schema });
        return dbInstance;
      }
    } catch (e) {
      // Fall through to libsql
    }
  }

  // Vercel/local environment - use libsql with file-based SQLite
  const dbUrl = process.env.TURSO_DATABASE_URL || "file:./.data/studio.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  const client = createClient({
    url: dbUrl,
    ...(authToken && { authToken }),
  });

  dbInstance = drizzleLibSql(client, { schema });

  return dbInstance;
}
