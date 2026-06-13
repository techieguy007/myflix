const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const db = require('../database/init');
const { loadConfig } = require('./config');
const logger = require('./logger');

const TRANSCODE_ROOT = path.join(__dirname, '..', 'transcodes');
const HLS_CACHE_VERSION = 'hls-event-v2';
const PREPARED_CACHE_VERSION = 'prepared-mp4-v3';
const MOBILE_SAFE_MAX_WIDTH = 1920;
const MOBILE_SAFE_MAX_HEIGHT = 1080;
const MOBILE_SAFE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_FFMPEG_THREADS = Number(process.env.MYFLIX_FFMPEG_THREADS || 2);
const DEFAULT_FFMPEG_PRESET = process.env.MYFLIX_FFMPEG_PRESET || 'ultrafast';
const DEFAULT_FFMPEG_REALTIME = process.env.MYFLIX_FFMPEG_REALTIME !== 'false';
const PREPARED_CONCURRENCY = Math.max(1, Number(process.env.MYFLIX_PREPARED_CONCURRENCY || 1));
const runningJobs = new Map();
const preparedQueue = [];
const queuedPreparedJobs = new Set();
let activePreparedJobs = 0;
let childSequence = 0;
let ffmpegCapabilitiesCache = null;
let ffmpegCapabilitiesCacheAt = 0;
let backgroundWorkerActive = false;

function commandPath(name, envName) {
  if (process.env[envName]) {
    return process.env[envName];
  }

  const config = loadConfig();
  if (name === 'ffmpeg' && config.transcoding.ffmpegPath) {
    return config.transcoding.ffmpegPath;
  }
  if (name === 'ffprobe' && config.transcoding.ffprobePath) {
    return config.transcoding.ffprobePath;
  }

  if (process.platform === 'win32') {
    const chocolateyBinary = path.join(
      'C:\\ProgramData\\chocolatey\\lib\\ffmpeg\\tools\\ffmpeg\\bin',
      `${name}.exe`
    );
    if (fs.existsSync(chocolateyBinary)) {
      return chocolateyBinary;
    }
  }

  return name;
}

