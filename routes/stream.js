const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../database/init');
const logger = require('../lib/logger');
const { optionalAuth } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const {
  ensureHlsTranscode,
  ensureSubtitleTrack,
  getPlaybackProfile,
  hlsAssetPath,
  hlsContentType,
  optionsFromVariant,
  preparedAssetPath,
  waitForFile
} = require('../lib/transcoder');

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
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Custom auth middleware for video streaming (supports query token)
const streamAuth = async (req, res, next) => {
  // Try header-based auth first (from optionalAuth)
  const headerToken = req.headers.authorization?.replace('Bearer ', '');
  // Try query-based auth for video elements
  const queryToken = req.query.token;
  
  const token = headerToken || queryToken;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Invalid token, but continue without auth (optional auth)
      logger.warn('stream.invalid_auth_token', {
        requestId: req.requestId,
        url: logger.redactUrl(req.originalUrl || req.url),
        error
      });
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

function tokenQuery(req) {
  return req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : '';
}

function truthyQuery(value) {
  return ['1', 'true', 'yes', 'mobile', 'compatible'].includes(String(value || '').toLowerCase());
}

function isMobilePlaybackClient(req) {
  const userAgent = String(req.headers['user-agent'] || '');
  return /Android|iPhone|iPad|iPod|Mobile|EdgA|CriOS|FxiOS/i.test(userAgent);
}

function selectedAudioFromQuery(req) {
  const options = {};
  if (req.query.audio === undefined || req.query.audio === '' || req.query.audio === 'auto') {
    // Keep automatic selection.
  } else {
    const audioStreamIndex = Number(req.query.audio);
    if (Number.isInteger(audioStreamIndex)) {
      options.audioStreamIndex = audioStreamIndex;
    }
  }

  const startSeconds = Number(req.query.start);
  if (Number.isFinite(startSeconds) && startSeconds > 0) {
    options.startSeconds = Math.floor(startSeconds);
  }

  if (truthyQuery(req.query.compatible) || isMobilePlaybackClient(req)) {
    options.forceCompatible = true;
  }

  return options;
}

async function getStreamMovie(movieId) {
  const movie = await db.get('SELECT id, video_path, title, file_size FROM movies WHERE id = ?', [movieId]);

  if (!movie) {
    const error = new Error('Movie not found');
    error.statusCode = 404;
    throw error;
  }

  if (!movie.video_path || !fs.existsSync(movie.video_path)) {
    const error = new Error('Video file not found');
    error.statusCode = 404;
    throw error;
  }

  return movie;
}

function serveVideoFile(req, res, movie, videoPath, options = {}) {
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mimeType = getMimeType(videoPath);
  const fileName = path.basename(videoPath);
  const streamKind = options.streamKind || 'direct';

  logger.info('stream.file_started', {
    requestId: req.requestId,
    movieId: movie.id || req.params.id,
    title: movie.title,
    streamKind,
    fileName,
    mimeType,
    fileSize,
    range: range || null
  });

  const onReadError = (error) => {
    logger.error('stream.file_read_failed', {
      requestId: req.requestId,
      movieId: movie.id || req.params.id,
      title: movie.title,
      streamKind,
      videoPath,
      error
    });
  };

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    file.on('error', onReadError);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
      'Cache-Control': options.cacheControl || 'no-cache',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });
    file.pipe(res);
    return;
  }

  const file = fs.createReadStream(videoPath);
  file.on('error', onReadError);
  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': options.cacheControl || 'no-cache',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  });
  file.pipe(res);
}

