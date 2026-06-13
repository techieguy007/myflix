const crypto = require('crypto');
const db = require('../database/init');
const { loadConfig } = require('./config');
const logger = require('./logger');

const appConfig = loadConfig();
const sessionDays = Math.max(1, Number(appConfig.auth?.sessionDays || 180));
const idleMinutes = Math.max(5, Number(appConfig.auth?.idleMinutes || 120));
const cleanupIntervalMinutes = Math.max(1, Number(appConfig.auth?.sessionCleanupIntervalMinutes || 5));
const idleMs = idleMinutes * 60 * 1000;
const sessionMs = sessionDays * 24 * 60 * 60 * 1000;

function isoDate(value = Date.now()) {
  return new Date(value).toISOString();
}

function requestIp(req) {
  return req?.ip || req?.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req?.headers?.['user-agent'] || '').slice(0, 500);
}

function legacySessionId(token) {
  return `legacy:${crypto.createHash('sha256').update(String(token || '')).digest('hex')}`;
}

async function ensureSessionSchema() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT,
      user_agent TEXT,
      ip_address TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      revoke_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
}

async function createSession(user, req, options = {}) {
  await ensureSessionSchema();
  const sessionId = options.sessionId || crypto.randomUUID();
  const now = isoDate();
  const expiresAt = isoDate(Date.now() + sessionMs);
  await db.run(`
    INSERT OR REPLACE INTO user_sessions (
      id, user_id, username, user_agent, ip_address, status, revoke_reason,
      created_at, last_seen_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, NULL)
  `, [
    sessionId,
    user.userId || user.id,
    user.username || '',
    requestUserAgent(req),
    requestIp(req),
    now,
    now,
    expiresAt
  ]);
  logger.info('session.created', {
    sessionId,
    userId: user.userId || user.id,
    username: user.username,
    legacy: Boolean(options.legacy)
  });
  return { sessionId, expiresAt };
}

async function revokeSession(sessionId, reason = 'revoked') {
  if (!sessionId) {
    return { changes: 0 };
  }
  await ensureSessionSchema();
  const result = await db.run(`
    UPDATE user_sessions
    SET status = ?,
        revoke_reason = ?,
        revoked_at = ?,
        last_seen_at = ?
    WHERE id = ?
      AND status = 'active'
  `, [reason === 'logout' ? 'logged_out' : 'revoked', reason, isoDate(), isoDate(), sessionId]);
  logger.info('session.revoked', { sessionId, reason, changes: result.changes || 0 });
  return result;
}

async function cleanupIdleSessions(reason = 'idle-timeout') {
  await ensureSessionSchema();
  const rows = await db.all(`
    SELECT id, last_seen_at, expires_at
    FROM user_sessions
    WHERE status = 'active'
  `);
  const now = Date.now();
  let idle = 0;
  let expired = 0;

  for (const row of rows) {
    const lastSeenMs = Date.parse(row.last_seen_at || 0);
    const expiresMs = Date.parse(row.expires_at || 0);
    const isExpired = Number.isFinite(expiresMs) && expiresMs > 0 && expiresMs <= now;
    const isIdle = Number.isFinite(lastSeenMs) && lastSeenMs > 0 && now - lastSeenMs > idleMs;
    if (!isExpired && !isIdle) {
      continue;
    }

    const status = isExpired ? 'expired' : 'idle';
    const revokeReason = isExpired ? 'session-expired' : reason;
    await db.run(`
      UPDATE user_sessions
      SET status = ?,
          revoke_reason = ?,
          revoked_at = ?,
          last_seen_at = ?
      WHERE id = ?
        AND status = 'active'
    `, [status, revokeReason, isoDate(now), isoDate(now), row.id]);
    if (isExpired) expired += 1;
    else idle += 1;
  }

  if (idle || expired) {
    logger.info('session.cleanup', { idle, expired, idleMinutes, reason });
  }
  return { idle, expired, idleMinutes };
}

async function touchSessionForToken(user, token, req) {
  await ensureSessionSchema();
  await cleanupIdleSessions('request-cleanup');

  let sessionId = user.sessionId || user.sid;
  let legacy = false;
  if (!sessionId) {
    sessionId = legacySessionId(token);
    legacy = true;
  }

  let session = await db.get('SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
  if (!session && legacy) {
    await createSession(user, req, { sessionId, legacy: true });
    session = await db.get('SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
  }

  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 401;
    error.sessionExpired = true;
    throw error;
  }

  if (session.status !== 'active') {
    const error = new Error(`Session ${session.status}`);
    error.statusCode = 401;
    error.sessionExpired = true;
    throw error;
  }

  const now = Date.now();
  const lastSeenMs = Date.parse(session.last_seen_at || 0);
  const expiresMs = Date.parse(session.expires_at || 0);
  if (Number.isFinite(expiresMs) && expiresMs > 0 && expiresMs <= now) {
    await cleanupIdleSessions('request-expired');
    const error = new Error('Session expired');
    error.statusCode = 401;
    error.sessionExpired = true;
    throw error;
  }
  if (Number.isFinite(lastSeenMs) && lastSeenMs > 0 && now - lastSeenMs > idleMs) {
    await cleanupIdleSessions('request-idle');
    const error = new Error('Session expired due to inactivity');
    error.statusCode = 401;
    error.sessionExpired = true;
    throw error;
  }

  await db.run(`
    UPDATE user_sessions
    SET last_seen_at = ?,
        user_agent = ?,
        ip_address = ?
    WHERE id = ?
  `, [isoDate(now), requestUserAgent(req), requestIp(req), sessionId]);

  return {
    sessionId,
    idleMinutes,
    expiresAt: session.expires_at,
    legacy
  };
}

async function getSessionSummary(limit = 100) {
  await ensureSessionSchema();
  await cleanupIdleSessions('summary');
  const rows = await db.all(`
    SELECT id, user_id, username, user_agent, ip_address, status, revoke_reason,
           created_at, last_seen_at, expires_at, revoked_at
    FROM user_sessions
    ORDER BY
      CASE WHEN status = 'active' THEN 0 ELSE 1 END,
      datetime(last_seen_at) DESC
    LIMIT ?
  `, [Math.max(1, Math.min(Number(limit || 100), 500))]);
  const countsRows = await db.all(`
    SELECT status, COUNT(*) AS count
    FROM user_sessions
    GROUP BY status
  `);
  const counts = countsRows.reduce((acc, row) => {
    acc[row.status || 'unknown'] = row.count;
    return acc;
  }, {});
  return {
    idleMinutes,
    sessionDays,
    cleanupIntervalMinutes,
    alive: counts.active || 0,
    counts,
    sessions: rows
  };
}

module.exports = {
  cleanupIdleSessions,
  cleanupIntervalMinutes,
  createSession,
  getSessionSummary,
  idleMinutes,
  revokeSession,
  touchSessionForToken
};
