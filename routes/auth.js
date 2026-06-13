const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/init');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { loadConfig } = require('../lib/config');
const {
  cleanupIdleSessions,
  createSession,
  getSessionSummary,
  revokeSession
} = require('../lib/sessions');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const appConfig = loadConfig();
const sessionDays = Math.max(1, Number(appConfig.auth?.sessionDays || 180));
const tokenExpiresIn = `${sessionDays}d`;

function signSessionToken(user, sessionId) {
  return jwt.sign(
    { userId: user.id, username: user.username, email: user.email, sessionId },
    JWT_SECRET,
    { expiresIn: tokenExpiresIn }
  );
}

function publicUserRow(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    profilePicture: user.profile_picture,
    isAdmin: user.is_admin === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    watchCount: Number(user.watch_count || 0),
    completedCount: Number(user.completed_count || 0),
    totalWatchSeconds: Number(user.total_watch_seconds || 0),
    favoriteCount: Number(user.favorite_count || 0),
    activeSessions: Number(user.active_sessions || 0),
    lastWatched: user.last_watched || null
  };
}

function validateUserBasics({ username, email }) {
  if (!username || !String(username).trim()) {
    return 'Username is required';
  }
  if (!email || !String(email).trim()) {
    return 'Email is required';
  }
  if (!String(email).includes('@')) {
    return 'A valid email is required';
  }
  return null;
}

async function ensureUniqueUserIdentity({ username, email, excludeUserId = null }) {
  const existingUser = await db.get(
    `SELECT id, username, email
     FROM users
     WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?))
       AND (? IS NULL OR id != ?)`,
    [username, email, excludeUserId, excludeUserId]
  );

  if (!existingUser) return null;
  if (String(existingUser.username).toLowerCase() === String(username).toLowerCase()) {
    return 'Username already exists';
  }
  return 'Email already exists';
}

async function wouldRemoveLastAdmin(userId, nextIsAdmin) {
  if (nextIsAdmin) return false;
  const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [userId]);
  if (!currentUser || currentUser.is_admin !== 1) return false;
  const row = await db.get('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1');
  return Number(row?.count || 0) <= 1;
}

