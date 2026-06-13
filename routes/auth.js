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
