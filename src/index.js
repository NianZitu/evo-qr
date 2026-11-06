import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db.js';
import { createEvolution } from './evolution.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 10_000 });

console.log('Conectando ao Postgres...');
try {
  await migrate(pool);
} catch (error) {
  console.error(`Não foi possível conectar ao Postgres. Confira DATABASE_URL. Erro: ${error.message}`);
  process.exit(1);
}

const evolution = createEvolution({ url: config.evolutionUrl, apiKey: config.evolutionApiKey });
const app = await buildApp({ config, pool, evolution });

async function shutdown() {
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