// Tell the client whether to direct-play or use browser-compatible HLS.
router.get('/:id/playback', streamAuth, async (req, res) => {
  try {
    const movie = await getStreamMovie(req.params.id);
    const playbackOptions = selectedAudioFromQuery(req);
    const profile = await getPlaybackProfile(movie, playbackOptions);
    const query = tokenQuery(req);
    const directUrl = profile.streamMode === 'prepared'
      ? `/api/stream/${movie.id}/prepared/${profile.preparedVariant}${query}`
      : profile.streamMode === 'direct'
        ? `/api/stream/${movie.id}${query}`
        : null;
    logger.info('stream.playback_profile_response', {
      requestId: req.requestId,
      movieId: movie.id,
      title: movie.title,
      streamMode: profile.streamMode,
      hlsVariant: profile.hlsVariant,
      preparedVariant: profile.preparedVariant,
      preparedReady: profile.preparedReady,
      directPlayable: profile.directPlayable,
      forceCompatible: playbackOptions.forceCompatible || false,
      audioTracks: profile.audioTracks.length,
      subtitleTracks: profile.subtitleTracks.length,
      startSeconds: profile.startSeconds
    });

    res.json({
      id: movie.id,
      title: movie.title,
      streamMode: profile.streamMode,
      directUrl,
      hlsUrl: profile.streamMode === 'hls'
        ? `/api/stream/${movie.id}/hls/${profile.hlsVariant}/index.m3u8${query}`
        : null,
      startSeconds: profile.startSeconds,
      compatibility: profile
    });
  } catch (error) {
    logger.error('stream.playback_profile_failed', {
      requestId: req.requestId,
      movieId: req.params.id,
      error
    });
    console.error('Playback profile error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Playback profile error' });
  }
});

// Serve prepared browser-compatible MP4 files with range support.
router.get('/:id/prepared/:variant', streamAuth, async (req, res) => {
  try {
    const movie = await getStreamMovie(req.params.id);
    const assetPath = preparedAssetPath(movie.id, movie.video_path, req.params.variant);

    if (!assetPath) {
      logger.warn('stream.prepared_invalid_asset_path', {
        requestId: req.requestId,
        movieId: movie.id,
        variant: req.params.variant
      });
      return res.status(400).json({ error: 'Invalid prepared asset path' });
    }

    if (!fs.existsSync(assetPath)) {
      logger.warn('stream.prepared_missing', {
        requestId: req.requestId,
        movieId: movie.id,
        title: movie.title,
        variant: req.params.variant,
        assetPath
      });
      return res.status(404).json({ error: 'Prepared stream is not ready yet' });
    }

    return serveVideoFile(req, res, movie, assetPath, {
      streamKind: 'prepared',
      cacheControl: 'public, max-age=3600'
    });
  } catch (error) {
    logger.error('stream.prepared_failed', {
      requestId: req.requestId,
      movieId: req.params.id,
      variant: req.params.variant,
      error
    });
    console.error('Prepared streaming error:', error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Prepared streaming error' });
  }
});

// Generate and serve HLS playlists/segments for browser-incompatible files.
router.get('/:id/hls/:variant/:file', streamAuth, async (req, res) => {
  try {
    const movie = await getStreamMovie(req.params.id);
    const variant = req.params.variant;
    const fileName = req.params.file;
    const isManifest = fileName === 'index.m3u8';
    const assetPath = hlsAssetPath(movie.id, movie.video_path, variant, fileName);

    if (!assetPath) {
      logger.warn('stream.hls_invalid_asset_path', {
        requestId: req.requestId,
        movieId: movie.id,
        variant,
        fileName
      });
      return res.status(400).json({ error: 'Invalid HLS asset path' });
    }

    if (isManifest) {
      logger.info('stream.hls_manifest_requested', {
        requestId: req.requestId,
        movieId: movie.id,
        title: movie.title,
        variant,
        assetPath
      });
      const job = ensureHlsTranscode(movie, optionsFromVariant(variant));
      const ready = job.ready || await waitForFile(job.manifestPath, 25000);
      if (!ready) {
        logger.warn('stream.hls_manifest_not_ready', {
          requestId: req.requestId,
          movieId: movie.id,
          variant,
          manifestPath: job.manifestPath,
          transcodeRunning: job.running
        });
        return res.status(503).json({ error: 'Transcode is still starting. Retry in a few seconds.' });
      }
    }

    if (!fs.existsSync(assetPath)) {
      const ready = isManifest ? false : await waitForFile(assetPath, 15000);
      if (ready) {
        logger.info('stream.hls_asset_became_ready', {
          requestId: req.requestId,
          movieId: movie.id,
          variant,
          fileName,
          assetPath
        });
      }
    }

    if (!fs.existsSync(assetPath)) {
      logger.warn('stream.hls_asset_missing', {
        requestId: req.requestId,
        movieId: movie.id,
        variant,
        fileName,
        assetPath
      });
      return res.status(404).json({ error: 'HLS asset not ready' });
    }

    res.set({
      'Content-Type': hlsContentType(fileName),
      'Cache-Control': fileName.endsWith('.m3u8') ? 'no-cache' : 'public, max-age=3600',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });

    return res.sendFile(assetPath);
  } catch (error) {
    logger.error('stream.hls_failed', {
      requestId: req.requestId,
      movieId: req.params.id,
      variant: req.params.variant,
      fileName: req.params.file,
      error
    });
    console.error('HLS streaming error:', error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'HLS streaming error' });
  }
});

