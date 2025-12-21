const express = require('express');
const db = require('../database/init');
const { authenticateToken, requireAdmin, optionalAuth } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Get all movies with optional filtering and pagination
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      genre, 
      search, 
      sort = 'created_at',
      order = 'DESC' 
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];

    // Add genre filter
    if (genre) {
      whereConditions.push('genre LIKE ?');
      queryParams.push(`%${genre}%`);
    }

    // Add search filter
    if (search) {
      whereConditions.push('(title LIKE ? OR description LIKE ? OR director LIKE ? OR "cast" LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // Validate sort column
    const validSortColumns = ['title', 'release_year', 'rating', 'duration', 'created_at'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get movies with all OMDb fields
    const movies = await db.all(
      `SELECT id, title, description, genre, release_year, duration, rating, director, "cast", thumbnail, created_at, 
              poster_url, imdb_id, imdb_rating, plot, runtime, rated, country, language, awards, omdb_updated 
       FROM movies ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );
    

    // Get total count for pagination
    const countResult = await db.get(`
      SELECT COUNT(*) as total 
      FROM movies 
      ${whereClause}
    `, queryParams);

    // Add user-specific data if authenticated
    if (req.user) {
      for (let movie of movies) {
        // Get watch history
        const watchHistory = await db.get(
          'SELECT watch_time, completed FROM watch_history WHERE user_id = ? AND movie_id = ?',
          [req.user.userId, movie.id]
        );

        // Check if favorited
        const favorite = await db.get(
          'SELECT id FROM favorites WHERE user_id = ? AND movie_id = ?',
          [req.user.userId, movie.id]
        );

        movie.watchTime = watchHistory ? watchHistory.watch_time : 0;
        movie.completed = watchHistory ? watchHistory.completed === 1 : false;
        movie.isFavorite = !!favorite;
      }
    }

    res.json({
      movies,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        pages: Math.ceil(countResult.total / limit)
      }
    });

  } catch (error) {
    console.error('Get movies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single movie by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const movieId = req.params.id;

    const movie = await db.get(
      `SELECT m.*, u.username as uploaded_by_username FROM movies m LEFT JOIN users u ON m.uploaded_by = u.id WHERE m.id = ?`,
      [movieId]
    );

    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Add user-specific data if authenticated
    if (req.user) {
      // Get watch history
      const watchHistory = await db.get(
        'SELECT watch_time, completed, last_watched FROM watch_history WHERE user_id = ? AND movie_id = ?',
        [req.user.userId, movieId]
      );

      // Check if favorited
      const favorite = await db.get(
        'SELECT id FROM favorites WHERE user_id = ? AND movie_id = ?',
        [req.user.userId, movieId]
      );

      movie.watchTime = watchHistory ? watchHistory.watch_time : 0;
      movie.completed = watchHistory ? watchHistory.completed === 1 : false;
      movie.lastWatched = watchHistory ? watchHistory.last_watched : null;
      movie.isFavorite = !!favorite;
    }

    res.json(movie);

  } catch (error) {
    console.error('Get movie error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get movies by genre/category
router.get('/genre/:genre', optionalAuth, async (req, res) => {
  try {
    const { genre } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const movies = await db.all(
      `SELECT id, title, description, genre, release_year, duration, rating, director, "cast", thumbnail, format, resolution, created_at FROM movies WHERE genre LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [`%${genre}%`, parseInt(limit), parseInt(offset)]
    );

    // Get total count
    const countResult = await db.get(
      'SELECT COUNT(*) as total FROM movies WHERE genre LIKE ?',
      [`%${genre}%`]
    );

    res.json({
      movies,
      genre,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        pages: Math.ceil(countResult.total / limit)
      }
    });

  } catch (error) {
    console.error('Get movies by genre error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add movie to favorites
router.post('/:id/favorite', authenticateToken, async (req, res) => {
  try {
    const movieId = req.params.id;
    const userId = req.user.userId;

    // Check if movie exists
    const movie = await db.get('SELECT id FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Check if already favorited
    const existingFavorite = await db.get(
      'SELECT id FROM favorites WHERE user_id = ? AND movie_id = ?',
      [userId, movieId]
    );

    if (existingFavorite) {
      return res.status(409).json({ error: 'Movie already in favorites' });
    }

    // Add to favorites
    await db.run(
      'INSERT INTO favorites (user_id, movie_id) VALUES (?, ?)',
      [userId, movieId]
    );

    res.json({ message: 'Movie added to favorites' });

  } catch (error) {
    console.error('Add favorite error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove movie from favorites
router.delete('/:id/favorite', authenticateToken, async (req, res) => {
  try {
    const movieId = req.params.id;
    const userId = req.user.userId;

    const result = await db.run(
      'DELETE FROM favorites WHERE user_id = ? AND movie_id = ?',
      [userId, movieId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Favorite not found' });
    }

    res.json({ message: 'Movie removed from favorites' });

  } catch (error) {
    console.error('Remove favorite error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's favorite movies
router.get('/user/favorites', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const movies = await db.all(
      `SELECT m.id, m.title, m.description, m.genre, m.release_year, m.duration, m.rating, m.director, m."cast", m.thumbnail, m.format, m.resolution, f.created_at as favorited_at FROM favorites f JOIN movies m ON f.movie_id = m.id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    // Get total count
    const countResult = await db.get(
      'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?',
      [userId]
    );

    res.json({
      movies,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        pages: Math.ceil(countResult.total / limit)
      }
    });

  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update watch progress
router.post('/:id/progress', authenticateToken, async (req, res) => {
  try {
    const movieId = req.params.id;
    const userId = req.user.userId;
    const { watchTime, completed = false } = req.body;

    if (typeof watchTime !== 'number' || watchTime < 0) {
      return res.status(400).json({ error: 'Invalid watch time' });
    }

    // Check if movie exists
    const movie = await db.get('SELECT id FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Update or insert watch history
    await db.run(`
      INSERT OR REPLACE INTO watch_history (user_id, movie_id, watch_time, completed, last_watched)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [userId, movieId, watchTime, completed ? 1 : 0]);

    res.json({ message: 'Watch progress updated' });

  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get continue watching movies
router.get('/user/continue-watching', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const movies = await db.all(
      `SELECT m.id, m.title, m.description, m.genre, m.release_year, m.duration, m.rating, m.director, m."cast", m.thumbnail, m.format, m.resolution, wh.watch_time, wh.last_watched FROM watch_history wh JOIN movies m ON wh.movie_id = m.id WHERE wh.user_id = ? AND wh.completed = 0 AND wh.watch_time > 0 ORDER BY wh.last_watched DESC LIMIT 10`,
      [userId]
    );

    res.json(movies);

  } catch (error) {
    console.error('Get continue watching error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin routes for movie management
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const movieId = req.params.id;
    const { 
      title, description, genre, release_year, 
      rating, director, cast, thumbnail 
    } = req.body;

    // Check if movie exists
    const movie = await db.get('SELECT id FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    let updateFields = [];
    let updateValues = [];

    if (title !== undefined) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(description);
    }
    if (genre !== undefined) {
      updateFields.push('genre = ?');
      updateValues.push(genre);
    }
    if (release_year !== undefined) {
      updateFields.push('release_year = ?');
      updateValues.push(release_year);
    }
    if (rating !== undefined) {
      updateFields.push('rating = ?');
      updateValues.push(rating);
    }
    if (director !== undefined) {
      updateFields.push('director = ?');
      updateValues.push(director);
    }
    if (cast !== undefined) {
      updateFields.push('"cast" = ?');
      updateValues.push(cast);
    }
    if (thumbnail !== undefined) {
      updateFields.push('thumbnail = ?');
      updateValues.push(thumbnail);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(movieId);

    await db.run(
      `UPDATE movies SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({ message: 'Movie updated successfully' });

  } catch (error) {
    console.error('Update movie error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete movies (admin only) - MUST come before /:id route
router.delete('/bulk', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { movieIds } = req.body;

    if (!movieIds || !Array.isArray(movieIds) || movieIds.length === 0) {
      return res.status(400).json({ error: 'Movie IDs array is required' });
    }



    let deletedCount = 0;
    let failedIds = [];

    for (const movieId of movieIds) {
      try {
        // Get movie info for thumbnail cleanup
        const movie = await db.get('SELECT video_path, thumbnail FROM movies WHERE id = ?', [movieId]);
        
        if (!movie) {
          failedIds.push(movieId);
          continue;
        }

        // Delete associated records
        await db.run('DELETE FROM watch_history WHERE movie_id = ?', [movieId]);
        await db.run('DELETE FROM favorites WHERE movie_id = ?', [movieId]);
        await db.run('DELETE FROM movie_categories WHERE movie_id = ?', [movieId]);

        // Delete movie record
        await db.run('DELETE FROM movies WHERE id = ?', [movieId]);

        // Clean up only generated files (NOT the original video file)
        try {
          // Only delete generated thumbnails, keep original video files
          if (movie.thumbnail) {
            const thumbnailPath = path.join(__dirname, '..', movie.thumbnail);
            if (fs.existsSync(thumbnailPath)) {
              fs.unlinkSync(thumbnailPath);
            }
          }
          // Original video file is preserved
        } catch (fileError) {
          console.error(`Thumbnail cleanup error for movie ${movieId}:`, fileError);
        }

        deletedCount++;

      } catch (movieError) {
        console.error(`Error deleting movie ${movieId}:`, movieError);
        failedIds.push(movieId);
      }
    }



    res.json({ 
      message: `Successfully removed ${deletedCount} movies from library`,
      deletedCount,
      failedCount: failedIds.length,
      failedIds,
      note: 'Original video files have been preserved'
    });

  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Failed to delete movies' });
  }
});

// Delete movie (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const movieId = req.params.id;

    // Get movie info for file cleanup
    const movie = await db.get('SELECT video_path, thumbnail FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Delete associated records
    await db.run('DELETE FROM watch_history WHERE movie_id = ?', [movieId]);
    await db.run('DELETE FROM favorites WHERE movie_id = ?', [movieId]);
    await db.run('DELETE FROM movie_categories WHERE movie_id = ?', [movieId]);

    // Delete movie record
    await db.run('DELETE FROM movies WHERE id = ?', [movieId]);

    // Clean up only generated files (NOT the original video file)
    try {
      // Only delete generated thumbnails, keep original video files
      if (movie.thumbnail) {
        const thumbnailPath = path.join(__dirname, '..', movie.thumbnail);
        if (fs.existsSync(thumbnailPath)) {
          fs.unlinkSync(thumbnailPath);

        }
      }
      
      // DO NOT delete the original video file - it's part of the user's collection
      console.log(`📁 Original video file preserved: ${movie.video_path}`);
      
    } catch (fileError) {
      console.error('Thumbnail cleanup error:', fileError);
    }

    res.json({ 
      message: 'Movie removed from library successfully',
      note: 'Original video file has been preserved'
    });

  } catch (error) {
    console.error('Delete movie error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get subtitle tracks for a specific movie
router.get('/:id/subtitles', authenticateToken, async (req, res) => {
  try {
    const movieId = req.params.id;
    
    // Get movie info
    const movie = await db.get('SELECT video_path, title FROM movies WHERE id = ?', [movieId]);
    
    if (!movie || !movie.video_path) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Check if file exists
    if (!fs.existsSync(movie.video_path)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    // Temporarily return empty subtitle list to avoid ffprobe issues
    // Browser-based subtitle detection will handle this
    res.json({
      movieId,
      title: movie.title,
      subtitles: []
    });
  } catch (error) {
    console.error('Error fetching movie subtitles:', error);
    res.status(500).json({ error: 'Failed to fetch subtitle information' });
  }
});

module.exports = router; 
