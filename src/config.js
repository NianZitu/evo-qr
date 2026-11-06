const REQUIRED = ['DATABASE_URL', 'EVOLUTION_URL', 'EVOLUTION_API_KEY', 'ADMIN_PASSWORD'];

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(', ')}`);
  }

  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL,
    evolutionUrl: env.EVOLUTION_URL.replace(/\/+$/, ''),
    evolutionApiKey: env.EVOLUTION_API_KEY,
    adminPassword: env.ADMIN_PASSWORD,
  };
}
