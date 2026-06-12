const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const LOG_DIR = process.env.MYFLIX_LOG_DIR
  ? path.resolve(process.env.MYFLIX_LOG_DIR)
  : path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'myflix-app.jsonl');
const LOG_LEVEL = String(process.env.MYFLIX_LOG_LEVEL || 'info').toLowerCase();
const CURRENT_LEVEL = LEVELS[LOG_LEVEL] || LEVELS.info;
const SENSITIVE_KEYS = /token|authorization|password|secret|api[-_]?key|apikey/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.test(key) || String(key).toLowerCase() === 'key';
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function safeValue(value, depth = 0) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (depth > 5) {
    return '[depth-limit]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => safeValue(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? '[redacted]' : safeValue(item, depth + 1)
    ])
  );
}

function write(level, event, data = {}) {
  if ((LEVELS[level] || LEVELS.info) < CURRENT_LEVEL) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    host: os.hostname(),
    ...safeValue(data)
  };

  const consoleLine = `[${entry.ts}] ${level.toUpperCase()} ${event}`;
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error(`[${entry.ts}] ERROR logger.write_failed`, {
      logFile: LOG_FILE,
      error: error.message
    });
  }

  if (level === 'error') {
    console.error(consoleLine, safeValue(data));
  } else if (level === 'warn') {
    console.warn(consoleLine, safeValue(data));
  }
}

function redactUrl(originalUrl = '') {
  try {
    const parsed = new URL(originalUrl, 'http://localhost');
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch (_error) {
    return String(originalUrl).replace(/([?&](?:token|password|key|apiKey|api_key|secret)=)[^&]+/gi, '$1[redacted]');
  }
}

function requestId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const id = req.headers['x-request-id'] || requestId();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const pathName = req.path || '';
    const isHlsSegment = /\/api\/stream\/.*\/hls\/.*\/segment_\d+\.ts$/i.test(pathName);
    const shouldLog = !isHlsSegment || res.statusCode >= 400;

    if (!shouldLog) {
      return;
    }

    const level = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info');
    write(level, 'http.request', {
      requestId: id,
      method: req.method,
      url: redactUrl(req.originalUrl || req.url),
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip,
      userId: req.user && (req.user.userId || req.user.id),
      range: req.headers.range || null,
      userAgent: req.headers['user-agent'] || null
    });
  });

  next();
}

module.exports = {
  debug: (event, data) => write('debug', event, data),
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data),
  LOG_FILE,
  redactUrl,
  requestLogger
};
