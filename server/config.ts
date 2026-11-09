export interface ServerConfig {
  port: number;
  host: string;
  jevModel: string;
  jevTimeoutMs: number;
  jevMaxCallsPerDay: number;
  openrouterBaseUrl: string;
  openrouterApiKey: string | undefined;
  engineBudgetMs: number;
  gameTtlMs: number;
  staticDir: string | null;
}

const int = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** The API key is read from the server environment only; it never reaches the client. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    jevModel: env.JEV_MODEL ?? 'typesafe/jev-1.14',
    jevTimeoutMs: int(env.JEV_TIMEOUT_MS, 5000),
    jevMaxCallsPerDay: int(env.JEV_MAX_CALLS_PER_DAY, 2000),
    openrouterBaseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai',
    openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
    engineBudgetMs: int(env.ENGINE_BUDGET_MS, 1500),
    gameTtlMs: int(env.GAME_TTL_MS, 2 * 60 * 60 * 1000),
    staticDir: env.STATIC_DIR ?? (env.NODE_ENV === 'production' ? 'dist' : null),
  };
}
