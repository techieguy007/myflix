const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const db = require('../database/init');
const { loadConfig } = require('./config');
const logger = require('./logger');

const TRANSCODE_ROOT = path.join(__dirname, '..', 'transcodes');
const HLS_CACHE_VERSION = 'hls-event-v2';
const PREPARED_CACHE_VERSION = 'prepared-mp4-v1';
const DEFAULT_FFMPEG_THREADS = Number(process.env.MYFLIX_FFMPEG_THREADS || 2);
const DEFAULT_FFMPEG_PRESET = process.env.MYFLIX_FFMPEG_PRESET || 'ultrafast';
const DEFAULT_FFMPEG_REALTIME = process.env.MYFLIX_FFMPEG_REALTIME !== 'false';
const PREPARED_CONCURRENCY = Math.max(1, Number(process.env.MYFLIX_PREPARED_CONCURRENCY || 1));
const runningJobs = new Map();
const preparedQueue = [];
const queuedPreparedJobs = new Set();
let activePreparedJobs = 0;
let childSequence = 0;

function commandPath(name, envName) {
  if (process.env[envName]) {
    return process.env[envName];
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

function normalizedThreadCount() {
  return Number.isFinite(DEFAULT_FFMPEG_THREADS) && DEFAULT_FFMPEG_THREADS > 0
    ? Math.max(1, Math.floor(DEFAULT_FFMPEG_THREADS))
    : 2;
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
  const stoppedSourceJobs = stopJobsForMovieSource(movie, 'prepared-promoted');
  const conversionId = await recordConversion(movie, {
    ...conversionStats,
    sourcePath,
    replacementPath,
    preparedPath,
    status: 'promoted',
    reason: stoppedSourceJobs > 0 ? 'replacement-created-source-jobs-stopped' : 'replacement-created',
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
  return `audio-${audio}`;
}

function preparedVariantFile(options = {}) {
  return `${preparedVariantKey(options)}.mp4`;
}

function optionsFromPreparedVariant(fileName) {
  const match = String(fileName || '').match(/^audio-(auto|\d+)\.mp4$/);
  if (!match) {
    return null;
  }

  return match[1] === 'auto' ? {} : { audioStreamIndex: Number(match[1]) };
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
  const defaultTrack = audioTracks.find((track) => track.default);
  return defaultTrack ? defaultTrack.streamIndex : (audioTracks[0] ? audioTracks[0].streamIndex : null);
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

async function getPlaybackProfile(movie, options = {}) {
  const probe = await probeMedia(movie.video_path);
  const codecs = codecsFromProbe(probe);
  const tracks = tracksFromProbe(probe);
  const directPlayable = isDirectPlayable(movie.video_path, probe);
  const selectedAudioStreamIndex = selectedAudioIndex(probe, options.audioStreamIndex);
  const startSeconds = normalizeStartSeconds(options.startSeconds);
  const needsTrackAwarePlayback = tracks.audioTracks.length > 1;
  const shouldUsePrepared = needsPreparedMedia(movie.video_path, probe, tracks);
  const preparedStatus = shouldUsePrepared
    ? preparedMediaStatus(movie, { audioStreamIndex: selectedAudioStreamIndex })
    : null;
  let promotion = null;
  if (shouldUsePrepared && preparedStatus.ready) {
    try {
      promotion = await promotePreparedMedia(movie, preparedStatus.outputPath, probe);
    } catch (error) {
      logger.error('prepared.promote_failed', {
        movieId: movie.id,
        title: movie.title,
        variant: preparedVariantKey({ audioStreamIndex: selectedAudioStreamIndex }),
        outputPath: preparedStatus.outputPath,
        error
      });
      promotion = { promoted: false, reason: 'error' };
    }
  }
  if (shouldUsePrepared && !preparedStatus.ready) {
    enqueuePreparedMedia(movie, { audioStreamIndex: selectedAudioStreamIndex }, 'playback');
  }
  const promotedToDirect = Boolean(promotion && promotion.promoted);
  const streamMode = promotedToDirect ? 'direct' : shouldUsePrepared
    ? (preparedStatus.ready ? 'prepared' : 'hls')
    : 'direct';
  logger.info('playback.profile_computed', {
    movieId: movie.id,
    title: movie.title,
    streamMode,
    directPlayable: directPlayable || promotedToDirect,
    requiresPreparedMedia: shouldUsePrepared,
    preparedReady: promotedToDirect ? false : (preparedStatus ? preparedStatus.ready : false),
    preparedQueued: preparedStatus ? preparedStatus.queued : false,
    preparedRunning: preparedStatus ? preparedStatus.running : false,
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
    directPlayable: directPlayable || promotedToDirect,
    streamMode,
    requiresPreparedMedia: promotedToDirect ? false : shouldUsePrepared,
    preparedReady: promotedToDirect ? false : (preparedStatus ? preparedStatus.ready : false),
    preparedVariant: promotedToDirect ? null : (preparedStatus ? preparedStatus.variantFile : null),
    format: promotedToDirect ? 'mp4' : path.extname(movie.video_path).replace('.', '').toLowerCase(),
    selectedAudioStreamIndex,
    startSeconds,
    hlsVariant: variantKey({ audioStreamIndex: selectedAudioStreamIndex, startSeconds }),
    audioTracks: tracks.audioTracks,
    subtitleTracks: tracks.subtitleTracks,
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
  preparedQueue.push({
    movie: { id: movie.id, title: movie.title, video_path: movie.video_path },
    options: { ...options },
    reason
  });
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

function preparedJobArgs(movie, options, probe, outputPath) {
  const { videoCodec } = codecsFromProbe(probe);
  const tempPath = preparedTempPath(movie.id, movie.video_path, options);
  const args = [
    '-hide_banner',
    '-y',
    '-i', movie.video_path,
    '-map', '0:v:0',
    '-map', Number.isInteger(options.audioStreamIndex) ? `0:${options.audioStreamIndex}` : '0:a:0?',
    '-sn',
    '-dn'
  ];

  if (videoCopyIsSafe(videoCodec)) {
    args.push('-c:v', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', DEFAULT_FFMPEG_PRESET,
      '-crf', '23',
      '-threads', String(normalizedThreadCount()),
      '-filter_threads', '1',
      '-filter_complex_threads', '1',
      '-pix_fmt', 'yuv420p'
    );
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

  return { args, tempPath, videoAction: videoCopyIsSafe(videoCodec) ? 'copy' : 'transcode', outputPath };
}

function startPreparedJob(job) {
  return new Promise(async (resolve) => {
    const { movie, options, reason } = job;
    const status = preparedMediaStatus(movie, options);
    const outputDir = path.dirname(status.outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    if (status.ready) {
      resolve({ ready: true });
      return;
    }

    const probe = await probeMedia(movie.video_path);
    const { args, tempPath, videoAction } = preparedJobArgs(movie, options, probe, status.outputPath);
    fs.rmSync(tempPath, { force: true });

    logger.info('prepared.start', {
      movieId: movie.id,
      title: movie.title,
      variant: preparedVariantKey(options),
      reason,
      videoAction,
      ffmpegPath: commandPath('ffmpeg', 'FFMPEG_PATH'),
      preset: DEFAULT_FFMPEG_PRESET,
      threads: normalizedThreadCount(),
      outputPath: status.outputPath
    });

    const child = trackChildProcess(status.key, spawn(commandPath('ffmpeg', 'FFMPEG_PATH'), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    }));

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
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
        outputPath: status.outputPath
      });
      resolve({ ready, code, signal });
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

    const audioTargets = tracks.audioTracks.length > 0
      ? tracks.audioTracks.map((track) => track.streamIndex)
      : [null];

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
  ensureHlsTranscode,
  ensureSubtitleTrack,
  getPlaybackProfile,
  hlsAssetPath,
  hlsContentType,
  manifestPath,
  optionsFromVariant,
  preparedAssetPath,
  cleanupPendingPromotedOriginals,
  preparedMediaStatus,
  queuePreparedMediaForLibrary,
  probeMedia,
  stopAllTranscodeJobs,
  tracksFromProbe,
  variantKey,
  waitForFile
};
