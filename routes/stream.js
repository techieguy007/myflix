const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../database/init');
const { optionalAuth } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// MIME type mapping for video formats
const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.mkv': 'video/x-matroska',
    '.m4v': 'video/x-m4v',
    '.3gp': 'video/3gpp',
    '.ts': 'video/mp2t'
  };
  return mimeTypes[ext] || 'video/mp4'; // Default to mp4
};

// Check if format is browser-compatible
const isBrowserCompatible = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  // Most browsers support these formats well
  const compatibleFormats = ['.mp4', '.webm', '.ogg', '.m4v'];
  return compatibleFormats.includes(ext);
};

const router = express.Router();

// Custom auth middleware for video streaming (supports query token)
const streamAuth = async (req, res, next) => {
  // Try header-based auth first (from optionalAuth)
  const headerToken = req.headers.authorization?.replace('Bearer ', '');
  // Try query-based auth for video elements
  const queryToken = req.query.token;
  
  const token = headerToken || queryToken;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      req.user = decoded;
    } catch (error) {
      // Invalid token, but continue without auth (optional auth)
      console.log('Invalid auth token for streaming:', error.message);
    }
  }
  
  next();
};

// Test endpoint to check if streaming is working
router.get('/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Streaming service is running',
    timestamp: new Date().toISOString()
  });
});

// Stream video file with range requests support
router.get('/:id', streamAuth, async (req, res) => {
  try {
    const movieId = req.params.id;

    
    // Get movie info
    const movie = await db.get('SELECT video_path, title, file_size FROM movies WHERE id = ?', [movieId]);
    
    if (!movie) {
      console.error(`Movie not found in database: ${movieId}`);
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    console.log(`📁 Movie found: ${movie.title} at ${movie.video_path}`);
    
    const videoPath = movie.video_path;
    
    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      console.error(`❌ Video file not found at path: ${videoPath}`);
      return res.status(404).json({ error: 'Video file not found' });
    }
    
    

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = getMimeType(videoPath);
    const isCompatible = isBrowserCompatible(videoPath);
    const fileName = path.basename(videoPath);
    
    // Check compatibility (informational only)

    if (range) {
      // Parse range header
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      // Create readable stream for the requested range
      const file = fs.createReadStream(videoPath, { start, end });

      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // No range requested, send entire file
      const head = {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      };

      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }

    // Log viewing (optional, for analytics)
    if (req.user) {
      // Don't await this to avoid slowing down the stream
      db.run(`
        INSERT OR REPLACE INTO watch_history (user_id, movie_id, watch_time, last_watched)
        VALUES (?, ?, COALESCE((SELECT watch_time FROM watch_history WHERE user_id = ? AND movie_id = ?), 0), CURRENT_TIMESTAMP)
      `, [req.user.userId, movieId, req.user.userId, movieId])
        .catch(err => console.error('Error logging view:', err));
    }

  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).json({ error: 'Streaming error' });
  }
});

// Get video metadata/info
router.get('/:id/info', optionalAuth, async (req, res) => {
  try {
    const movieId = req.params.id;
    
    const movie = await db.get(`
      SELECT id, title, duration, format, resolution, file_size 
      FROM movies WHERE id = ?
    `, [movieId]);
    
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Check if file exists
    if (movie.video_path && !fs.existsSync(movie.video_path)) {
      return res.status(404).json({ error: 'Video file not accessible' });
    }

    res.json({
      id: movie.id,
      title: movie.title,
      duration: movie.duration,
      format: movie.format,
      resolution: movie.resolution,
      fileSize: movie.file_size
    });

  } catch (error) {
    console.error('Get video info error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get thumbnail/poster image
router.get('/:id/thumbnail', async (req, res) => {
  try {
    const movieId = req.params.id;
    
    const movie = await db.get('SELECT thumbnail FROM movies WHERE id = ?', [movieId]);
    
    if (!movie || !movie.thumbnail) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }

    const thumbnailPath = movie.thumbnail;
    
    if (!fs.existsSync(thumbnailPath)) {
      return res.status(404).json({ error: 'Thumbnail file not found' });
    }

    const stat = fs.statSync(thumbnailPath);
    const ext = path.extname(thumbnailPath).toLowerCase();
    
    let contentType = 'image/jpeg'; // default
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';

    res.set({
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400' // Cache for 1 day
    });

    fs.createReadStream(thumbnailPath).pipe(res);

  } catch (error) {
    console.error('Thumbnail streaming error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate or get video preview/trailer (if available)
router.get('/:id/preview', optionalAuth, async (req, res) => {
  try {
    const movieId = req.params.id;
    
    // This could be expanded to generate video previews
    // For now, just return info about preview availability
    const movie = await db.get('SELECT id, title FROM movies WHERE id = ?', [movieId]);
    
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // In a full implementation, you could:
    // 1. Generate preview clips using FFmpeg
    // 2. Store preview files separately
    // 3. Return preview URLs
    
    res.json({
      id: movie.id,
      title: movie.title,
      previewAvailable: false,
      message: 'Preview generation not implemented yet'
    });

  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get stream quality options (if multiple versions exist)
router.get('/:id/qualities', async (req, res) => {
  try {
    const movieId = req.params.id;
    
    const movie = await db.get(`
      SELECT id, title, resolution, format, file_size
      FROM movies WHERE id = ?
    `, [movieId]);
    
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // In a full implementation, you could store multiple quality versions
    // For now, return the single available quality
    res.json({
      qualities: [
        {
          resolution: movie.resolution || 'Unknown',
          format: movie.format || 'mp4',
          fileSize: movie.file_size,
          label: movie.resolution ? `${movie.resolution}` : 'Original',
          isDefault: true
        }
      ]
    });

  } catch (error) {
    console.error('Get qualities error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Subtitle support (if subtitle files are available)
router.get('/:id/subtitles', async (req, res) => {
  try {
    const movieId = req.params.id;
    
    const movie = await db.get('SELECT video_path FROM movies WHERE id = ?', [movieId]);
    
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Look for subtitle files in the same directory
    const videoDir = path.dirname(movie.video_path);
    const videoName = path.basename(movie.video_path, path.extname(movie.video_path));
    
    const subtitleExtensions = ['.srt', '.vtt', '.ass', '.ssa'];
    const availableSubtitles = [];

    subtitleExtensions.forEach(ext => {
      const subtitlePath = path.join(videoDir, videoName + ext);
      if (fs.existsSync(subtitlePath)) {
        availableSubtitles.push({
          language: 'en', // Could be parsed from filename
          format: ext.substring(1),
          url: `/api/stream/${movieId}/subtitle${ext}`
        });
      }
    });

    res.json({ subtitles: availableSubtitles });

  } catch (error) {
    console.error('Get subtitles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve subtitle files
router.get('/:id/subtitle:ext', async (req, res) => {
  try {
    const movieId = req.params.id;
    const ext = req.params.ext;
    
    const movie = await db.get('SELECT video_path FROM movies WHERE id = ?', [movieId]);
    
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    const videoDir = path.dirname(movie.video_path);
    const videoName = path.basename(movie.video_path, path.extname(movie.video_path));
    const subtitlePath = path.join(videoDir, videoName + ext);

    if (!fs.existsSync(subtitlePath)) {
      return res.status(404).json({ error: 'Subtitle file not found' });
    }

    let contentType = 'text/plain';
    if (ext === '.srt') contentType = 'application/x-subrip';
    else if (ext === '.vtt') contentType = 'text/vtt';

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400'
    });

    fs.createReadStream(subtitlePath).pipe(res);

  } catch (error) {
    console.error('Subtitle streaming error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 