router.get('/:id/subtitle/:streamIndex.vtt', streamAuth, async (req, res) => {
  try {
    const movie = await getStreamMovie(req.params.id);
    const subtitlePath = await ensureSubtitleTrack(movie, req.params.streamIndex);
    logger.info('stream.subtitle_served', {
      requestId: req.requestId,
      movieId: movie.id,
      title: movie.title,
      streamIndex: req.params.streamIndex,
      subtitlePath
    });

    res.set({
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });

    return res.sendFile(subtitlePath);
  } catch (error) {
    logger.error('stream.subtitle_failed', {
      requestId: req.requestId,
      movieId: req.params.id,
      streamIndex: req.params.streamIndex,
      error
    });
    console.error('Subtitle extraction error:', error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Subtitle extraction error' });
  }
});

// Stream video file with range requests support
router.get('/:id', streamAuth, async (req, res) => {
  try {
    const movieId = req.params.id;

    
    // Get movie info
    const movie = await db.get('SELECT video_path, title, file_size FROM movies WHERE id = ?', [movieId]);
    
    if (!movie) {
      logger.warn('stream.direct_movie_missing', {
        requestId: req.requestId,
        movieId
      });
      console.error(`Movie not found in database: ${movieId}`);
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    const videoPath = movie.video_path;
    
    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      logger.warn('stream.direct_file_missing', {
        requestId: req.requestId,
        movieId,
        title: movie.title,
        videoPath
      });
      console.error(`❌ Video file not found at path: ${videoPath}`);
      return res.status(404).json({ error: 'Video file not found' });
    }
    
    

    const isCompatible = isBrowserCompatible(videoPath);
    const fileName = path.basename(videoPath);
    logger.info('stream.direct_started', {
      requestId: req.requestId,
      movieId,
      title: movie.title,
      fileName,
      isCompatible
    });
    
    // Check compatibility (informational only)
    serveVideoFile(req, res, { ...movie, id: movieId }, videoPath, { streamKind: 'original' });

    // Log viewing (optional, for analytics)
    if (req.user) {
      // Don't await this to avoid slowing down the stream
      db.run(`
        INSERT OR REPLACE INTO watch_history (user_id, movie_id, watch_time, last_watched)
        VALUES (?, ?, COALESCE((SELECT watch_time FROM watch_history WHERE user_id = ? AND movie_id = ?), 0), CURRENT_TIMESTAMP)
      `, [req.user.userId, movieId, req.user.userId, movieId])
        .catch((error) => {
          logger.warn('stream.watch_history_failed', {
            requestId: req.requestId,
            movieId,
            userId: req.user.userId,
            error
          });
          console.error('Error logging view:', error);
        });
    }

  } catch (error) {
    logger.error('stream.direct_failed', {
      requestId: req.requestId,
      movieId: req.params.id,
      error
    });
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
