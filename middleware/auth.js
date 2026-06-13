const jwt = require('jsonwebtoken');
const db = require('../database/init');
const logger = require('../lib/logger');
const { touchSessionForToken } = require('../lib/sessions');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

function verifyJwtToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function authenticateTokenValue(token, req) {
  const user = verifyJwtToken(token);
  const session = await touchSessionForToken(user, token, req);
  return {
    ...user,
    sessionId: session.sessionId,
    sessionLegacy: session.legacy
  };
}

// Middleware to authenticate JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    logger.warn('auth.token_missing', {
      requestId: req.requestId,
      method: req.method,
      url: logger.redactUrl(req.originalUrl || req.url)
    });
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const user = await authenticateTokenValue(token, req);
    req.user = user;
    next();
  } catch (err) {
    logger.warn('auth.token_invalid', {
      requestId: req.requestId,
      method: req.method,
      url: logger.redactUrl(req.originalUrl || req.url),
      error: err
    });
    const statusCode = err.sessionExpired ? 401 : 403;
    return res.status(statusCode).json({ error: err.message || 'Invalid or expired token' });
  }
};

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    const user = await db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.userId]);
    
    if (!user || user.is_admin !== 1) {
      logger.warn('auth.admin_denied', {
        requestId: req.requestId,
        method: req.method,
        url: logger.redactUrl(req.originalUrl || req.url),
        userId: req.user && req.user.userId
      });
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    logger.error('auth.admin_check_failed', {
      requestId: req.requestId,
      method: req.method,
      url: logger.redactUrl(req.originalUrl || req.url),
      userId: req.user && req.user.userId,
      error
    });
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Optional authentication - doesn't fail if no token provided
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = await authenticateTokenValue(token, req);
  } catch (err) {
    logger.warn('auth.optional_token_invalid', {
      requestId: req.requestId,
      method: req.method,
      url: logger.redactUrl(req.originalUrl || req.url),
      error: err
    });
    req.user = null;
  }
  next();
};

module.exports = {
  authenticateTokenValue,
  authenticateToken,
  requireAdmin,
  optionalAuth
};
