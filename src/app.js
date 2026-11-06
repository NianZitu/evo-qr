import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { createAuth } from './auth.js';
import { createLink, findLinkByToken, linkStatus, listLinks, markConnected, markOpened, revokeLink } from './db.js';
import { EvolutionError } from './evolution.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const view = (name) => readFileSync(join(root, 'views', name), 'utf8');

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export async function buildApp({ config, pool, evolution, logger = true }) {
  const app = Fastify({ logger, trustProxy: true });
  const auth = createAuth(config.adminPassword);
  const pages = { login: view('login.html'), admin: view('admin.html'), link: view('link.html') };

  await app.register(rateLimit, { global: false });
  await app.register(fastifyStatic, { root: join(root, 'public'), prefix: '/assets/' });

  app.addHook('onSend', async (request, reply) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    if (!request.url.startsWith('/assets/')) reply.header('Cache-Control', 'no-store');
  });

  const requireAdmin = async (request, reply) => {
    if (!auth.isLoggedIn(request)) return reply.code(401).send({ error: 'Faça login novamente.' });
  };

  const serialize = (link) => ({
    id: link.id,
    token: link.token,
    instance: link.instance_name,
    label: link.label,
    status: linkStatus(link),
    createdAt: link.created_at,
    expiresAt: link.expires_at,
    openedAt: link.first_opened_at,
    connectedAt: link.connected_at,
  });

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  // Páginas
  app.get('/', (request, reply) => reply.redirect('/admin'));
  app.get('/login', (request, reply) => reply.type('text/html').send(pages.login));
  app.get('/admin', (request, reply) => {
    if (!auth.isLoggedIn(request)) return reply.redirect('/login');
    return reply.type('text/html').send(pages.admin);
  });
  app.get('/c/:token', (request, reply) => reply.type('text/html').send(pages.link));

  // Sessão do painel
  app.post('/api/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: { password: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (request, reply) => {
    if (!auth.checkPassword(request.body.password)) {
      return reply.code(401).send({ error: 'Senha incorreta.' });
    }
    auth.startSession(request, reply);
    return { ok: true };
  });

  app.post('/api/logout', async (request, reply) => {
    auth.endSession(request, reply);
    return { ok: true };
  });

  // Painel
  app.get('/api/instances', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return { instances: await evolution.listInstances() };
    } catch (error) {
      request.log.error(error);
      return reply.code(502).send({ error: 'Não foi possível consultar a Evolution.' });
    }
  });

  app.get('/api/links', { preHandler: requireAdmin }, async () => ({
    links: (await listLinks(pool)).map(serialize),
  }));

  app.post('/api/links', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['instance', 'hours'],
        properties: {
          instance: { type: 'string', minLength: 1, maxLength: 255 },
          label: { type: 'string', maxLength: 120 },
          hours: { type: 'integer', minimum: 1, maximum: 720 },
        },
      },
    },
  }, async (request, reply) => {
    const instanceName = request.body.instance.trim();
    try {
      await evolution.getState(instanceName);
    } catch (error) {
      request.log.error(error);
      if (error instanceof EvolutionError && error.status === 404) {
        return reply.code(400).send({ error: `A instância "${instanceName}" não existe na Evolution.` });
      }
      return reply.code(502).send({ error: 'Não foi possível consultar a Evolution.' });
    }
    const link = await createLink(pool, {
      instanceName,
      label: request.body.label?.trim(),
      hours: request.body.hours,
    });
    return reply.code(201).send({ link: serialize(link) });
  });

  app.delete('/api/links/:id', {
    preHandler: requireAdmin,
    schema: { params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } } },
  }, async (request, reply) => {
    const revoked = await revokeLink(pool, request.params.id);
    if (!revoked) return reply.code(409).send({ error: 'Este link não pode mais ser cancelado.' });
    return { ok: true };
  });

  // Página do cliente: a página consulta a cada 2s (30/min por visitante).
  app.get('/api/c/:token', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const link = await findLinkByToken(pool, request.params.token);
    if (!link) return reply.code(404).send({ status: 'invalid' });

    // Link encerrado nunca toca na Evolution. Depois de conectado, ele não pode
    // gerar outro QR, senão quem guardou o link poderia parear um aparelho depois.
    const status = linkStatus(link);
    if (status !== 'active') return { status, label: link.label };

    if (!link.first_opened_at) await markOpened(pool, link.id);

    try {
      const { state, qr } = await evolution.getSnapshot(link.instance_name);
      if (state === 'open') {
        await markConnected(pool, link.id);
        return { status: 'connected', label: link.label };
      }
      return { status: qr ? 'qr' : 'waiting', qr, label: link.label, expiresAt: link.expires_at };
    } catch (error) {
      request.log.error(error);
      return { status: 'unavailable', label: link.label };
    }
  });

  return app;
}
