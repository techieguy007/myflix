const express = require('express');
const fs = require('fs');
const db = require('../database/init');
const { optionalAuth, authenticateToken, requireAdmin } = require('../middleware/auth');
const { loadConfig } = require('../lib/config');
const { getScanState, runLibraryScan } = require('../lib/libraryScanner');
const logger = require('../lib/logger');
const {
  PREPARED_CACHE_VERSION,
  getBackgroundConversionQueueState,
  queueBackgroundConversionsForLibrary,
  queueBackgroundConversionsForMovieIds,
  setBackgroundConversionPaused,
  startBackgroundConversionQueue
} = require('../lib/transcoder');

const router = express.Router();

async function queuePreparedMediaAfterScan(trigger) {
  const config = loadConfig();
  if (!config.transcoding.prepareOnStartup) {
    logger.info('background_conversion.manual_queue_disabled', { trigger });
    return;
  }

  const result = await queueBackgroundConversionsForLibrary({
    reason: trigger,
    maxJobs: Number(config.transcoding.preparedMaxStartupJobs || 0)
  });
  await startBackgroundConversionQueue(trigger);
  logger.info('background_conversion.manual_queued', {
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
        episodeCount: 0,
        ratedCounts: new Map()
      });
    }

    const series = seriesMap.get(seriesTitle);
    const rated = String(episode.rated || '').trim();
    if (rated && rated.toUpperCase() !== 'N/A') {
      series.ratedCounts.set(rated, (series.ratedCounts.get(rated) || 0) + 1);
    }
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
    .map((series) => {
      const rated = Array.from(series.ratedCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;

      return {
        title: series.title,
        rated,
        episodeCount: series.episodeCount,
        seasons: Array.from(series.seasons.values())
          .map((season) => ({
            ...season,
            episodes: season.episodes.sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
          }))
          .sort((a, b) => a.seasonNumber - b.seasonNumber)
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function isAvailableForBrowse(row) {
  const latestJobStatus = String(row._conversion_job_status || '').toLowerCase();
  const latestJobReason = String(row._conversion_job_reason || '').toLowerCase();
  const hasAvailableConversion = Number(row._has_available_conversion || 0) > 0;
  const videoPath = String(row._video_path || '');
  const conversionOutputPath = String(row._conversion_job_output_path || '');

  if (!videoPath || !fs.existsSync(videoPath)) return false;

  if (hasAvailableConversion) return true;
  if (latestJobStatus === 'completed' && conversionOutputPath && fs.existsSync(conversionOutputPath)) return true;
  if (latestJobStatus === 'skipped' && latestJobReason.includes('already device-safe')) return true;
  if (['queued', 'running', 'failed'].includes(latestJobStatus)) return false;

  return false;
}

function publicLibraryRow(row) {
  const {
    _video_path,
    _format,
    _conversion_job_status,
    _conversion_job_reason,
    _conversion_job_output_path,
    _has_available_conversion,
    ...publicRow
  } = row;
  return publicRow;
}

async function ensureConversionLogSchema() {
  try {
    await db.run('ALTER TABLE media_conversions ADD COLUMN admin_hidden_at DATETIME');
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column name')) {
      throw error;
    }
  }
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const rows = await db.all(`
      WITH latest_conversion_jobs AS (
        SELECT job.*
        FROM background_conversion_jobs job
        INNER JOIN (
          SELECT movie_id, COALESCE(source_path, '') AS source_path, MAX(id) AS id
          FROM background_conversion_jobs
          GROUP BY movie_id, COALESCE(source_path, '')
        ) latest ON latest.id = job.id
      ),
      conversion_flags AS (
        SELECT
          movie_id,
          CASE
            WHEN status IN ('promoted', 'deleted') THEN COALESCE(replacement_path, '')
            WHEN status = 'prepared-kept' THEN COALESCE(source_path, '')
            ELSE ''
          END AS current_path,
          MAX(CASE
            WHEN status IN ('promoted', 'deleted')
              AND COALESCE(replacement_path, '') <> ''
              AND COALESCE(prepared_path, '') LIKE '%${PREPARED_CACHE_VERSION}%'
              THEN 1
            WHEN status = 'prepared-kept'
              AND COALESCE(prepared_path, '') <> ''
              AND COALESCE(prepared_path, '') LIKE '%${PREPARED_CACHE_VERSION}%'
              THEN 1
            ELSE 0
          END) AS has_available_conversion
        FROM media_conversions
        GROUP BY movie_id,
          CASE
            WHEN status IN ('promoted', 'deleted') THEN COALESCE(replacement_path, '')
            WHEN status = 'prepared-kept' THEN COALESCE(source_path, '')
            ELSE ''
          END
      )
      SELECT m.id, m.title, m.description, m.genre, m.release_year, m.duration, m.rating, m.director, m."cast",
             m.thumbnail, m.created_at, m.poster_url, m.imdb_id, m.imdb_rating, m.plot, m.runtime, m.rated,
             m.country, m.language, m.awards, m.omdb_updated, m.media_type, m.series_title, m.season_number,
             m.episode_number, m.episode_title, m.suggested_path, m.last_scanned_at,
             m.video_path AS _video_path, m.format AS _format,
             latest_conversion_jobs.status AS _conversion_job_status,
             latest_conversion_jobs.reason AS _conversion_job_reason,
             latest_conversion_jobs.output_path AS _conversion_job_output_path,
             COALESCE(conversion_flags.has_available_conversion, 0) AS _has_available_conversion
      FROM movies m
      LEFT JOIN latest_conversion_jobs
        ON latest_conversion_jobs.movie_id = m.id
       AND COALESCE(latest_conversion_jobs.source_path, '') = COALESCE(m.video_path, '')
      LEFT JOIN conversion_flags
        ON conversion_flags.movie_id = m.id
       AND COALESCE(conversion_flags.current_path, '') = COALESCE(m.video_path, '')
      ORDER BY COALESCE(m.series_title, m.title), m.season_number, m.episode_number, m.title
    `);

    const availableRows = rows.filter(isAvailableForBrowse).map(publicLibraryRow);
    const hiddenRows = rows.filter((row) => !isAvailableForBrowse(row));
    const movies = availableRows.filter((row) => (row.media_type || 'movie') !== 'episode');
    const episodes = availableRows.filter((row) => row.media_type === 'episode');
    const seriesCount = new Set(episodes.map((episode) => episode.series_title || 'Unknown Series')).size;
    const indexedEpisodes = rows.filter((row) => row.media_type === 'episode');
    const indexedMovies = rows.filter((row) => (row.media_type || 'movie') !== 'episode');
    logger.info('library.fetch_complete', {
      requestId: req.requestId,
      movies: movies.length,
      series: seriesCount,
      episodes: episodes.length,
      available: availableRows.length,
      hidden: hiddenRows.length,
      indexedTotal: rows.length,
      scanRunning: getScanState().running
    });

    res.json({
      movies,
      series: groupEpisodes(episodes),
      counts: {
        movies: movies.length,
        series: seriesCount,
        episodes: episodes.length,
        total: availableRows.length,
        indexedMovies: indexedMovies.length,
        indexedSeries: new Set(indexedEpisodes.map((episode) => episode.series_title || 'Unknown Series')).size,
        indexedEpisodes: indexedEpisodes.length,
        indexedTotal: rows.length,
        hidden: hiddenRows.length,
        hiddenMovies: hiddenRows.filter((row) => (row.media_type || 'movie') !== 'episode').length,
        hiddenEpisodes: hiddenRows.filter((row) => row.media_type === 'episode').length
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
    await ensureConversionLogSchema();
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const rows = await db.all(`
      SELECT
        c.id, c.movie_id, c.title, c.source_path, c.replacement_path, c.prepared_path,
        c.status, c.reason, c.source_size, c.replacement_size, c.audio_tracks,
        c.subtitle_tracks, c.video_codec, c.audio_codec, c.created_at, c.updated_at,
        m.video_path AS current_video_path
      FROM media_conversions c
      LEFT JOIN movies m ON m.id = c.movie_id
      WHERE c.admin_hidden_at IS NULL
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ?
    `, [limit]);
    const summaryRows = await db.all(`
      SELECT status, COUNT(*) AS count
      FROM media_conversions
      WHERE admin_hidden_at IS NULL
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
      WHERE admin_hidden_at IS NULL
    `);
    const archived = await db.get(`
      SELECT COUNT(*) AS total
      FROM media_conversions
      WHERE admin_hidden_at IS NOT NULL
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
      totals,
      archived: archived?.total || 0
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

router.delete('/conversions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureConversionLogSchema();
    const result = await db.run(`
      UPDATE media_conversions
      SET admin_hidden_at = CURRENT_TIMESTAMP,
          updated_at = updated_at
      WHERE admin_hidden_at IS NULL
    `);

    logger.info('library.conversions_cleared', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      hidden: result.changes || 0
    });

    res.json({
      hidden: result.changes || 0,
      message: 'Conversion log cleared'
    });
  } catch (error) {
    logger.error('library.conversions_clear_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    res.status(500).json({ error: 'Failed to clear conversion history' });
  }
});

router.get('/conversion-queue', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const state = await getBackgroundConversionQueueState();
    logger.info('library.conversion_queue_requested', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      queued: state.counts.queued,
      running: state.counts.running,
      paused: state.paused
    });
    res.json(state);
  } catch (error) {
    logger.error('library.conversion_queue_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    res.status(500).json({ error: 'Failed to fetch conversion queue' });
  }
});

router.post('/conversion-queue/selected', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await queueBackgroundConversionsForMovieIds(req.body?.movieIds || [], {
      encoderPreference: req.body?.encoderPreference || 'auto',
      force: req.body?.force === true,
      reason: 'manual-selected'
    });
    const state = await startBackgroundConversionQueue('manual-selected');
    res.json({ result, queue: state });
  } catch (error) {
    logger.error('library.conversion_queue_selected_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    res.status(500).json({ error: error.message || 'Failed to queue selected conversions' });
  }
});

router.post('/conversion-queue/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await queueBackgroundConversionsForLibrary({
      encoderPreference: req.body?.encoderPreference || 'auto',
      force: req.body?.force === true,
      reason: 'manual-all'
    });
    const state = await startBackgroundConversionQueue('manual-all');
    res.json({ result, queue: state });
  } catch (error) {
    logger.error('library.conversion_queue_all_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    res.status(500).json({ error: error.message || 'Failed to queue library conversions' });
  }
});

router.post('/conversion-queue/pause', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json(await setBackgroundConversionPaused(true));
  } catch (error) {
    logger.error('library.conversion_queue_pause_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    res.status(500).json({ error: error.message || 'Failed to pause conversion queue' });
  }
});

router.post('/conversion-queue/resume', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await setBackgroundConversionPaused(false);
    res.json(await startBackgroundConversionQueue('manual-resume'));
  } catch (error) {
    logger.error('library.conversion_queue_resume_failed', {
      requestId: req.requestId,
      userId: req.user && (req.user.userId || req.user.id),
      error
    });
    res.status(500).json({ error: error.message || 'Failed to resume conversion queue' });
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
