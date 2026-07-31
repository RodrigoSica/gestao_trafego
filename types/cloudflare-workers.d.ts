/**
 * Declaração mínima do módulo virtual do runtime Workers.
 * Evita depender de `@cloudflare/workers-types` só para tipar `env`.
 */
declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const env: Record<string, any>;
}