function ensureBackgroundConversionSchema() {
  return Promise.all([
    db.run(`
      CREATE TABLE IF NOT EXISTS background_conversion_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL,
        title TEXT,
        source_path TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        encoder_preference TEXT DEFAULT 'auto',
        encoder_used TEXT,
        audio_stream_index INTEGER,
        reason TEXT,
        error TEXT,
        progress_percent REAL DEFAULT 0,
        progress_time_seconds REAL DEFAULT 0,
        fps TEXT,
        speed TEXT,
        output_path TEXT,
        attempts INTEGER DEFAULT 0,
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (movie_id) REFERENCES movies (id)
      )
    `),
    db.run(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  ]).then(async () => {
    try {
      await db.run('ALTER TABLE background_conversion_jobs ADD COLUMN audio_stream_index INTEGER');
    } catch (error) {
      if (!String(error.message || '').includes('duplicate column name')) {
        throw error;
      }
    }
  });
}

async function getAppSetting(key, defaultValue = null) {
  await ensureBackgroundConversionSchema();
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : defaultValue;
}

async function setAppSetting(key, value) {
  await ensureBackgroundConversionSchema();
  await db.run(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `, [key, String(value)]);
}

function normalizedThreadCount() {
  return Number.isFinite(DEFAULT_FFMPEG_THREADS) && DEFAULT_FFMPEG_THREADS > 0
    ? Math.max(1, Math.floor(DEFAULT_FFMPEG_THREADS))
    : 2;
}

function encoderPreference(value) {
  return ['auto', 'gpu', 'cpu'].includes(String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : 'auto';
}

function ffmpegEncoders() {
  return new Promise((resolve) => {
    execFile(
      commandPath('ffmpeg', 'FFMPEG_PATH'),
      ['-hide_banner', '-encoders'],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          logger.warn('ffmpeg.capabilities_failed', { error });
          resolve({ error: error.message, text: `${stdout || ''}\n${stderr || ''}` });
          return;
        }
        resolve({ text: `${stdout || ''}\n${stderr || ''}` });
      }
    );
  });
}

async function getFfmpegCapabilities(force = false) {
  const now = Date.now();
  if (!force && ffmpegCapabilitiesCache && now - ffmpegCapabilitiesCacheAt < 5 * 60 * 1000) {
    return ffmpegCapabilitiesCache;
  }

  const result = await ffmpegEncoders();
  const text = result.text || '';
  ffmpegCapabilitiesCache = {
    ffmpegPath: commandPath('ffmpeg', 'FFMPEG_PATH'),
    h264Nvenc: /\bh264_nvenc\b/.test(text),
    hevcNvenc: /\bhevc_nvenc\b/.test(text),
    libx264: /\blibx264\b/.test(text),
    error: result.error || null
  };
  ffmpegCapabilitiesCacheAt = now;
  logger.info('ffmpeg.capabilities_checked', ffmpegCapabilitiesCache);
  return ffmpegCapabilitiesCache;
}

async function choosePreparedVideoEncoder(videoCodec, preference, options = {}) {
  if (!options.forceVideoTranscode && videoCopyIsSafe(videoCodec)) {
    return {
      encoder: 'copy',
      videoAction: 'copy',
      hardware: false,
      reason: 'source-h264'
    };
  }

  const normalizedPreference = encoderPreference(preference);
  const capabilities = await getFfmpegCapabilities();
  if (options.strictDeviceCompatibility) {
    return {
      encoder: 'libx264',
      videoAction: 'transcode-cpu-strict-mobile',
      hardware: false,
      reason: capabilities.libx264 ? 'strict-mobile-libx264' : 'strict-mobile-libx264-required'
    };
  }

  const wantsGpu = normalizedPreference === 'gpu' || normalizedPreference === 'auto';

  if (wantsGpu && capabilities.h264Nvenc) {
    return {
      encoder: 'h264_nvenc',
      videoAction: 'transcode-gpu',
      hardware: true,
      reason: 'h264-nvenc-available'
    };
  }

  return {
    encoder: 'libx264',
    videoAction: normalizedPreference === 'gpu' ? 'transcode-cpu-gpu-unavailable' : 'transcode-cpu',
    hardware: false,
    reason: capabilities.h264Nvenc ? 'cpu-selected' : 'gpu-unavailable'
  };
}

function trackChildProcess(key, child) {
  runningJobs.set(key, child);
  logger.info('transcode.child_tracked', {
    key,
    pid: child.pid,
    runningJobs: runningJobs.size
  });

  const remove = () => {
    if (runningJobs.get(key) === child) {
      runningJobs.delete(key);
      logger.info('transcode.child_untracked', {
        key,
        pid: child.pid,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        runningJobs: runningJobs.size
      });
    }
  };

  child.once('error', remove);
  child.once('close', remove);
  child.once('exit', remove);
  return child;
}

function stopChildProcess(child) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    logger.warn('transcode.child_stop_requested', { pid: child.pid });
    if (process.platform === 'win32' && child.pid) {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error) {
          logger.warn('transcode.child_taskkill_failed', {
            pid: child.pid,
            error
          });
        }
      });
      return;
    }
    child.kill('SIGTERM');
  } catch (_error) {
    // Best effort: process may have already exited.
  }
}

function audioJobPrefix(movie, options = {}) {
  const audio = Number.isInteger(options.audioStreamIndex) ? options.audioStreamIndex : 'auto';
  return `${movie.id}:${sourceSignature(movie.video_path)}:${HLS_CACHE_VERSION}:audio-${audio}`;
}

function matchesAudioJob(key, prefix) {
  return key === prefix || key.startsWith(`${prefix}-start-`);
}

function stopSupersededHlsJobs(movie, options, activeJobKey) {
  const prefix = audioJobPrefix(movie, options);
  for (const [key, child] of runningJobs.entries()) {
    if (key !== activeJobKey && matchesAudioJob(key, prefix)) {
      runningJobs.delete(key);
      logger.warn('transcode.hls_superseded_job_stop', {
        key,
        activeJobKey,
        pid: child.pid
      });
      stopChildProcess(child);
    }
  }
}

function stopJobsForMovieSource(movie, reason) {
  const prefix = `${movie.id}:${sourceSignature(movie.video_path)}:`;
  let stopped = 0;
  for (const [key, child] of runningJobs.entries()) {
    if (key.startsWith(prefix)) {
      runningJobs.delete(key);
      stopped += 1;
      logger.warn('transcode.movie_source_job_stop', {
        key,
        reason,
        pid: child.pid,
        movieId: movie.id,
        title: movie.title
      });
      stopChildProcess(child);
    }
  }
  return stopped;
}

function stopAllTranscodeJobs() {
  const jobs = Array.from(runningJobs.values());
  runningJobs.clear();
  logger.warn('transcode.stop_all_requested', { count: jobs.length });
  jobs.forEach(stopChildProcess);
  return jobs.length;
}

function sourceSignature(filePath) {
  const stat = fs.statSync(filePath);
  return crypto
    .createHash('sha1')
    .update(`${filePath}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
}

function normalizedPathKey(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function isWithinDirectory(filePath, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function replacementPathForSource(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const targetName = ext === '.mp4' ? `${base}.h264.mp4` : `${base}.mp4`;
  const targetPath = path.join(dir, targetName);

  if (normalizedPathKey(targetPath) === normalizedPathKey(sourcePath) || fs.existsSync(targetPath)) {
    return null;
  }

  return targetPath;
}

function deletionEligibility(config, tracks) {
  if (!config.transcoding.deleteOriginalAfterPrepare) {
    return { allowed: false, reason: 'disabled' };
  }

  if (tracks.audioTracks.length > 1 && !config.transcoding.deleteOriginalWithMultipleAudio) {
    return { allowed: false, reason: 'multiple-audio-tracks' };
  }

  const extractableSubtitles = tracks.subtitleTracks.filter((track) => track.extractable);
  if (extractableSubtitles.length > 0 && !config.transcoding.deleteOriginalWithEmbeddedSubtitles) {
    return { allowed: false, reason: 'embedded-text-subtitles' };
  }

  return { allowed: true, reason: 'eligible' };
}

function conversionStatsFromProbe(probe) {
  const tracks = tracksFromProbe(probe);
  const codecs = codecsFromProbe(probe);
  return {
    audioTracks: tracks.audioTracks.length,
    subtitleTracks: tracks.subtitleTracks.length,
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec
  };
}

async function recordConversion(movie, details = {}) {
  try {
    const sourcePath = details.sourcePath || movie.video_path || null;
    const preparedPath = details.preparedPath || null;
    const replacementPath = details.replacementPath || null;
    const existing = await db.get(`
      SELECT id
      FROM media_conversions
      WHERE movie_id = ?
        AND COALESCE(source_path, '') = COALESCE(?, '')
        AND COALESCE(prepared_path, '') = COALESCE(?, '')
        AND COALESCE(replacement_path, '') = COALESCE(?, '')
      ORDER BY id DESC
      LIMIT 1
    `, [movie.id, sourcePath, preparedPath, replacementPath]);

    const params = [
      movie.id,
      movie.title,
      sourcePath,
      replacementPath,
      preparedPath,
      details.status,
      details.reason || null,
      details.sourceSize || null,
      details.replacementSize || null,
      details.audioTracks || 0,
      details.subtitleTracks || 0,
      details.videoCodec || null,
      details.audioCodec || null
    ];

    if (existing) {
      await db.run(`
        UPDATE media_conversions SET
          movie_id = ?, title = ?, source_path = ?, replacement_path = ?, prepared_path = ?,
          status = ?, reason = ?, source_size = ?, replacement_size = ?,
          audio_tracks = ?, subtitle_tracks = ?, video_codec = ?, audio_codec = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [...params, existing.id]);
      return existing.id;
    }

    const result = await db.run(`
      INSERT INTO media_conversions (
        movie_id, title, source_path, replacement_path, prepared_path, status, reason,
        source_size, replacement_size, audio_tracks, subtitle_tracks, video_codec, audio_codec
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, params);
    return result.id;
  } catch (error) {
    logger.error('prepared.conversion_record_failed', {
      movieId: movie.id,
      title: movie.title,
      status: details.status,
      error
    });
    return null;
  }
}

async function updateConversionRecord(conversionId, fields = {}) {
  if (!conversionId) {
    return;
  }

  try {
    await db.run(`
      UPDATE media_conversions SET
        status = COALESCE(?, status),
        reason = COALESCE(?, reason),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [fields.status || null, fields.reason || null, conversionId]);
  } catch (error) {
    logger.error('prepared.conversion_record_update_failed', {
      conversionId,
      fields,
      error
    });
  }
}

function scheduleOriginalDelete(sourcePath, context) {
  const maxAttempts = 8;
  const retryDelayMs = 10000;
  let attempt = 0;

  const tryDelete = () => {
    attempt += 1;
    try {
      if (!fs.existsSync(sourcePath)) {
        logger.info('prepared.original_already_removed', { ...context, sourcePath });
        updateConversionRecord(context.conversionId, {
          status: 'deleted',
          reason: 'already-removed'
        });
        return;
      }

      fs.unlinkSync(sourcePath);
      updateConversionRecord(context.conversionId, {
        status: 'deleted',
        reason: 'original-deleted'
      });
      logger.info('prepared.original_deleted', {
        ...context,
        sourcePath,
        attempt
      });
    } catch (error) {
      if (attempt >= maxAttempts) {
        logger.error('prepared.original_delete_failed', {
          ...context,
          sourcePath,
          attempts: attempt,
          error
        });
        updateConversionRecord(context.conversionId, {
          status: 'delete-failed',
          reason: error.message || 'delete-failed'
        });
        return;
      }

      logger.warn('prepared.original_delete_retry', {
        ...context,
        sourcePath,
        attempt,
        retryDelayMs,
        error
      });
      setTimeout(tryDelete, retryDelayMs).unref();
    }
  };

  tryDelete();
}

function safeSubtitleToken(value, fallback) {
  const token = normalizedTrackText(value).replace(/\s+/g, '-');
  return token || fallback;
}

function sidecarSubtitlePathFor(replacementPath, track, sequence) {
  const dir = path.dirname(replacementPath);
  const ext = path.extname(replacementPath);
  const base = path.basename(replacementPath, ext);
  const language = safeSubtitleToken(track.language, 'und');
  const forced = track.forced ? '.forced' : '';
  return path.join(dir, `${base}.${language}${forced}.${sequence + 1}.vtt`);
}

function externalSubtitleTracks(videoPath) {
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  let entries = [];

  try {
    entries = fs.readdirSync(dir);
  } catch (_error) {
    return [];
  }

  return entries
    .filter((entry) => entry.toLowerCase().startsWith(`${base.toLowerCase()}.`)
      && entry.toLowerCase().endsWith('.vtt'))
    .sort((a, b) => a.localeCompare(b))
    .map((entry, index) => {
      const stem = entry.slice(base.length + 1, -4);
      const parts = stem.split('.').filter(Boolean);
      const forced = parts.includes('forced');
      const language = parts.find((part) => part !== 'forced' && !/^\d+$/.test(part)) || 'und';
      return {
        index,
        streamIndex: -1000 - index,
        codec: 'webvtt',
        language,
        title: forced ? 'Forced' : '',
        default: false,
        forced,
        extractable: true,
        external: true,
        provider: entry.toLowerCase().includes('.opensubtitles-') ? 'opensubtitles' : 'sidecar',
        fileName: entry,
        path: path.join(dir, entry),
        label: `${language.toUpperCase()} - WebVTT${forced ? ' - Forced' : ''}`
      };
    });
}

function extractSubtitleTrack(sourcePath, outputPath, streamIndex) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      commandPath('ffmpeg', 'FFMPEG_PATH'),
      [
        '-hide_banner',
        '-y',
        '-i', sourcePath,
        '-map', `0:${streamIndex}`,
        '-f', 'webvtt',
        outputPath
      ],
      { windowsHide: true },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
          fs.rmSync(outputPath, { force: true });
          resolve(null);
          return;
        }
        resolve(outputPath);
      }
    );
    trackChildProcess(`subtitle-sidecar:${streamIndex}:${++childSequence}`, child);
  });
}

async function extractSubtitleSidecars(sourcePath, replacementPath, subtitleTracks, context = {}) {
  const extractable = (subtitleTracks || []).filter((track) => track.extractable);
  const extracted = [];
  const failed = [];

  for (const [index, track] of extractable.entries()) {
    const outputPath = sidecarSubtitlePathFor(replacementPath, track, index);
    try {
      const extractedPath = await extractSubtitleTrack(sourcePath, outputPath, track.streamIndex);
      if (!extractedPath) {
        logger.info('prepared.subtitle_sidecar_empty', {
          ...context,
          streamIndex: track.streamIndex,
          language: track.language,
          forced: track.forced,
          outputPath
        });
        continue;
      }
      extracted.push(extractedPath);
      logger.info('prepared.subtitle_sidecar_extracted', {
        ...context,
        streamIndex: track.streamIndex,
        language: track.language,
        forced: track.forced,
        outputPath: extractedPath
      });
    } catch (error) {
      failed.push({ streamIndex: track.streamIndex, error: error.message });
      logger.warn('prepared.subtitle_sidecar_failed', {
        ...context,
        streamIndex: track.streamIndex,
        language: track.language,
        outputPath,
        error
      });
    }
  }

  return { extracted, failed };
}

async function cleanupPendingPromotedOriginals() {
  const rows = await db.all(`
    SELECT id, movie_id, title, source_path, replacement_path, status
    FROM media_conversions
    WHERE status IN ('promoted', 'delete-failed')
      AND source_path IS NOT NULL
      AND replacement_path IS NOT NULL
    ORDER BY updated_at ASC
  `);
  let scheduled = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!fs.existsSync(row.replacement_path)) {
      skipped += 1;
      logger.warn('prepared.pending_delete_skipped', {
        conversionId: row.id,
        movieId: row.movie_id,
        title: row.title,
        sourcePath: row.source_path,
        replacementPath: row.replacement_path,
        reason: 'replacement-missing'
      });
      continue;
    }

    scheduleOriginalDelete(row.source_path, {
      conversionId: row.id,
      movieId: row.movie_id,
      title: row.title,
      replacementPath: row.replacement_path
    });
    scheduled += 1;
  }

  logger.info('prepared.pending_delete_cleanup_complete', {
    scheduled,
    skipped
  });
  return { scheduled, skipped };
}

async function promotePreparedMedia(movie, preparedPath, probe) {
  const config = loadConfig();
  const tracks = tracksFromProbe(probe);
  const conversionStats = conversionStatsFromProbe(probe);
  const sourcePath = movie.video_path;
  const sourceSize = sourcePath && fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : null;
  const context = {
    movieId: movie.id,
    title: movie.title
  };

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    logger.warn('prepared.promote_skipped', {
      ...context,
      sourcePath,
      reason: 'source-missing'
    });
    return { promoted: false, reason: 'source-missing' };
  }

  if (isWithinDirectory(sourcePath, TRANSCODE_ROOT)) {
    logger.info('prepared.promote_skipped', {
      ...context,
      sourcePath,
      reason: 'source-is-cache'
    });
    return { promoted: false, reason: 'source-is-cache' };
  }

  const eligibility = deletionEligibility(config, tracks);
  if (!eligibility.allowed) {
    await recordConversion(movie, {
      ...conversionStats,
      sourcePath,
      preparedPath,
      status: 'prepared-kept',
      reason: eligibility.reason,
      sourceSize,
      replacementSize: fs.existsSync(preparedPath) ? fs.statSync(preparedPath).size : null
    });
    logger.info('prepared.promote_skipped', {
      ...context,
      sourcePath,
      reason: eligibility.reason
    });
    return { promoted: false, reason: eligibility.reason };
  }

  const replacementPath = replacementPathForSource(sourcePath);
  if (!replacementPath) {
    logger.warn('prepared.promote_skipped', {
      ...context,
      sourcePath,
      reason: 'replacement-exists'
    });
    return { promoted: false, reason: 'replacement-exists' };
  }

  const tempReplacementPath = `${replacementPath}.partial`;
  await fs.promises.rm(tempReplacementPath, { force: true });
  await fs.promises.copyFile(preparedPath, tempReplacementPath);
  const copiedStat = await fs.promises.stat(tempReplacementPath);
  if (!copiedStat.size) {
    await fs.promises.rm(tempReplacementPath, { force: true });
    logger.warn('prepared.promote_skipped', {
      ...context,
      sourcePath,
      replacementPath,
      reason: 'empty-replacement'
    });
    return { promoted: false, reason: 'empty-replacement' };
  }

  await fs.promises.rename(tempReplacementPath, replacementPath);
  const replacementStat = await fs.promises.stat(replacementPath);
  const update = await db.run(`
    UPDATE movies SET
      video_path = ?,
      file_size = ?,
      file_mtime_ms = ?,
      format = ?,
      original_path = COALESCE(original_path, ?),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND video_path = ?
  `, [
    replacementPath,
    replacementStat.size,
    replacementStat.mtimeMs,
    'mp4',
    sourcePath,
    movie.id,
    sourcePath
  ]);

  if (!update.changes) {
    await fs.promises.rm(replacementPath, { force: true });
    logger.warn('prepared.promote_skipped', {
      ...context,
      sourcePath,
      replacementPath,
      reason: 'database-row-changed'
    });
    return { promoted: false, reason: 'database-row-changed' };
  }

  logger.info('prepared.promoted_to_library', {
    ...context,
    sourcePath,
    replacementPath,
    replacementSize: replacementStat.size
  });
  const subtitleSidecars = await extractSubtitleSidecars(sourcePath, replacementPath, tracks.subtitleTracks, {
    ...context,
    replacementPath
  });
  const stoppedSourceJobs = stopJobsForMovieSource(movie, 'prepared-promoted');
  const conversionId = await recordConversion(movie, {
    ...conversionStats,
    sourcePath,
    replacementPath,
    preparedPath,
    status: 'promoted',
    reason: stoppedSourceJobs > 0
      ? 'replacement-created-source-jobs-stopped'
      : `replacement-created${subtitleSidecars.extracted.length ? '-subtitles-extracted' : ''}`,
    sourceSize,
    replacementSize: replacementStat.size
  });
  await fs.promises.rm(preparedPath, { force: true });
  logger.info('prepared.cache_removed_after_promote', {
    ...context,
    preparedPath,
    replacementPath
  });
  scheduleOriginalDelete(sourcePath, {
    ...context,
    conversionId,
    replacementPath
  });
  return { promoted: true, replacementPath };
}

function hlsDirectory(movieId, filePath) {
  return path.join(TRANSCODE_ROOT, String(movieId), sourceSignature(filePath), HLS_CACHE_VERSION);
}

function preparedDirectory(movieId, filePath) {
  return path.join(TRANSCODE_ROOT, String(movieId), sourceSignature(filePath), PREPARED_CACHE_VERSION);
}

function variantKey(options = {}) {
  const audio = Number.isInteger(options.audioStreamIndex) ? options.audioStreamIndex : 'auto';
  const startSeconds = normalizeStartSeconds(options.startSeconds);
  return startSeconds > 0 ? `audio-${audio}-start-${startSeconds}` : `audio-${audio}`;
}

function preparedVariantKey(options = {}) {
  const audio = Number.isInteger(options.audioStreamIndex) ? options.audioStreamIndex : 'auto';
  const compatibilitySuffix = options.strictDeviceCompatibility
    ? '-mobile'
    : options.forceVideoTranscode
      ? '-compat'
      : '';
  return `audio-${audio}${compatibilitySuffix}`;
}

function preparedVariantFile(options = {}) {
  return `${preparedVariantKey(options)}.mp4`;
}

function optionsFromPreparedVariant(fileName) {
  const match = String(fileName || '').match(/^audio-(auto|\d+)(-(compat|mobile))?\.mp4$/);
  if (!match) {
    return null;
  }

  const options = match[1] === 'auto' ? {} : { audioStreamIndex: Number(match[1]) };
  if (match[3] === 'compat') {
    options.forceVideoTranscode = true;
  } else if (match[3] === 'mobile') {
    options.forceVideoTranscode = true;
    options.strictDeviceCompatibility = true;
  }
  return options;
}

function normalizeStartSeconds(value) {
  const startSeconds = Number(value);
  return Number.isFinite(startSeconds) && startSeconds > 0 ? Math.floor(startSeconds) : 0;
}

function optionsFromVariant(variant) {
  const match = String(variant || '').match(/^audio-(auto|\d+)(?:-start-(\d+))?$/);
  if (!match) {
    return {};
  }

  const options = {};
  if (match[1] !== 'auto') {
    options.audioStreamIndex = Number(match[1]);
  }
  options.startSeconds = normalizeStartSeconds(match[2]);
  return options;
}

function hlsVariantDirectory(movieId, filePath, options = {}) {
  return path.join(hlsDirectory(movieId, filePath), variantKey(options));
}

function preparedMediaPath(movieId, filePath, options = {}) {
  return path.join(preparedDirectory(movieId, filePath), preparedVariantFile(options));
}

function preparedTempPath(movieId, filePath, options = {}) {
  return `${preparedMediaPath(movieId, filePath, options)}.partial`;
}

function manifestPath(movieId, filePath, options = {}) {
  return path.join(hlsVariantDirectory(movieId, filePath, options), 'index.m3u8');
}

function safeRmDir(dirPath) {
  const resolvedRoot = path.resolve(TRANSCODE_ROOT);
  const resolvedDir = path.resolve(dirPath);
  if (!resolvedDir.startsWith(resolvedRoot)) {
    throw new Error(`Refusing to clear path outside transcode cache: ${resolvedDir}`);
  }
  fs.rmSync(resolvedDir, { recursive: true, force: true });
}

function probeMedia(filePath) {
  return new Promise((resolve) => {
    execFile(
      commandPath('ffprobe', 'FFPROBE_PATH'),
      [
        '-v', 'error',
        '-show_streams',
        '-show_format',
        '-of', 'json',
        filePath
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          logger.warn('media.probe_failed', {
            filePath,
            error
          });
          resolve({ error: error.message, streams: [] });
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          logger.warn('media.probe_parse_failed', {
            filePath,
            error: parseError
          });
          resolve({ error: parseError.message, streams: [] });
        }
      }
    );
  });
}

function probeDurationSeconds(probe) {
  const formatDuration = Number(probe && probe.format && probe.format.duration);
  if (Number.isFinite(formatDuration) && formatDuration > 0) {
    return formatDuration;
  }

  const streams = Array.isArray(probe && probe.streams) ? probe.streams : [];
  const durations = streams
    .map((stream) => Number(stream.duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  return durations.length ? Math.max(...durations) : 0;
}

function parseTimestampSeconds(value) {
  const match = String(value || '').match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

function parseFfmpegProgress(text, durationSeconds) {
  const timeMatch = String(text || '').match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
  if (!timeMatch) return null;

  const timeSeconds = parseTimestampSeconds(timeMatch[1]);
  const percent = durationSeconds > 0
    ? Math.max(0, Math.min(99, (timeSeconds / durationSeconds) * 100))
    : 0;
  const fpsMatch = String(text || '').match(/fps=\s*([0-9.]+)/);
  const speedMatch = String(text || '').match(/speed=\s*([0-9.]+x)/);

  return {
    percent,
    timeSeconds,
    fps: fpsMatch ? fpsMatch[1] : null,
    speed: speedMatch ? speedMatch[1] : null
  };
}

function codecsFromProbe(probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  return {
    videoCodec: video ? video.codec_name : null,
    audioCodec: audio ? audio.codec_name : null
  };
}

function streamLanguage(stream) {
  return (stream.tags && (stream.tags.language || stream.tags.LANGUAGE)) || 'und';
}

function streamTitle(stream) {
  return (stream.tags && (stream.tags.title || stream.tags.TITLE)) || '';
}

function normalizedTrackText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function trackLanguagePriority(track) {
  const text = normalizedTrackText([
    track.language,
    track.title,
    track.label
  ].join(' '));

  if (/\b(hin|hi|hindi|hind)\b/.test(text)) {
    return 0;
  }
  if (/\b(eng|en|english)\b/.test(text)) {
    return 1;
  }
  return 2;
}

function compareAudioPreference(a, b) {
  const priorityDiff = trackLanguagePriority(a) - trackLanguagePriority(b);
  if (priorityDiff !== 0) return priorityDiff;

  if (Boolean(a.default) !== Boolean(b.default)) {
    return a.default ? -1 : 1;
  }

  const channelDiff = Number(b.channels || 0) - Number(a.channels || 0);
  if (channelDiff !== 0) return channelDiff;

  return Number(a.index || 0) - Number(b.index || 0);
}

function trackLabel(stream, fallback) {
  const language = streamLanguage(stream);
  const title = streamTitle(stream);
  const parts = [];
  if (language && language !== 'und') parts.push(language.toUpperCase());
  if (title) parts.push(title);
  if (stream.codec_name) parts.push(stream.codec_name);
  return parts.length ? parts.join(' - ') : fallback;
}

function canExtractSubtitle(codec) {
  return ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(String(codec || '').toLowerCase());
}

function tracksFromProbe(probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const audioTracks = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream, index) => ({
      index,
      streamIndex: stream.index,
      codec: stream.codec_name || 'unknown',
      language: streamLanguage(stream),
      title: streamTitle(stream),
      channels: stream.channels || null,
      default: Boolean(stream.disposition && stream.disposition.default),
      label: trackLabel(stream, `Audio ${index + 1}`)
    }));

  const subtitleTracks = streams
    .filter((stream) => stream.codec_type === 'subtitle')
    .map((stream, index) => ({
      index,
      streamIndex: stream.index,
      codec: stream.codec_name || 'unknown',
      language: streamLanguage(stream),
      title: streamTitle(stream),
      default: Boolean(stream.disposition && stream.disposition.default),
      forced: Boolean(stream.disposition && stream.disposition.forced),
      extractable: canExtractSubtitle(stream.codec_name),
      label: trackLabel(stream, `Subtitle ${index + 1}`)
    }));

  return { audioTracks, subtitleTracks };
}

function selectedAudioIndex(probe, requestedAudioStreamIndex) {
  const { audioTracks } = tracksFromProbe(probe);
  if (Number.isInteger(requestedAudioStreamIndex)
    && audioTracks.some((track) => track.streamIndex === requestedAudioStreamIndex)) {
    return requestedAudioStreamIndex;
  }
  const preferredTrack = [...audioTracks].sort(compareAudioPreference)[0];
  return preferredTrack ? preferredTrack.streamIndex : null;
}

function isDirectPlayable(filePath, probe) {
  const ext = path.extname(filePath).toLowerCase();
  const { videoCodec, audioCodec } = codecsFromProbe(probe);

  if (ext === '.mp4' || ext === '.m4v') {
    const videoOk = !videoCodec || ['h264', 'avc1'].includes(videoCodec);
    const audioOk = !audioCodec || ['aac', 'mp3', 'alac'].includes(audioCodec);
    return videoOk && audioOk;
  }

  if (ext === '.webm') {
    const videoOk = !videoCodec || ['vp8', 'vp9', 'av1'].includes(videoCodec);
    const audioOk = !audioCodec || ['opus', 'vorbis'].includes(audioCodec);
    return videoOk && audioOk;
  }

  if (ext === '.ogg' || ext === '.ogv') {
    const videoOk = !videoCodec || ['theora', 'vp8', 'vp9'].includes(videoCodec);
    const audioOk = !audioCodec || ['vorbis', 'opus'].includes(audioCodec);
    return videoOk && audioOk;
  }

  return false;
}

function needsPreparedMedia(filePath, probe, tracks) {
  return !isDirectPlayable(filePath, probe) || tracks.audioTracks.length > 1;
}

function preparedJobKey(movie, options = {}) {
  return `${movie.id}:${sourceSignature(movie.video_path)}:${PREPARED_CACHE_VERSION}:${preparedVariantKey(options)}`;
}

function preparedMediaStatus(movie, options = {}) {
  const outputPath = preparedMediaPath(movie.id, movie.video_path, options);
  const key = preparedJobKey(movie, options);
  const ready = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
  return {
    key,
    outputPath,
    variantFile: preparedVariantFile(options),
    ready,
    running: runningJobs.has(key),
    queued: queuedPreparedJobs.has(key)
  };
}

function isDeviceSafeMp4(filePath, probe) {
  if (path.extname(String(filePath || '')).toLowerCase() !== '.mp4') {
    return false;
  }
  if (!probe || probe.error) {
    return false;
  }

  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const unsupportedStreams = streams.filter((stream) => !['video', 'audio'].includes(stream.codec_type));
  const videoCodec = String(video && video.codec_name || '').toLowerCase();
  const profile = String(video && video.profile || '').toLowerCase();
  const pixelFormat = String(video && video.pix_fmt || '').toLowerCase();
  const width = Number(video && video.width || 0);
  const height = Number(video && video.height || 0);
  const audioCodec = String(audio && audio.codec_name || '').toLowerCase();
  const channels = Number(audio && audio.channels || 0);
  let fileSize = 0;
  try {
    fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch (_) {
    fileSize = 0;
  }
  const videoOk = ['h264', 'avc1'].includes(videoCodec)
    && (!profile || profile.includes('baseline'))
    && (!pixelFormat || pixelFormat === 'yuv420p')
    && (!width || width <= MOBILE_SAFE_MAX_WIDTH)
    && (!height || height <= MOBILE_SAFE_MAX_HEIGHT);
  const audioOk = !audio || (audioCodec === 'aac' && (!channels || channels <= 2));
  const sizeOk = !fileSize || fileSize < MOBILE_SAFE_MAX_BYTES;
  return videoOk && audioOk && sizeOk && unsupportedStreams.length === 0;
}

async function isPromotedPreparedReplacement(movie, probe = null) {
  if (!movie || !movie.video_path) return false;
  const mediaProbe = probe || await probeMedia(movie.video_path);
  if (!isDeviceSafeMp4(movie.video_path, mediaProbe)) return false;

  const row = await db.get(`
    SELECT id
    FROM media_conversions
    WHERE movie_id = ?
      AND COALESCE(replacement_path, '') = COALESCE(?, '')
      AND status IN ('promoted', 'deleted')
    ORDER BY id DESC
    LIMIT 1
  `, [movie.id, movie.video_path]);
  return Boolean(row);
}

async function getPlaybackProfile(movie, options = {}) {
  const probe = await probeMedia(movie.video_path);
  const codecs = codecsFromProbe(probe);
  const tracks = tracksFromProbe(probe);
  const sidecarSubtitles = externalSubtitleTracks(movie.video_path);
  const directPlayable = isDirectPlayable(movie.video_path, probe);
  const selectedAudioStreamIndex = selectedAudioIndex(probe, options.audioStreamIndex);
  const startSeconds = normalizeStartSeconds(options.startSeconds);
  const needsTrackAwarePlayback = tracks.audioTracks.length > 1;
  const forceCompatible = Boolean(options.forceCompatible);
  const promotedPreparedReplacement = forceCompatible
    ? await isPromotedPreparedReplacement(movie, probe)
    : false;
  const shouldForcePrepared = forceCompatible && !promotedPreparedReplacement;
  const shouldUsePrepared = shouldForcePrepared || needsPreparedMedia(movie.video_path, probe, tracks);
  const preparedOptions = { audioStreamIndex: selectedAudioStreamIndex };
  if (shouldForcePrepared) {
    preparedOptions.forceVideoTranscode = true;
    preparedOptions.strictDeviceCompatibility = true;
  }
  const preparedStatus = shouldUsePrepared
    ? preparedMediaStatus(movie, preparedOptions)
    : null;
  let promotion = null;
  if (shouldUsePrepared && preparedStatus.ready) {
    try {
      promotion = await promotePreparedMedia(movie, preparedStatus.outputPath, probe);
    } catch (error) {
      logger.error('prepared.promote_failed', {
        movieId: movie.id,
        title: movie.title,
        variant: preparedVariantKey(preparedOptions),
        outputPath: preparedStatus.outputPath,
        error
      });
      promotion = { promoted: false, reason: 'error' };
    }
  }
  let nextPreparedStatus = preparedStatus;
  if (shouldUsePrepared && !preparedStatus.ready) {
    nextPreparedStatus = enqueuePreparedMedia(movie, preparedOptions, forceCompatible ? 'mobile-compatible-playback' : 'playback');
    if (nextPreparedStatus && !nextPreparedStatus.running && !nextPreparedStatus.queued) {
      nextPreparedStatus = { ...nextPreparedStatus, queued: true };
    }
  }
  const promotedToDirect = Boolean(promotion && promotion.promoted);
  const streamMode = promotedToDirect ? 'direct' : shouldUsePrepared
    ? (preparedStatus.ready ? 'prepared' : (shouldForcePrepared ? 'preparing' : 'hls'))
    : 'direct';
  const actualDirectPlayable = promotedToDirect || (!shouldUsePrepared && directPlayable);
  logger.info('playback.profile_computed', {
    movieId: movie.id,
    title: movie.title,
    streamMode,
    directPlayable: actualDirectPlayable,
    requiresPreparedMedia: shouldUsePrepared,
    forceCompatible,
    promotedPreparedReplacement,
    preparedReady: promotedToDirect ? false : (preparedStatus ? preparedStatus.ready : false),
    preparedQueued: nextPreparedStatus ? nextPreparedStatus.queued : false,
    preparedRunning: nextPreparedStatus ? nextPreparedStatus.running : false,
    promotedToDirect,
    replacementPath: promotion ? promotion.replacementPath : null,
    promotionReason: promotion ? promotion.reason : null,
    format: promotedToDirect ? 'mp4' : path.extname(movie.video_path).replace('.', '').toLowerCase(),
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec,
    audioTracks: tracks.audioTracks.length,
    subtitleTracks: tracks.subtitleTracks.length,
    selectedAudioStreamIndex,
    startSeconds,
    probeError: probe.error || null
  });
  return {
    directPlayable: actualDirectPlayable,
    streamMode,
    requiresPreparedMedia: promotedToDirect ? false : shouldUsePrepared,
    forceCompatible,
    promotedPreparedReplacement,
    preparedReady: promotedToDirect ? false : (preparedStatus ? preparedStatus.ready : false),
    preparedQueued: promotedToDirect ? false : (nextPreparedStatus ? nextPreparedStatus.queued : false),
    preparedRunning: promotedToDirect ? false : (nextPreparedStatus ? nextPreparedStatus.running : false),
    preparedVariant: promotedToDirect ? null : (preparedStatus ? preparedStatus.variantFile : null),
    format: promotedToDirect ? 'mp4' : path.extname(movie.video_path).replace('.', '').toLowerCase(),
    selectedAudioStreamIndex,
    startSeconds,
    hlsVariant: variantKey({ audioStreamIndex: selectedAudioStreamIndex, startSeconds }),
    audioTracks: tracks.audioTracks,
    subtitleTracks: [...tracks.subtitleTracks, ...sidecarSubtitles],
    ...codecs,
    probeError: probe.error || null
  };
}

function preparedAssetPath(movieId, videoPath, fileName) {
  const options = optionsFromPreparedVariant(fileName);
  if (!options) {
    return null;
  }

  const outputDir = preparedDirectory(movieId, videoPath);
  const assetPath = path.join(outputDir, fileName);
  const resolvedDir = path.resolve(outputDir);
  const resolvedAsset = path.resolve(assetPath);
  if (!resolvedAsset.startsWith(resolvedDir)) {
    return null;
  }
  return assetPath;
}

function enqueuePreparedMedia(movie, options = {}, reason = 'unknown') {
  const status = preparedMediaStatus(movie, options);
  if (status.ready || status.running || status.queued) {
    return status;
  }

  queuedPreparedJobs.add(status.key);
  const job = {
    movie: { id: movie.id, title: movie.title, video_path: movie.video_path },
    options: { ...options },
    reason
  };
  if (String(reason || '').includes('playback')) {
    preparedQueue.unshift(job);
  } else {
    preparedQueue.push(job);
  }
  logger.info('prepared.queue_add', {
    movieId: movie.id,
    title: movie.title,
    variant: preparedVariantKey(options),
    reason,
    queueLength: preparedQueue.length
  });
  processPreparedQueue();
  return preparedMediaStatus(movie, options);
}

function videoCopyIsSafe(videoCodec) {
  return ['h264', 'avc1'].includes(String(videoCodec || '').toLowerCase());
}

async function preparedJobArgs(movie, options, probe, outputPath) {
  const { videoCodec } = codecsFromProbe(probe);
  const videoEncoder = await choosePreparedVideoEncoder(videoCodec, options.encoderPreference, {
    forceVideoTranscode: options.forceVideoTranscode,
    strictDeviceCompatibility: options.strictDeviceCompatibility
  });
  const tempPath = preparedTempPath(movie.id, movie.video_path, options);
  const args = [
    '-hide_banner',
    '-y',
    '-i', movie.video_path,
    '-map', '0:v:0',
    '-map', Number.isInteger(options.audioStreamIndex) ? `0:${options.audioStreamIndex}` : '0:a:0?',
    '-map_chapters', '-1',
    '-map_metadata', '-1',
    '-sn',
    '-dn'
  ];

  if (videoEncoder.encoder === 'copy') {
    args.push('-c:v', 'copy');
  } else if (videoEncoder.encoder === 'h264_nvenc') {
    args.push(
      '-c:v', 'h264_nvenc',
      '-preset', 'p4',
      '-cq:v', '23',
      '-b:v', '0',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p'
    );
  } else {
    const strictMobile = Boolean(options.strictDeviceCompatibility);
    args.push(
      '-c:v', 'libx264',
      '-preset', DEFAULT_FFMPEG_PRESET
    );
    if (strictMobile) {
      args.push(
        '-b:v', '2800k',
        '-maxrate', '3500k',
        '-bufsize', '7000k'
      );
    } else {
      args.push('-crf', '23');
    }
    args.push(
      '-profile:v', strictMobile ? 'baseline' : 'main',
      '-level:v', strictMobile ? '4.1' : '3.0',
      '-bf', strictMobile ? '0' : '2',
      '-threads', String(normalizedThreadCount()),
      '-filter_threads', '1',
      '-filter_complex_threads', '1',
      '-pix_fmt', 'yuv420p'
    );
    if (strictMobile) {
      args.push(
        '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
      );
    }
  }

  args.push(
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    '-movflags', '+faststart',
    '-max_muxing_queue_size', '1024',
    '-f', 'mp4',
    tempPath
  );

  return {
    args,
    tempPath,
    videoAction: videoEncoder.videoAction,
    encoderUsed: videoEncoder.encoder,
    encoderReason: videoEncoder.reason,
    outputPath
  };
}

function startPreparedJob(job) {
  return new Promise(async (resolve) => {
    const { movie, options, reason } = job;
    const status = preparedMediaStatus(movie, options);
    const outputDir = path.dirname(status.outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    if (status.ready) {
      const probe = await probeMedia(movie.video_path);
      let promotion = null;
      try {
        promotion = await promotePreparedMedia(movie, status.outputPath, probe);
      } catch (error) {
        logger.error('prepared.cached_promote_failed', {
          movieId: movie.id,
          title: movie.title,
          variant: preparedVariantKey(options),
          outputPath: status.outputPath,
          error
        });
      }
      resolve({
        ready: true,
        cached: true,
        outputPath: status.outputPath,
        encoderUsed: 'cached',
        promotion
      });
      return;
    }

    const probe = await probeMedia(movie.video_path);
    const durationSeconds = probeDurationSeconds(probe);
    const {
      args,
      tempPath,
      videoAction,
      encoderUsed,
      encoderReason
    } = await preparedJobArgs(movie, options, probe, status.outputPath);
    fs.rmSync(tempPath, { force: true });

    logger.info('prepared.start', {
      movieId: movie.id,
      title: movie.title,
      variant: preparedVariantKey(options),
      reason,
      videoAction,
      encoderUsed,
      encoderReason,
      ffmpegPath: commandPath('ffmpeg', 'FFMPEG_PATH'),
      preset: DEFAULT_FFMPEG_PRESET,
      threads: normalizedThreadCount(),
      outputPath: status.outputPath
    });

    const child = trackChildProcess(status.key, spawn(commandPath('ffmpeg', 'FFMPEG_PATH'), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    }));

    let lastProgressAt = 0;
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const progress = parseFfmpegProgress(text, durationSeconds);
      if (progress && typeof job.onProgress === 'function' && Date.now() - lastProgressAt > 4000) {
        lastProgressAt = Date.now();
        job.onProgress(progress).catch((error) => {
          logger.warn('prepared.progress_update_failed', {
            movieId: movie.id,
            variant: preparedVariantKey(options),
            error
          });
        });
      }
      if (/error|invalid|failed/i.test(text)) {
        logger.warn('prepared.stderr_warning', {
          movieId: movie.id,
          variant: preparedVariantKey(options),
          message: text.trim()
        });
      }
    });

    child.on('error', (error) => {
      logger.error('prepared.start_failed', {
        movieId: movie.id,
        variant: preparedVariantKey(options),
        error
      });
      fs.rmSync(tempPath, { force: true });
      resolve({ error });
    });

    child.on('close', async (code, signal) => {
      let ready = false;
      let promotion = null;
      if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
        fs.rmSync(status.outputPath, { force: true });
        fs.renameSync(tempPath, status.outputPath);
        ready = true;
        try {
          promotion = await promotePreparedMedia(movie, status.outputPath, probe);
        } catch (error) {
          logger.error('prepared.promote_failed', {
            movieId: movie.id,
            title: movie.title,
            variant: preparedVariantKey(options),
            outputPath: status.outputPath,
            error
          });
          promotion = { promoted: false, reason: 'error' };
        }
      } else {
        fs.rmSync(tempPath, { force: true });
      }

      logger.info(ready ? 'prepared.complete' : 'prepared.failed', {
        movieId: movie.id,
        title: movie.title,
        variant: preparedVariantKey(options),
        code,
        signal,
        ready,
        promoted: promotion ? promotion.promoted : false,
        promotionReason: promotion ? promotion.reason : null,
        replacementPath: promotion ? promotion.replacementPath : null,
        encoderUsed,
        outputPath: status.outputPath
      });
      resolve({
        ready,
        code,
        signal,
        outputPath: ready ? status.outputPath : null,
        encoderUsed,
        videoAction,
        promotion
      });
    });
  });
}

function processPreparedQueue() {
  while (activePreparedJobs < PREPARED_CONCURRENCY && preparedQueue.length > 0) {
    const job = preparedQueue.shift();
    const status = preparedMediaStatus(job.movie, job.options);
    queuedPreparedJobs.delete(status.key);

    if (status.ready || status.running) {
      continue;
    }

    activePreparedJobs += 1;
    startPreparedJob(job)
      .catch((error) => {
        logger.error('prepared.unhandled_error', {
          movieId: job.movie.id,
          title: job.movie.title,
          error
        });
      })
      .finally(() => {
        activePreparedJobs = Math.max(0, activePreparedJobs - 1);
        processPreparedQueue();
      });
  }
}

async function queuePreparedMediaForLibrary(movies, options = {}) {
  const maxJobs = Number(options.maxJobs || 0);
  let considered = 0;
  let skipped = 0;
  let ready = 0;
  let queued = 0;

  for (const movie of movies) {
    if (maxJobs > 0 && queued >= maxJobs) {
      break;
    }

    if (!movie.video_path || !fs.existsSync(movie.video_path)) {
      skipped += 1;
      continue;
    }

    considered += 1;
    const probe = await probeMedia(movie.video_path);
    const tracks = tracksFromProbe(probe);
    if (!needsPreparedMedia(movie.video_path, probe, tracks)) {
      skipped += 1;
      continue;
    }

    const preferredAudioStreamIndex = selectedAudioIndex(probe);
    const audioTargets = Number.isInteger(preferredAudioStreamIndex) ? [preferredAudioStreamIndex] : [null];

    for (const audioStreamIndex of audioTargets) {
      if (maxJobs > 0 && queued >= maxJobs) {
        break;
      }

      const preparedOptions = Number.isInteger(audioStreamIndex) ? { audioStreamIndex } : {};
      const status = preparedMediaStatus(movie, preparedOptions);
      if (status.ready) {
        ready += 1;
      } else {
        const nextStatus = enqueuePreparedMedia(movie, preparedOptions, options.reason || 'library');
        if (nextStatus.queued || nextStatus.running) {
          queued += 1;
        }
      }
    }
  }

  const result = {
    considered,
    skipped,
    ready,
    queued,
    active: activePreparedJobs,
    queueLength: preparedQueue.length
  };
  logger.info('prepared.library_queue_complete', result);
  return result;
}

async function isBackgroundConversionPaused() {
  return (await getAppSetting('backgroundConversionPaused', 'false')) === 'true';
}

async function setBackgroundConversionPaused(paused) {
  await setAppSetting('backgroundConversionPaused', paused ? 'true' : 'false');
  logger.info('background_conversion.pause_state_changed', { paused: Boolean(paused) });
  return getBackgroundConversionQueueState();
}

async function updateBackgroundJobProgress(jobId, progress) {
  await db.run(`
    UPDATE background_conversion_jobs
    SET progress_percent = ?,
        progress_time_seconds = ?,
        fps = COALESCE(?, fps),
        speed = COALESCE(?, speed),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    Number(progress.percent || 0),
    Number(progress.timeSeconds || 0),
    progress.fps || null,
    progress.speed || null,
    jobId
  ]);
}

async function getBackgroundConversionQueueState() {
  await ensureBackgroundConversionSchema();
  const paused = await isBackgroundConversionPaused();
  const summaryRows = await db.all(`
    SELECT status, COUNT(*) AS count
    FROM background_conversion_jobs
    GROUP BY status
  `);
  const counts = summaryRows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});
  const active = await db.get(`
    SELECT *
    FROM background_conversion_jobs
    WHERE status = 'running'
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `);
  const jobs = await db.all(`
    SELECT *
    FROM background_conversion_jobs
    ORDER BY
      CASE status
        WHEN 'running' THEN 0
        WHEN 'queued' THEN 1
        WHEN 'failed' THEN 2
        WHEN 'completed' THEN 3
        WHEN 'skipped' THEN 4
        ELSE 5
      END,
      updated_at DESC,
      id DESC
    LIMIT 100
  `);
  const capabilities = await getFfmpegCapabilities();

  return {
    paused,
    running: backgroundWorkerActive,
    active,
    jobs,
    counts: {
      queued: counts.queued || 0,
      running: counts.running || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      skipped: counts.skipped || 0,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0)
    },
    capabilities
  };
}

async function resetInterruptedBackgroundJobs() {
  await ensureBackgroundConversionSchema();
  const result = await db.run(`
    UPDATE background_conversion_jobs
    SET status = 'queued',
        reason = 'resuming after service restart',
        error = NULL,
        progress_percent = 0,
        progress_time_seconds = 0,
        started_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE status = 'running'
  `);
  if (result.changes) {
    logger.warn('background_conversion.interrupted_jobs_requeued', {
      count: result.changes
    });
  }
  return result.changes || 0;
}

async function queueBackgroundConversionJobs(movies, options = {}) {
  await ensureBackgroundConversionSchema();
  const preference = encoderPreference(options.encoderPreference);
  const force = Boolean(options.force);
  const reason = options.reason || 'manual';
  const maxJobs = Number(options.maxJobs || 0);
  const result = {
    considered: 0,
    queued: 0,
    skipped: 0,
    alreadyQueued: 0,
    alreadyConverted: 0,
    missing: 0,
    failedProbe: 0
  };

  for (const movie of movies) {
    if (maxJobs > 0 && result.queued >= maxJobs) {
      break;
    }

    result.considered += 1;
    if (!movie || !movie.video_path || !fs.existsSync(movie.video_path)) {
      result.missing += 1;
      continue;
    }

    const sourcePath = movie.video_path;
    const pending = await db.get(`
      SELECT id, status
      FROM background_conversion_jobs
      WHERE movie_id = ?
        AND COALESCE(source_path, '') = COALESCE(?, '')
        AND status IN ('queued', 'running')
      ORDER BY id DESC
      LIMIT 1
    `, [movie.id, sourcePath]);
    if (pending) {
      result.alreadyQueued += 1;
      continue;
    }

    const probe = await probeMedia(sourcePath);
    if (probe.error) {
      result.failedProbe += 1;
      await db.run(`
        INSERT INTO background_conversion_jobs (
          movie_id, title, source_path, status, encoder_preference, reason, error, progress_percent, finished_at
        ) VALUES (?, ?, ?, 'failed', ?, ?, ?, 0, CURRENT_TIMESTAMP)
      `, [movie.id, movie.title, sourcePath, preference, reason, probe.error]);
      continue;
    }

    if (!force && await isPromotedPreparedReplacement(movie, probe)) {
      result.alreadyConverted += 1;
      continue;
    }

    if (!force && isDeviceSafeMp4(sourcePath, probe)) {
      result.skipped += 1;
      await db.run(`
        INSERT INTO background_conversion_jobs (
          movie_id, title, source_path, status, encoder_preference, reason,
          output_path, progress_percent, finished_at
        ) VALUES (?, ?, ?, 'skipped', ?, 'already device-safe', ?, 100, CURRENT_TIMESTAMP)
      `, [movie.id, movie.title, sourcePath, preference, sourcePath]);
      continue;
    }

    const selectedAudioStream = selectedAudioIndex(probe);
    await db.run(`
      INSERT INTO background_conversion_jobs (
        movie_id, title, source_path, status, encoder_preference, audio_stream_index,
        reason, progress_percent
      ) VALUES (?, ?, ?, 'queued', ?, ?, ?, 0)
    `, [
      movie.id,
      movie.title,
      sourcePath,
      preference,
      Number.isInteger(selectedAudioStream) ? selectedAudioStream : null,
      reason
    ]);
    result.queued += 1;
  }

  logger.info('background_conversion.jobs_queued', {
    ...result,
    encoderPreference: preference,
    reason
  });
  return result;
}

async function queueBackgroundConversionsForMovieIds(movieIds, options = {}) {
  const ids = Array.from(new Set((movieIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)));

  if (!ids.length) {
    return {
      considered: 0,
      queued: 0,
      skipped: 0,
      alreadyQueued: 0,
      alreadyConverted: 0,
      missing: 0,
      failedProbe: 0
    };
  }

  const placeholders = ids.map(() => '?').join(',');
  const movies = await db.all(`
    SELECT id, title, video_path
    FROM movies
    WHERE id IN (${placeholders})
    ORDER BY title
  `, ids);
  return queueBackgroundConversionJobs(movies, {
    ...options,
    reason: options.reason || 'manual-selected'
  });
}

async function queueBackgroundConversionsForLibrary(options = {}) {
  const movies = await db.all(`
    SELECT id, title, video_path
    FROM movies
    WHERE video_path IS NOT NULL
    ORDER BY title
  `);
  return queueBackgroundConversionJobs(movies, {
    ...options,
    reason: options.reason || 'manual-all'
  });
}

async function processBackgroundConversionQueue() {
  await ensureBackgroundConversionSchema();
  if (backgroundWorkerActive) {
    return getBackgroundConversionQueueState();
  }

  if (await isBackgroundConversionPaused()) {
    logger.info('background_conversion.process_skipped_paused');
    return getBackgroundConversionQueueState();
  }

  backgroundWorkerActive = true;
  try {
    while (!(await isBackgroundConversionPaused())) {
      const job = await db.get(`
        SELECT *
        FROM background_conversion_jobs
        WHERE status = 'queued'
        ORDER BY id ASC
        LIMIT 1
      `);
      if (!job) break;

      const movie = await db.get('SELECT id, title, video_path FROM movies WHERE id = ?', [job.movie_id]);
      if (!movie || !movie.video_path || !fs.existsSync(movie.video_path)) {
        await db.run(`
          UPDATE background_conversion_jobs
          SET status = 'failed',
              error = ?,
              finished_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, ['source file missing', job.id]);
        continue;
      }

      await db.run(`
        UPDATE background_conversion_jobs
        SET status = 'running',
            title = ?,
            source_path = ?,
            attempts = COALESCE(attempts, 0) + 1,
            error = NULL,
            progress_percent = 0,
            progress_time_seconds = 0,
            started_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [movie.title, movie.video_path, job.id]);

      logger.info('background_conversion.job_start', {
        jobId: job.id,
        movieId: movie.id,
        title: movie.title,
        encoderPreference: job.encoder_preference,
        audioStreamIndex: job.audio_stream_index,
        target: 'mobile-safe-h264-baseline-aac-mp4'
      });

      const startProbe = await probeMedia(movie.video_path);
      const preferredAudioStreamIndex = selectedAudioIndex(startProbe);
      await db.run(`
        UPDATE background_conversion_jobs
        SET audio_stream_index = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        Number.isInteger(preferredAudioStreamIndex) ? preferredAudioStreamIndex : null,
        job.id
      ]);
      let result = await startPreparedJob({
        movie,
        options: {
          encoderPreference: job.encoder_preference,
          audioStreamIndex: Number.isInteger(preferredAudioStreamIndex) ? preferredAudioStreamIndex : null,
          forceVideoTranscode: true,
          strictDeviceCompatibility: true
        },
        reason: 'background',
        onProgress: (progress) => updateBackgroundJobProgress(job.id, progress)
      });

      if (!result.ready && result.encoderUsed === 'h264_nvenc' && encoderPreference(job.encoder_preference) === 'auto') {
        logger.warn('background_conversion.gpu_failed_cpu_retry', {
          jobId: job.id,
          movieId: movie.id,
          title: movie.title,
          code: result.code,
          signal: result.signal
        });
        await db.run(`
          UPDATE background_conversion_jobs
          SET reason = 'GPU encode failed; retrying with CPU',
              encoder_used = 'h264_nvenc',
              progress_percent = 0,
              progress_time_seconds = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [job.id]);
        result = await startPreparedJob({
          movie,
          options: {
            encoderPreference: 'cpu',
            audioStreamIndex: Number.isInteger(preferredAudioStreamIndex) ? preferredAudioStreamIndex : null,
            forceVideoTranscode: true,
            strictDeviceCompatibility: true
          },
          reason: 'background-cpu-fallback',
          onProgress: (progress) => updateBackgroundJobProgress(job.id, progress)
        });
      }

      if (result.ready) {
        await db.run(`
          UPDATE background_conversion_jobs
          SET status = 'completed',
              encoder_used = ?,
              output_path = ?,
              progress_percent = 100,
              finished_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [result.encoderUsed || null, result.outputPath || null, job.id]);
        logger.info('background_conversion.job_complete', {
          jobId: job.id,
          movieId: movie.id,
          title: movie.title,
          encoderUsed: result.encoderUsed || null,
          outputPath: result.outputPath || null
        });
      } else {
        await db.run(`
          UPDATE background_conversion_jobs
          SET status = 'failed',
              encoder_used = ?,
              error = ?,
              finished_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          result.encoderUsed || null,
          result.signal ? `ffmpeg stopped by ${result.signal}` : `ffmpeg exited with code ${result.code}`,
          job.id
        ]);
        logger.warn('background_conversion.job_failed', {
          jobId: job.id,
          movieId: movie.id,
          title: movie.title,
          encoderUsed: result.encoderUsed || null,
          code: result.code,
          signal: result.signal
        });
      }
    }
  } catch (error) {
    logger.error('background_conversion.worker_failed', { error });
  } finally {
    backgroundWorkerActive = false;
  }

  return getBackgroundConversionQueueState();
}

async function startBackgroundConversionQueue(trigger = 'manual') {
  if (backgroundWorkerActive) {
    logger.info('background_conversion.reset_skipped_active_worker', { trigger });
    return getBackgroundConversionQueueState();
  } else {
    await resetInterruptedBackgroundJobs();
  }
  logger.info('background_conversion.start_requested', { trigger });
  processBackgroundConversionQueue().catch((error) => {
    logger.error('background_conversion.worker_launch_failed', { trigger, error });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return getBackgroundConversionQueueState();
}

function manifestComplete(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  return fs.readFileSync(filePath, 'utf8').includes('#EXT-X-ENDLIST');
}

function ensureHlsTranscode(movie, options = {}) {
  const startSeconds = normalizeStartSeconds(options.startSeconds);
  const outputDir = hlsVariantDirectory(movie.id, movie.video_path, options);
  const manifest = path.join(outputDir, 'index.m3u8');
  const jobKey = `${movie.id}:${sourceSignature(movie.video_path)}:${HLS_CACHE_VERSION}:${variantKey(options)}`;

  fs.mkdirSync(outputDir, { recursive: true });

  if (manifestComplete(manifest)) {
    logger.info('transcode.hls_manifest_cache_hit', {
      movieId: movie.id,
      variant: variantKey(options),
      manifest
    });
    return { ready: true, running: false, manifestPath: manifest };
  }

  const existingJob = runningJobs.get(jobKey);
  if (existingJob && !existingJob.killed) {
    logger.info('transcode.hls_existing_job', {
      movieId: movie.id,
      variant: variantKey(options),
      pid: existingJob.pid,
      manifestExists: fs.existsSync(manifest)
    });
    return { ready: fs.existsSync(manifest), running: true, manifestPath: manifest };
  }

  stopSupersededHlsJobs(movie, options, jobKey);
  safeRmDir(outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const args = [
    '-hide_banner',
    '-y'
  ];

  if (DEFAULT_FFMPEG_REALTIME) {
    args.push('-re');
  }

  if (startSeconds > 0) {
    args.push('-ss', String(startSeconds));
  }

  args.push(
    '-i', movie.video_path,
    '-map', '0:v:0',
    '-map', Number.isInteger(options.audioStreamIndex) ? `0:${options.audioStreamIndex}` : '0:a:0?',
    '-c:v', 'libx264',
    '-preset', DEFAULT_FFMPEG_PRESET,
    '-crf', '23',
    '-threads', String(normalizedThreadCount()),
    '-filter_threads', '1',
    '-filter_complex_threads', '1',
    '-pix_fmt', 'yuv420p',
    '-force_key_frames', 'expr:gte(t,n_forced*6)',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    '-hls_time', '6',
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(outputDir, 'segment_%05d.ts'),
    manifest
  );

  logger.info('transcode.hls_start', {
    movieId: movie.id,
    title: movie.title,
    variant: variantKey(options),
    audioStreamIndex: Number.isInteger(options.audioStreamIndex) ? options.audioStreamIndex : null,
    startSeconds,
    ffmpegPath: commandPath('ffmpeg', 'FFMPEG_PATH'),
    preset: DEFAULT_FFMPEG_PRESET,
    threads: normalizedThreadCount(),
    realtime: DEFAULT_FFMPEG_REALTIME,
    outputDir,
    manifest
  });

  const ffmpeg = trackChildProcess(jobKey, spawn(commandPath('ffmpeg', 'FFMPEG_PATH'), args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  }));

  ffmpeg.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (/error|invalid|failed/i.test(text)) {
      logger.warn('transcode.hls_stderr_warning', {
        movieId: movie.id,
        variant: variantKey(options),
        message: text.trim()
      });
      console.warn(`ffmpeg ${movie.id}: ${text.trim()}`);
    }
  });

  ffmpeg.on('error', (error) => {
    logger.error('transcode.hls_start_failed', {
      movieId: movie.id,
      variant: variantKey(options),
      error
    });
    console.error(`ffmpeg ${movie.id} failed to start:`, error.message);
  });
  ffmpeg.on('close', (code, signal) => {
    logger.info('transcode.hls_exit', {
      movieId: movie.id,
      variant: variantKey(options),
      code,
      signal,
      manifestComplete: manifestComplete(manifest)
    });
  });

  return { ready: fs.existsSync(manifest), running: true, manifestPath: manifest };
}

async function waitForFile(filePath, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function hlsAssetPath(movieId, videoPath, variant, fileName) {
  if (!/^audio-(auto|\d+)(?:-start-\d+)?$/.test(String(variant || ''))) {
    return null;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) {
    return null;
  }
  const outputDir = hlsVariantDirectory(movieId, videoPath, optionsFromVariant(variant));
  const assetPath = path.join(outputDir, fileName);
  const resolvedDir = path.resolve(outputDir);
  const resolvedAsset = path.resolve(assetPath);
  if (!resolvedAsset.startsWith(resolvedDir)) {
    return null;
  }
  return assetPath;
}

function subtitleDirectory(movieId, filePath) {
  return path.join(hlsDirectory(movieId, filePath), 'subtitles');
}

function subtitleTrackPath(movieId, filePath, streamIndex) {
  return path.join(subtitleDirectory(movieId, filePath), `stream-${streamIndex}.vtt`);
}

async function ensureSubtitleTrack(movie, streamIndex) {
  const requested = Number(streamIndex);
  const profile = await getPlaybackProfile(movie);
  const track = profile.subtitleTracks.find((item) => item.streamIndex === requested);

  if (!track) {
    const error = new Error('Subtitle track not found');
    error.statusCode = 404;
    throw error;
  }

  if (track.external && track.path) {
    if (!fs.existsSync(track.path)) {
      const error = new Error('Subtitle sidecar not found');
      error.statusCode = 404;
      throw error;
    }
    logger.info('subtitle.sidecar_served', {
      movieId: movie.id,
      streamIndex: requested,
      subtitlePath: track.path
    });
    return track.path;
  }

  if (!track.extractable) {
    const error = new Error(`Subtitle codec ${track.codec} cannot be converted to WebVTT`);
    error.statusCode = 415;
    throw error;
  }

  const outputDir = subtitleDirectory(movie.id, movie.video_path);
  const outputPath = subtitleTrackPath(movie.id, movie.video_path, requested);
  fs.mkdirSync(outputDir, { recursive: true });

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    logger.info('subtitle.cache_hit', {
      movieId: movie.id,
      streamIndex: requested,
      outputPath
    });
    return outputPath;
  }

  return new Promise((resolve, reject) => {
    const key = `subtitle:${movie.id}:${requested}:${++childSequence}`;
    logger.info('subtitle.extract_start', {
      movieId: movie.id,
      streamIndex: requested,
      outputPath
    });
    const child = execFile(
      commandPath('ffmpeg', 'FFMPEG_PATH'),
      [
        '-hide_banner',
        '-y',
        '-i', movie.video_path,
        '-map', `0:${requested}`,
        '-f', 'webvtt',
        outputPath
      ],
      { windowsHide: true },
      (error) => {
        if (error) {
          logger.error('subtitle.extract_failed', {
            movieId: movie.id,
            streamIndex: requested,
            outputPath,
            error
          });
          reject(error);
          return;
        }
        logger.info('subtitle.extract_complete', {
          movieId: movie.id,
          streamIndex: requested,
          outputPath
        });
        resolve(outputPath);
      }
    );
    trackChildProcess(key, child);
  });
}

function hlsContentType(fileName) {
  if (fileName.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (fileName.endsWith('.ts')) return 'video/mp2t';
  return 'application/octet-stream';
}

module.exports = {
  PREPARED_CACHE_VERSION,
  ensureHlsTranscode,
  ensureSubtitleTrack,
  getPlaybackProfile,
  getBackgroundConversionQueueState,
  getFfmpegCapabilities,
  hlsAssetPath,
  hlsContentType,
  manifestPath,
  optionsFromVariant,
  preparedAssetPath,
  cleanupPendingPromotedOriginals,
  preparedMediaStatus,
  queueBackgroundConversionsForLibrary,
  queueBackgroundConversionsForMovieIds,
  queuePreparedMediaForLibrary,
  probeMedia,
  setBackgroundConversionPaused,
  startBackgroundConversionQueue,
  stopAllTranscodeJobs,
  tracksFromProbe,
  variantKey,
  waitForFile
};
