const express = require('express');
const fs = require('fs');
const db = require('../database/init');
const logger = require('../lib/logger');
const { authenticateToken } = require('../middleware/auth');
const {
  downloadSubtitleForMovie,
  searchSubtitlesForMovie
} = require('../lib/opensubtitles');

const router = express.Router();

async function getSubtitleMovie(movieId) {
  const movie = await db.get(`
    SELECT id, title, video_path, file_size, imdb_id, release_year, media_type,
           series_title, season_number, episode_number, episode_title
    FROM movies
    WHERE id = ?
  `, [movieId]);

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

router.get('/:id/search', authenticateToken, async (req, res) => {
  try {
    const movie = await getSubtitleMovie(req.params.id);
    const result = await searchSubtitlesForMovie(movie, {
      languages: req.query.languages,
      query: req.query.query
    });

    logger.info('subtitles.search_response', {
      requestId: req.requestId,
      movieId: movie.id,
      title: movie.title,
      languages: result.languages,
      resultCount: result.results.length,
      usedPlans: result.usedPlans
    });

    res.json({
      movieId: movie.id,
      title: movie.title,
      ...result
    });
  } catch (error) {
    logger.error('subtitles.search_failed', {
      requestId: req.requestId,
      movieId: req.params.id,
      error
    });
    res.status(error.statusCode || 500).json({
      error: error.message || 'Subtitle search failed',
      details: error.details || undefined
    });
  }
});

router.post('/:id/download', authenticateToken, async (req, res) => {
  try {
    const movie = await getSubtitleMovie(req.params.id);
    const subtitle = await downloadSubtitleForMovie(movie, {
      fileId: req.body.fileId,
      language: req.body.language,
      fileName: req.body.fileName
    });

    logger.info('subtitles.download_response', {
      requestId: req.requestId,
      movieId: movie.id,
      title: movie.title,
      fileId: subtitle.fileId,
      language: subtitle.language,
      fileName: subtitle.fileName,
      bytes: subtitle.bytes
    });

    res.json({
      movieId: movie.id,
      title: movie.title,
      subtitle: {
        fileId: subtitle.fileId,
        language: subtitle.language,
        fileName: subtitle.fileName,
        bytes: subtitle.bytes,
        requests: subtitle.requests,
        remaining: subtitle.remaining
      }
    });
  } catch (error) {
    logger.error('subtitles.download_failed', {
      requestId: req.requestId,
      movieId: req.params.id,
      fileId: req.body?.fileId || null,
      error
    });
    res.status(error.statusCode || 500).json({
      error: error.message || 'Subtitle download failed',
      details: error.details || undefined
    });
  }
});

module.exports = router;
