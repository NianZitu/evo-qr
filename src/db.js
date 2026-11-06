import { randomBytes } from 'node:crypto';

export async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id              BIGSERIAL PRIMARY KEY,
      token           TEXT NOT NULL UNIQUE,
      instance_name   TEXT NOT NULL,
      label           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      first_opened_at TIMESTAMPTZ,
      connected_at    TIMESTAMPTZ,
      revoked_at      TIMESTAMPTZ
    )
  `);
}

export async function createLink(pool, { instanceName, label, hours }) {
  const token = randomBytes(18).toString('base64url');
  const { rows } = await pool.query(
    `INSERT INTO links (token, instance_name, label, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))
     RETURNING *`,
    [token, instanceName, label || null, hours],
  );
  return rows[0];
}

export async function listLinks(pool) {
  const { rows } = await pool.query('SELECT * FROM links ORDER BY created_at DESC LIMIT 200');
  return rows;
}

export async function findLinkByToken(pool, token) {
  const { rows } = await pool.query('SELECT * FROM links WHERE token = $1', [token]);
  return rows[0] ?? null;
}

export async function markOpened(pool, id) {
  await pool.query('UPDATE links SET first_opened_at = now() WHERE id = $1 AND first_opened_at IS NULL', [id]);
}

export async function markConnected(pool, id) {
  await pool.query('UPDATE links SET connected_at = now() WHERE id = $1 AND connected_at IS NULL', [id]);
}

export async function revokeLink(pool, id) {
  const { rowCount } = await pool.query(
    'UPDATE links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL AND connected_at IS NULL',
    [id],
  );
  return rowCount > 0;
}

export function linkStatus(link, now = new Date()) {
  if (link.connected_at) return 'connected';
  if (link.revoked_at) return 'revoked';
  if (link.expires_at <= now) return 'expired';
  return 'active';
}
