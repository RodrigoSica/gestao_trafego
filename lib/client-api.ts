"use client";

/** Cliente HTTP tipado — desembrulha o envelope `{ data }` / `{ error }`. */

export type ApiFailure = { code: string; message: string; fields?: Record<string, string> };

export class ApiClientError extends Error {
  constructor(readonly status: number, readonly failure: ApiFailure) {
    super(failure.message);
  }
  get isNotProvisioned() {
    return this.failure.code === "not_provisioned" || this.failure.code === "no_database";
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* resposta sem corpo */
  }

  if (!response.ok) {
    const failure = (payload as { error?: ApiFailure })?.error ?? {
      code: "network",
      message: `Falha na requisição (${response.status}).`,
    };
    throw new ApiClientError(response.status, failure);
  }
  return (payload as { data: T }).data;
}

export const api = {
  get: <T,>(path: string) => send<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => send<T>("POST", path, body ?? {}),
  patch: <T,>(path: string, body: unknown) => send<T>("PATCH", path, body),
  del: <T,>(path: string) => send<T>("DELETE", path),
};
