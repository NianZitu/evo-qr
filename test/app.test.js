// Precisa de um Postgres de teste: TEST_DATABASE_URL=postgres://... npm test
// A tabela "links" desse banco é apagada a cada execução.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db.js';
import { createEvolution } from '../src/evolution.js';

const API_KEY = 'chave-teste';
const PASSWORD = 'senha-teste';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Evolution falsa, com as mesmas respostas lidas no código-fonte da API.
const evo = { state: 'close', code: 'qr-1', calls: [], authFailures: 0, down: false };
const fakeEvolution = createServer((request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (evo.down) return send(500, { message: 'erro' });
  if (request.headers.apikey !== API_KEY) {
    evo.authFailures += 1;
    return send(401, { message: 'Unauthorized' });
  }
  evo.calls.push(request.url);
  const [, , action, name] = request.url.split('/');
  if (action === 'fetchInstances') {
    return send(200, [{ name: 'cliente-a', connectionStatus: 'close' }, { name: 'cliente b', connectionStatus: 'open' }]);
  }
  if (!['cliente-a', 'cliente%20b'].includes(name)) return send(404, { message: 'not found' });
  if (action === 'connectionState') return send(200, { instance: { instanceName: name, state: evo.state } });
  if (action === 'connect') {
    if (evo.state === 'open') return send(200, { instance: { instanceName: name, state: 'open' } });
    if (evo.state === 'close') evo.state = 'connecting';
    return send(200, evo.code ? { code: evo.code, base64: `data:image/png;base64,${evo.code}`, count: 1 } : { count: 0 });
  }
  return send(404, {});
});

let app;
let pool;
let cookie;

const adminHeaders = () => ({ cookie });
const poll = async (token) => {
  await wait(1100); // ultrapassa o cache de 1s
  return app.inject({ url: `/api/c/${token}` });
};
const newLink = async (body = {}) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/links',
    headers: adminHeaders(),
    payload: { instance: 'cliente-a', hours: 24, ...body },
  });
  assert.equal(response.statusCode, 201);
  return response.json().link;
};

before(async () => {
  await new Promise((resolve) => fakeEvolution.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${fakeEvolution.address().port}`;

  pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await pool.query('DROP TABLE IF EXISTS links');
  await migrate(pool);

  app = await buildApp({
    config: { adminPassword: PASSWORD },
    pool,
    evolution: createEvolution({ url, apiKey: API_KEY }),
    logger: false,
  });

  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: PASSWORD } });
  cookie = login.headers['set-cookie'].split(';')[0];
});

after(async () => {
  await app.close();
  await pool.end();
  fakeEvolution.close();
});

beforeEach(() => {
  Object.assign(evo, { state: 'close', code: 'qr-1', calls: [], down: false });
});

test('painel e API exigem login', async () => {
  assert.equal((await app.inject({ url: '/api/links' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/instances' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/links', payload: { instance: 'x', hours: 1 } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/links/1' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/admin' })).headers.location, '/login');
  const forged = { cookie: 'evoqr_session=9999999999.assinatura-falsa' };
  assert.equal((await app.inject({ url: '/api/links', headers: forged })).statusCode, 401);
});

test('senha errada não entra', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'errada' } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('lista as instâncias da Evolution', async () => {
  const { instances } = (await app.inject({ url: '/api/instances', headers: adminHeaders() })).json();
  assert.deepEqual(instances.map((item) => item.name), ['cliente b', 'cliente-a']);
});

test('recusa instância que não existe', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/links',
    headers: adminHeaders(),
    payload: { instance: 'nao-existe', hours: 24 },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /não existe/);
});

test('token desconhecido é inválido e não chama a Evolution', async () => {
  const response = await app.inject({ url: '/api/c/token-qualquer' });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { status: 'invalid' });
  assert.equal(evo.calls.length, 0);
});

test('QR acompanha a renovação da Evolution até conectar', async () => {
  const { token } = await newLink({ label: 'Maria' });

  const first = (await poll(token)).json();
  assert.equal(first.status, 'qr');
  assert.equal(first.qr, 'data:image/png;base64,qr-1');
  assert.equal(first.label, 'Maria');

  evo.code = 'qr-2';
  assert.equal((await poll(token)).json().qr, 'data:image/png;base64,qr-2');

  evo.state = 'open';
  assert.equal((await poll(token)).json().status, 'connected');
});

test('resposta pública não expõe a instância nem a chave', async () => {
  const { token } = await newLink();
  const raw = (await poll(token)).body;
  assert.ok(!raw.includes('cliente-a'));
  assert.ok(!raw.includes(API_KEY));
});

test('link conectado não gera QR de novo mesmo se a instância cair', async () => {
  const { token } = await newLink();
  evo.state = 'open';
  assert.equal((await poll(token)).json().status, 'connected');

  evo.state = 'close';
  evo.calls = [];
  assert.equal((await poll(token)).json().status, 'connected');
  assert.equal(evo.calls.length, 0);
});

test('link expirado não chama a Evolution', async () => {
  const { id, token } = await newLink();
  await pool.query("UPDATE links SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
  evo.calls = [];
  assert.equal((await poll(token)).json().status, 'expired');
  assert.equal(evo.calls.length, 0);
});

test('link cancelado para de funcionar', async () => {
  const { id, token } = await newLink();
  const response = await app.inject({ method: 'DELETE', url: `/api/links/${id}`, headers: adminHeaders() });
  assert.equal(response.statusCode, 200);
  evo.calls = [];
  assert.equal((await poll(token)).json().status, 'revoked');
  assert.equal(evo.calls.length, 0);
});

test('link conectado não pode ser cancelado', async () => {
  const { id, token } = await newLink();
  evo.state = 'open';
  await poll(token);
  const response = await app.inject({ method: 'DELETE', url: `/api/links/${id}`, headers: adminHeaders() });
  assert.equal(response.statusCode, 409);
});

test('Evolution sem QR ainda fica em espera', async () => {
  const { token } = await newLink();
  evo.code = null;
  assert.equal((await poll(token)).json().status, 'waiting');
});

test('Evolution fora do ar não quebra a página e ela se recupera', async () => {
  const { token } = await newLink();
  evo.down = true;
  assert.equal((await poll(token)).json().status, 'unavailable');
  evo.down = false;
  assert.equal((await poll(token)).json().status, 'qr');
});

test('vários visitantes simultâneos geram uma só consulta', async () => {
  const { token } = await newLink();
  await wait(1100);
  evo.calls = [];
  await Promise.all(Array.from({ length: 10 }, () => app.inject({ url: `/api/c/${token}` })));
  assert.equal(evo.calls.filter((url) => url.startsWith('/instance/connect/')).length, 1);
});

test('nome de instância com espaço funciona', async () => {
  const { token } = await newLink({ instance: 'cliente b' });
  assert.equal((await poll(token)).json().status, 'qr');
});

test('registra a primeira abertura do link', async () => {
  const { id, token } = await newLink();
  await poll(token);
  const { links } = (await app.inject({ url: '/api/links', headers: adminHeaders() })).json();
  assert.ok(links.find((link) => link.id === id).openedAt);
});
