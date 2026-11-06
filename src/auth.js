import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'evoqr_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

const sha256 = (value) => createHash('sha256').update(value).digest();

function safeEqual(a, b) {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function createAuth(adminPassword) {
  // A chave vem da senha: trocar ADMIN_PASSWORD derruba todas as sessões.
  const key = sha256(`session:${adminPassword}`);
  const sign = (expires) => createHmac('sha256', key).update(String(expires)).digest('base64url');

  function readSession(request) {
    const header = request.headers.cookie ?? '';
    const pair = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    return pair?.slice(COOKIE.length + 1) ?? null;
  }

  function isLoggedIn(request) {
    const [expires, signature] = (readSession(request) ?? '').split('.');
    if (!expires || !signature) return false;
    return Number(expires) > Date.now() / 1000 && safeEqual(signature, sign(expires));
  }

  function cookieAttributes(request, maxAge) {
    const secure = request.protocol === 'https' ? '; Secure' : '';
    return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }

  function startSession(request, reply) {
    const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    reply.header('Set-Cookie', `${COOKIE}=${expires}.${sign(expires)}; ${cookieAttributes(request, SESSION_SECONDS)}`);
  }

  function endSession(request, reply) {
    reply.header('Set-Cookie', `${COOKIE}=; ${cookieAttributes(request, 0)}`);
  }

  return {
    isLoggedIn,
    startSession,
    endSession,
    checkPassword: (password) => safeEqual(password, adminPassword),
  };
}