async function revokeUserSessions(userId, reason) {
  await db.run(`
    UPDATE user_sessions
    SET status = 'revoked',
        revoke_reason = ?,
        revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
      AND status = 'active'
  `, [reason, userId]);
}

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if user already exists
    const existingUser = await db.get(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await db.run(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, passwordHash]
    );

    const session = await createSession({ id: result.id, username, email }, req);
    const token = signSessionToken({ id: result.id, username, email }, session.sessionId);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: result.id,
        username,
        email,
        isAdmin: false
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const user = await db.get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, username]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const session = await createSession(user, req);
    const token = signSessionToken(user, session.sessionId);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin === 1,
        profilePicture: user.profile_picture
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, username, email, profile_picture, is_admin, created_at FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      profilePicture: user.profile_picture,
      isAdmin: user.is_admin === 1,
      createdAt: user.created_at
    });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { username, email, currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    // Get current user
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let updateFields = [];
    let updateValues = [];

    // Update username if provided
    if (username && username !== user.username) {
      const existingUser = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
      if (existingUser) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      updateFields.push('username = ?');
      updateValues.push(username);
    }

    // Update email if provided
    if (email && email !== user.email) {
      const existingUser = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
      if (existingUser) {
        return res.status(409).json({ error: 'Email already taken' });
      }
      updateFields.push('email = ?');
      updateValues.push(email);
    }

    // Update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to set new password' });
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValidPassword) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      updateFields.push('password_hash = ?');
      updateValues.push(passwordHash);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Add updated_at timestamp
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(userId);

    // Execute update
    await db.run(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Return updated user info
    const updatedUser = await db.get(
      'SELECT id, username, email, profile_picture, is_admin, created_at FROM users WHERE id = ?',
      [userId]
    );

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        profilePicture: updatedUser.profile_picture,
        isAdmin: updatedUser.is_admin === 1,
        createdAt: updatedUser.created_at
      }
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await db.all(`
      SELECT
        u.id, u.username, u.email, u.profile_picture, u.is_admin, u.created_at, u.updated_at,
        COALESCE(history.watch_count, 0) AS watch_count,
        COALESCE(history.total_watch_seconds, 0) AS total_watch_seconds,
        COALESCE(history.completed_count, 0) AS completed_count,
        COALESCE(favorites.favorite_count, 0) AS favorite_count,
        COALESCE(sessions.active_sessions, 0) AS active_sessions,
        history.last_watched
      FROM users u
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*) AS watch_count,
          COALESCE(SUM(watch_time), 0) AS total_watch_seconds,
          COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS completed_count,
          MAX(last_watched) AS last_watched
        FROM watch_history
        GROUP BY user_id
      ) history ON history.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS favorite_count
        FROM favorites
        GROUP BY user_id
      ) favorites ON favorites.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS active_sessions
        FROM user_sessions
        WHERE status = 'active'
        GROUP BY user_id
      ) sessions ON sessions.user_id = u.id
      ORDER BY u.created_at DESC, u.id DESC
    `);

    res.json({ users: users.map(publicUserRow) });
  } catch (error) {
    console.error('Admin users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    const profilePicture = String(req.body?.profilePicture || '').trim() || null;
    const isAdmin = req.body?.isAdmin === true ? 1 : 0;

    const validationError = validateUserBasics({ username, email });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const uniquenessError = await ensureUniqueUserIdentity({ username, email });
    if (uniquenessError) {
      return res.status(409).json({ error: uniquenessError });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.run(
      `INSERT INTO users (username, email, password_hash, profile_picture, is_admin)
       VALUES (?, ?, ?, ?, ?)`,
      [username, email, passwordHash, profilePicture, isAdmin]
    );
    const user = await db.get('SELECT * FROM users WHERE id = ?', [result.id]);

    res.status(201).json({
      message: 'User created successfully',
      user: publicUserRow(user)
    });
  } catch (error) {
    console.error('Admin user create error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = String(req.body?.username || user.username).trim();
    const email = String(req.body?.email || user.email).trim();
    const profilePicture = req.body?.profilePicture === undefined
      ? user.profile_picture
      : (String(req.body.profilePicture || '').trim() || null);
    const isAdmin = req.body?.isAdmin === true ? 1 : 0;
    const password = String(req.body?.password || '');

    const validationError = validateUserBasics({ username, email });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    if (password && password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    if (await wouldRemoveLastAdmin(userId, isAdmin === 1)) {
      return res.status(400).json({ error: 'Cannot remove admin rights from the last admin user' });
    }

    const uniquenessError = await ensureUniqueUserIdentity({ username, email, excludeUserId: userId });
    if (uniquenessError) {
      return res.status(409).json({ error: uniquenessError });
    }

    const fields = [
      'username = ?',
      'email = ?',
      'profile_picture = ?',
      'is_admin = ?',
      'updated_at = CURRENT_TIMESTAMP'
    ];
    const values = [username, email, profilePicture, isAdmin];
    if (password) {
      fields.splice(4, 0, 'password_hash = ?');
      values.push(await bcrypt.hash(password, 10));
    }
    values.push(userId);

    await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    if (password || isAdmin !== user.is_admin) {
      await revokeUserSessions(userId, password ? 'admin-password-reset' : 'admin-role-updated');
    }
    const updatedUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]);

    res.json({
      message: 'User updated successfully',
      user: publicUserRow(updatedUser)
    });
  } catch (error) {
    console.error('Admin user update error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await db.get('SELECT id, username, is_admin FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (await wouldRemoveLastAdmin(userId, false)) {
      return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }

    await db.run('DELETE FROM watch_history WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM favorites WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
    const result = await db.run('DELETE FROM users WHERE id = ?', [userId]);

    res.json({
      deleted: result.changes || 0,
      username: user.username
    });
  } catch (error) {
    console.error('Admin user delete error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.get('/users/:id/history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await db.get('SELECT id, username, email, profile_picture, is_admin, created_at, updated_at FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const history = await db.all(`
      SELECT
        wh.movie_id, wh.watch_time, wh.completed, wh.last_watched,
        m.title, m.duration, m.poster_url, m.thumbnail, m.media_type, m.series_title,
        m.season_number, m.episode_number, m.episode_title, m.release_year, m.rated
      FROM watch_history wh
      LEFT JOIN movies m ON m.id = wh.movie_id
      WHERE wh.user_id = ?
      ORDER BY wh.last_watched DESC
      LIMIT ?
    `, [userId, limit]);

    const stats = await db.get(`
      SELECT
        COUNT(*) AS entries,
        COALESCE(SUM(watch_time), 0) AS totalWatchSeconds,
        COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS completedCount,
        MAX(last_watched) AS lastWatched
      FROM watch_history
      WHERE user_id = ?
    `, [userId]);

    res.json({
      user: publicUserRow(user),
      stats: {
        entries: Number(stats?.entries || 0),
        totalWatchSeconds: Number(stats?.totalWatchSeconds || 0),
        completedCount: Number(stats?.completedCount || 0),
        lastWatched: stats?.lastWatched || null
      },
      history: history.map((item) => ({
        movieId: item.movie_id,
        watchTime: Number(item.watch_time || 0),
        completed: item.completed === 1,
        lastWatched: item.last_watched,
        title: item.title || `Removed title ${item.movie_id}`,
        duration: item.duration,
        posterUrl: item.poster_url,
        thumbnail: item.thumbnail,
        mediaType: item.media_type || 'movie',
        seriesTitle: item.series_title,
        seasonNumber: item.season_number,
        episodeNumber: item.episode_number,
        episodeTitle: item.episode_title,
        releaseYear: item.release_year,
        rated: item.rated
      }))
    });
  } catch (error) {
    console.error('Admin user history fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch viewing history' });
  }
});

router.delete('/users/:id/history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const result = await db.run('DELETE FROM watch_history WHERE user_id = ?', [userId]);
    res.json({ cleared: result.changes || 0 });
  } catch (error) {
    console.error('Admin user history clear error:', error);
    res.status(500).json({ error: 'Failed to clear viewing history' });
  }
});

router.delete('/users/:id/history/:movieId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const movieId = Number(req.params.movieId);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(movieId) || movieId <= 0) {
      return res.status(400).json({ error: 'Invalid user or movie id' });
    }

    const result = await db.run('DELETE FROM watch_history WHERE user_id = ? AND movie_id = ?', [userId, movieId]);
    res.json({ removed: result.changes || 0 });
  } catch (error) {
    console.error('Admin user history remove error:', error);
    res.status(500).json({ error: 'Failed to remove viewing history item' });
  }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, username, email FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const token = signSessionToken(user, req.user.sessionId);

    res.json({ token });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json(await getSessionSummary(req.query.limit));
  } catch (error) {
    console.error('Session summary error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

router.post('/sessions/cleanup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cleanup = await cleanupIdleSessions('manual-admin-cleanup');
    const summary = await getSessionSummary(req.body?.limit || 100);
    res.json({ cleanup, summary });
  } catch (error) {
    console.error('Session cleanup error:', error);
    res.status(500).json({ error: 'Failed to clean idle sessions' });
  }
});

router.delete('/sessions/:sessionId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await revokeSession(req.params.sessionId, 'admin-terminated');
    res.json({ terminated: result.changes || 0 });
  } catch (error) {
    console.error('Session termination error:', error);
    res.status(500).json({ error: 'Failed to terminate session' });
  }
});

router.post('/logout', authenticateToken, async (req, res) => {
  await revokeSession(req.user.sessionId, 'logout');
  res.json({ message: 'Logout successful' });
});

module.exports = router;
