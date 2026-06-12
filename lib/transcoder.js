const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const logger = require('./logger');

const TRANSCODE_ROOT = path.join(__dirname, '..', 'transcodes');
const HLS_CACHE_VERSION = 'hls-event-v2';
const DEFAULT_FFMPEG_THREADS = Number(process.env.MYFLIX_FFMPEG_THREADS || 2);
const DEFAULT_FFMPEG_PRESET = process.env.MYFLIX_FFMPEG_PRESET || 'ultrafast';
const DEFAULT_FFMPEG_REALTIME = process.env.MYFLIX_FFMPEG_REALTIME !== 'false';
const runningJobs = new Map();
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

function hlsDirectory(movieId, filePath) {
  return path.join(TRANSCODE_ROOT, String(movieId), sourceSignature(filePath), HLS_CACHE_VERSION);
}

function variantKey(options = {}) {
  const audio = Number.isInteger(options.audioStreamIndex) ? options.audioStreamIndex : 'auto';
  const startSeconds = normalizeStartSeconds(options.startSeconds);
  return startSeconds > 0 ? `audio-${audio}-start-${startSeconds}` : `audio-${audio}`;
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

async function getPlaybackProfile(movie, options = {}) {
  const probe = await probeMedia(movie.video_path);
  const codecs = codecsFromProbe(probe);
  const tracks = tracksFromProbe(probe);
  const directPlayable = isDirectPlayable(movie.video_path, probe);
  const selectedAudioStreamIndex = selectedAudioIndex(probe, options.audioStreamIndex);
  const startSeconds = normalizeStartSeconds(options.startSeconds);
  const needsTrackAwarePlayback = tracks.audioTracks.length > 1;
  const streamMode = directPlayable && !needsTrackAwarePlayback ? 'direct' : 'hls';
  logger.info('playback.profile_computed', {
    movieId: movie.id,
    title: movie.title,
    streamMode,
    directPlayable,
    format: path.extname(movie.video_path).replace('.', '').toLowerCase(),
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec,
    audioTracks: tracks.audioTracks.length,
    subtitleTracks: tracks.subtitleTracks.length,
    selectedAudioStreamIndex,
    startSeconds,
    probeError: probe.error || null
  });
  return {
    directPlayable,
    streamMode,
    format: path.extname(movie.video_path).replace('.', '').toLowerCase(),
    selectedAudioStreamIndex,
    startSeconds,
    hlsVariant: variantKey({ audioStreamIndex: selectedAudioStreamIndex, startSeconds }),
    audioTracks: tracks.audioTracks,
    subtitleTracks: tracks.subtitleTracks,
    ...codecs,
    probeError: probe.error || null
  };
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
  probeMedia,
  stopAllTranscodeJobs,
  tracksFromProbe,
  variantKey,
  waitForFile
};
