/**
 * Envelope de resposta e validação sem dependências externas.
 * Toda rota devolve `{ data }` ou `{ error: { code, message, fields? } }`.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new ApiError(400, "bad_request", message, fields);
export const unauthorized = (message = "Sessão não identificada.") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "Sem acesso a este cliente.") =>
  new ApiError(403, "forbidden", message);
export const notFound = (message = "Registro não encontrado.") =>
  new ApiError(404, "not_found", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

export function ok<T>(data: T, status = 200) {
  return Response.json({ data }, { status });
}

/** Concatena a cadeia de `cause` — sem isso a causa raiz do D1 se perde. */
function describeError(error: unknown, depth = 0): string {
  if (!(error instanceof Error) || depth > 4) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  return cause ? `${error.message} | ${describeError(cause, depth + 1)}` : error.message;
}

/** Executa o handler traduzindo qualquer falha para o envelope padrão. */
export async function route(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json(
        { error: { code: error.code, message: error.message, fields: error.fields } },
        { status: error.status }
      );
    }
    // O Drizzle embrulha a falha do D1: a mensagem real do SQLite fica em `cause`.
    const raw = describeError(error);
    const missingTable = /no such (table|column)/i.test(raw);
    console.error("[api]", raw);
    return Response.json(
      {
        error: {
          code: missingTable ? "not_provisioned" : "internal",
          message: missingTable
            ? "Banco ainda não provisionado. Chame POST /api/bootstrap para criar as tabelas."
            : "Erro inesperado ao processar a requisição.",
        },
      },
      { status: missingTable ? 503 : 500 }
    );
  }
}

/* --------------------------------------------------------------- validação */

type Rule<T> = (value: unknown, field: string) => T;

const fail = (field: string, message: string) => {
  throw badRequest("Dados inválidos.", { [field]: message });
};

export const v = {
  string(opts: { min?: number; max?: number; pattern?: RegExp; label?: string } = {}): Rule<string> {
    return (value, field) => {
      if (typeof value !== "string") fail(field, "Texto obrigatório.");
      const text = (value as string).trim();
      if (opts.min !== undefined && text.length < opts.min)
        fail(field, `Mínimo de ${opts.min} caractere(s).`);
      if (opts.max !== undefined && text.length > opts.max)
        fail(field, `Máximo de ${opts.max} caracteres.`);
      if (opts.pattern && !opts.pattern.test(text)) fail(field, opts.label ?? "Formato inválido.");
      return text;
    };
  },
  int(opts: { min?: number; max?: number } = {}): Rule<number> {
    return (value, field) => {
      const num = typeof value === "string" ? Number(value) : value;
      if (typeof num !== "number" || !Number.isFinite(num)) fail(field, "Número obrigatório.");
      const n = Math.trunc(num as number);
      if (opts.min !== undefined && n < opts.min) fail(field, `Mínimo ${opts.min}.`);
      if (opts.max !== undefined && n > opts.max) fail(field, `Máximo ${opts.max}.`);
      return n;
    };
  },
  number(opts: { min?: number } = {}): Rule<number> {
    return (value, field) => {
      const num = typeof value === "string" ? Number(value) : value;
      if (typeof num !== "number" || !Number.isFinite(num)) fail(field, "Número obrigatório.");
      if (opts.min !== undefined && (num as number) < opts.min) fail(field, `Mínimo ${opts.min}.`);
      return num as number;
    };
  },
  bool(): Rule<boolean> {
    return (value) => value === true || value === "true" || value === 1;
  },
  enum<T extends string>(values: readonly T[]): Rule<T> {
    return (value, field) => {
      if (!values.includes(value as T)) fail(field, `Use um de: ${values.join(", ")}.`);
      return value as T;
    };
  },
  date(): Rule<string> {
    return (value, field) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        fail(field, "Use o formato AAAA-MM-DD.");
      return value as string;
    };
  },
  stringArray(opts: { max?: number } = {}): Rule<string[]> {
    return (value, field) => {
      if (!Array.isArray(value)) fail(field, "Lista obrigatória.");
      const list = (value as unknown[]).filter((x): x is string => typeof x === "string");
      if (opts.max !== undefined && list.length > opts.max) fail(field, `Máximo ${opts.max} itens.`);
      return list;
    };
  },
};

type Shape = Record<string, Rule<unknown>>;
type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Rule<infer T> ? T : never };

/** Valida um objeto completo (campos ausentes são erro). */
export function parse<S extends Shape>(shape: S, input: unknown): Infer<S> {
  if (typeof input !== "object" || input === null) throw badRequest("Corpo JSON obrigatório.");
  const source = input as Record<string, unknown>;
  const out = {} as Record<string, unknown>;
  for (const [field, rule] of Object.entries(shape)) out[field] = rule(source[field], field);
  return out as Infer<S>;
}

/** Valida apenas as chaves presentes — usado em PATCH. */
export function parsePartial<S extends Shape>(shape: S, input: unknown): Partial<Infer<S>> {
  if (typeof input !== "object" || input === null) throw badRequest("Corpo JSON obrigatório.");
  const source = input as Record<string, unknown>;
  const out = {} as Record<string, unknown>;
  for (const [field, rule] of Object.entries(shape)) {
    if (!(field in source) || source[field] === undefined) continue;
    out[field] = source[field] === null ? null : rule(source[field], field);
  }
  return out as Partial<Infer<S>>;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("JSON malformado.");
  }
}
