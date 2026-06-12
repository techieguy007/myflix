const express = require('express');
const db = require('../database/init');
const { optionalAuth, authenticateToken, requireAdmin } = require('../middleware/auth');
const { loadConfig } = require('../lib/config');
const { getScanState, runLibraryScan } = require('../lib/libraryScanner');
const logger = require('../lib/logger');
const { queuePreparedMediaForLibrary } = require('../lib/transcoder');

const router = express.Router();

async function queuePreparedMediaAfterScan(trigger) {
  const config = loadConfig();
  if (!config.transcoding.prepareOnStartup) {
    logger.info('prepared.manual_queue_disabled', { trigger });
    return;
  }

  const movies = await db.all(`
    SELECT id, title, video_path
    FROM movies
    WHERE video_path IS NOT NULL
    ORDER BY title
  `);
  const result = await queuePreparedMediaForLibrary(movies, {
    reason: trigger,
    maxJobs: Number(config.transcoding.preparedMaxStartupJobs || 0)
  });
  logger.info('prepared.manual_queued', {
    trigger,
    ...result
  });
}

function groupEpisodes(episodes) {
  const seriesMap = new Map();
  episodes.forEach((episode) => {
    const seriesTitle = episode.series_title || 'Unknown Series';
    if (!seriesMap.has(seriesTitle)) {
      seriesMap.set(seriesTitle, {
        title: seriesTitle,
        seasons: new Map(),
        episodeCount: 0
      });
    }

    const series = seriesMap.get(seriesTitle);
    const seasonNumber = episode.season_number || 1;
    if (!series.seasons.has(seasonNumber)) {
      series.seasons.set(seasonNumber, {
        seasonNumber,
        episodes: []
      });
    }

    series.seasons.get(seasonNumber).episodes.push(episode);
    series.episodeCount += 1;
  });

  return Array.from(seriesMap.values())
    .map((series) => ({
      ...series,
      seasons: Array.from(series.seasons.values())
        .map((season) => ({
          ...season,
          episodes: season.episodes.sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
        }))
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT id, title, description, genre, release_year, duration, rating, director, "cast",
             thumbnail, created_at, poster_url, imdb_id, imdb_rating, plot, runtime, rated,
             country, language, awards, omdb_updated, media_type, series_title, season_number,
             episode_number, episode_title, suggested_path, last_scanned_at
      FROM movies
      ORDER BY COALESCE(series_title, title), season_number, episode_number, title
    `);

    const movies = rows.filter((row) => (row.media_type || 'movie') !== 'episode');
    const episodes = rows.filter((row) => row.media_type === 'episode');
    const seriesCount = new Set(episodes.map((episode) => episode.series_title || 'Unknown Series')).size;
    logger.info('library.fetch_complete', {
      requestId: req.requestId,
      movies: movies.length,
      series: seriesCount,
      episodes: episodes.length,
      total: rows.length,
      scanRunning: getScanState().running
    });

    res.json({
      movies,
      series: groupEpisodes(episodes),
      counts: {
        movies: movies.length,
        series: seriesCount,
        episodes: episodes.length,
        total: rows.length
      },
      scan: getScanState()
    });
  } catch (error) {
    logger.error('library.fetch_failed', {
      requestId: req.requestId,
      error
    });
    console.error('Library fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

router.get('/scan/status', authenticateToken, requireAdmin, (req, res) => {
  logger.info('library.scan_status_requested', {
    requestId: req.requestId,
    userId: req.user && (req.user.userId || req.user.id),
    running: getScanState().running
  });
  res.json(getScanState());
});

router.get('/conversions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const rows = await db.all(`
      SELECT
        c.id, c.movie_id, c.title, c.source_path, c.replacement_path, c.prepared_path,
        c.status, c.reason, c.source_size, c.replacement_size, c.audio_tracks,
        c.subtitle_tracks, c.video_codec, c.audio_codec, c.created_at, c.updated_at,
        m.video_path AS current_video_path
      FROM media_conversions c
      LEFT JOIN movies m ON m.id = c.movie_id
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ?
    `, [limit]);
    const summaryRows = await db.all(`
      SELECT status, COUNT(*) AS count
      FROM media_conversions
      GROUP BY status
    `);
    const summary = summaryRows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
    const totals = await db.get(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END), 0) AS originalsDeleted,
        COALESCE(SUM(CASE WHEN status = 'prepared-kept' THEN 1 ELSE 0 END), 0) AS originalsKept,
        COALESCE(SUM(CASE WHEN replacement_path IS NOT NULL THEN replacement_size ELSE 0 END), 0) AS convertedBytes
      FROM media_conversions
    `);

    logger.info('library.conversions_requested', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      limit,
      returned: rows.length
    });
    res.json({
      conversions: rows,
      summary,
      totals
    });
  } catch (error) {
    logger.error('library.conversions_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    res.status(500).json({ error: 'Failed to fetch conversion history' });
  }
});

router.post('/scan/rebuild', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const forceRescan = req.body?.force === true || req.query.force === 'true';
    logger.info('library.manual_scan_requested', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      forceRescan
    });
    const result = await runLibraryScan({
      trigger: forceRescan ? 'manual-force' : 'manual',
      forceRescan
    });
    logger.info('library.manual_scan_complete', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      forceRescan,
      result
    });
    queuePreparedMediaAfterScan(forceRescan ? 'manual-force' : 'manual')
      .catch((error) => {
        logger.error('prepared.manual_queue_failed', {
          requestId: req.requestId,
          userId: req.user && (req.user.userId || req.user.id),
          error
        });
      });
    res.json(result);
  } catch (error) {
    logger.error('library.manual_scan_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    console.error('Library scan error:', error);
    res.status(500).json({ error: error.message || 'Library scan failed' });
  }
});

module.exports = router;
